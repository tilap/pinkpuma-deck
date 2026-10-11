import { rewriteAgentsMd } from "./agents.mjs";
import { ensureDeckGitignored } from "./gitignore.mjs";
import { copyInstall, removeInstalledFiles } from "./hosts/copy.mjs";
import { emptyLockfile, removeLockEntry, upsertLockEntry, writeLockfile } from "./lockfile.mjs";
import { materialize, removeMaterialized, writeDeckMarketplace } from "./materialize.mjs";
import { fetchSource, pinDescriptor } from "./sources/fetch.mjs";
import { locatePlugin } from "./sources/locate.mjs";
import { descriptorFor, normalizeRequest, sameRequest } from "./sources/spec.mjs";
import { readState, writeState } from "./state.mjs";

/**
 * One request → fetched, located, normalized under .deck/plugins/<id>, and
 * activated for each host. The lock pins what was resolved; the state records
 * what was written on this machine.
 *
 * @typedef {import("./sources/spec.mjs").Request & { linked?: boolean }} Requested
 * @typedef {import("./lockfile.mjs").LockEntry} LockEntry
 */

const DEFAULT_HOSTS = { claude: "copy", cursor: "copy" };

export function hostModes(doc) {
  return { ...DEFAULT_HOSTS, ...(doc?.hosts ?? {}) };
}

function cleanRequest(request) {
  const { linked, ...rest } = request;
  return normalizeRequest(rest);
}

/** The lock entry that still pins this request, if the request did not change. */
function pinFor(lock, request, update) {
  if (update) return null;
  const entry = lock?.plugins.find((p) => p.id === request.id);
  if (!entry || request.linked) return null;
  return sameRequest(entry.request, cleanRequest(request)) ? entry : null;
}

/**
 * @param {string} projectRoot
 * @param {Requested} request
 * @param {{ pin?: LockEntry | null, frozen?: boolean, fetch?: typeof fetchSource }} [options]
 */
export async function resolveRequest(projectRoot, request, options = {}) {
  const fetch = options.fetch ?? fetchSource;
  const pin = options.pin ?? null;
  const descriptor = pin ? pinDescriptor(descriptorFor(request), pin.resolved) : descriptorFor(request);
  const fetched = await fetch(descriptor);
  const located = await locatePlugin(fetched.root, request, { nested: pin?.nested ?? null, fetch });
  const built = materialize(projectRoot, request.id, located, {
    fallbackVersion: fallbackVersion(located.nested ?? fetched.resolved),
  });
  if (options.frozen && pin?.integrity && pin.integrity !== built.integrity) {
    throw new Error(
      `${request.id}: content does not match the lock (expected ${pin.integrity}, got ${built.integrity}). Run deck update ${request.id} if the change is intended.`,
    );
  }
  /** @type {LockEntry} */
  const entry = {
    id: request.id,
    request: cleanRequest(request),
    resolved: fetched.resolved,
    ...(located.nested ? { nested: located.nested } : {}),
    integrity: built.integrity,
    components: built.components,
    agentsSnippets: built.agentsSnippets,
  };
  return { entry, built };
}

/** A stable semver for a plugin that declares no version: the resolved revision. */
export function fallbackVersion(resolved) {
  const tag = resolved.sha ?? resolved.sha256 ?? resolved.version ?? "unknown";
  return `0.0.0-deck.${String(tag).replace(/[^0-9A-Za-z-]/g, "").slice(0, 12)}`;
}

/** Activate a normalized plugin for every host in copy mode. */
function activate(projectRoot, id, pluginDir, modes, state, force) {
  const copyHosts = Object.entries(modes)
    .filter(([, mode]) => mode === "copy")
    .map(([host]) => host);
  for (const [host, mode] of Object.entries(modes)) {
    if (mode === "native") {
      throw new Error(`hosts.${host} = "native" is not available yet; use "copy"`);
    }
  }
  const previous = state.plugins[id];
  if (previous) removeInstalledFiles(projectRoot, previous);
  const result = copyInstall(projectRoot, id, pluginDir, { hosts: copyHosts, state, previous, force });
  state.plugins[id] = { paths: result.paths, mcpKeys: result.mcpKeys };
  return result.warnings;
}

function deactivate(projectRoot, id, state) {
  if (state.plugins[id]) removeInstalledFiles(projectRoot, state.plugins[id]);
  delete state.plugins[id];
  removeMaterialized(projectRoot, id);
}

/** Older locks carried machine paths; keep them so remove still works. */
function adoptLegacyState(state, lock) {
  for (const [id, entry] of Object.entries(lock?.legacyState ?? {})) {
    if (!state.plugins[id]) state.plugins[id] = entry;
  }
}

function persist(projectRoot, lock, state) {
  writeLockfile(projectRoot, lock);
  writeState(projectRoot, state);
  writeDeckMarketplace(projectRoot, Object.keys(state.plugins));
  ensureDeckGitignored(projectRoot);
}

/**
 * Install one request (add, link, unlink-restore).
 * @returns {Promise<{ entry: LockEntry, built: object, warnings: string[] }>}
 */
export async function installOne(projectRoot, doc, request, lock, options = {}) {
  const state = readState(projectRoot);
  adoptLegacyState(state, lock);
  let current = lock ?? emptyLockfile();
  const pin = pinFor(current, request, options.update);
  const { entry, built } = await resolveRequest(projectRoot, request, { pin, fetch: options.fetch });
  const warnings = activate(projectRoot, request.id, built.dir, hostModes(doc), state, options.force);
  if (!request.linked) current = upsertLockEntry(current, entry);
  persist(projectRoot, current, state);
  // AGENTS.md shows a linked plugin's snippets even though the lock does not hold it.
  rewriteAgentsMd(projectRoot, request.linked ? upsertLockEntry(current, entry) : current);
  return { entry, built, warnings, lock: current };
}

/**
 * Remove a plugin's files, normalized tree, lock entry, and state.
 */
export function uninstallOne(projectRoot, id, lock, { keepFiles = false } = {}) {
  const state = readState(projectRoot);
  adoptLegacyState(state, lock);
  if (keepFiles) {
    delete state.plugins[id];
    removeMaterialized(projectRoot, id);
  } else {
    deactivate(projectRoot, id, state);
  }
  const next = removeLockEntry(lock ?? emptyLockfile(), id);
  persist(projectRoot, next, state);
  rewriteAgentsMd(projectRoot, next);
  return next;
}

/**
 * Make the project match ai-plugin.json (+ local links), pinned by the lock.
 *   frozen: refuse any request the lock does not pin, and any drift.
 *   update: ignore pins (all, or the ids given) and resolve again.
 */
export async function installAll(projectRoot, doc, lock, options = {}) {
  const state = readState(projectRoot);
  adoptLegacyState(state, lock);
  let current = lock ? { ...lock, plugins: [...lock.plugins] } : emptyLockfile();
  delete current.legacyState;
  const wanted = new Set(doc.plugins.map((p) => p.id));
  const updateIds = options.update === true ? null : new Set(options.update ?? []);
  const isUpdate = (id) => options.update === true || updateIds?.has(id);

  if (options.frozen) {
    const unpinned = doc.plugins.filter((r) => !r.linked && !pinFor(current, r, false));
    if (unpinned.length > 0) {
      throw new Error(
        `--frozen: ${unpinned.map((r) => r.id).join(", ")} not pinned by the lock. Run deck install without --frozen.`,
      );
    }
    const extra = current.plugins.filter((p) => !wanted.has(p.id));
    if (extra.length > 0) {
      throw new Error(`--frozen: the lock has ${extra.map((p) => p.id).join(", ")}, which ai-plugin.json no longer requests.`);
    }
  }

  const removed = [];
  for (const id of new Set([...Object.keys(state.plugins), ...current.plugins.map((p) => p.id)])) {
    if (wanted.has(id)) continue;
    deactivate(projectRoot, id, state);
    current = removeLockEntry(current, id);
    removed.push(id);
  }

  const results = [];
  const linkedEntries = [];
  for (const request of doc.plugins) {
    const pin = pinFor(current, request, isUpdate(request.id));
    const { entry, built } = await resolveRequest(projectRoot, request, {
      pin,
      frozen: options.frozen,
      fetch: options.fetch,
    });
    const warnings = activate(projectRoot, request.id, built.dir, hostModes(doc), state, options.force);
    if (request.linked) linkedEntries.push(entry);
    else current = upsertLockEntry(current, entry);
    persist(projectRoot, current, state);
    results.push({ entry, built, warnings, pinned: Boolean(pin), linked: Boolean(request.linked) });
  }
  persist(projectRoot, current, state);
  rewriteAgentsMd(projectRoot, linkedEntries.reduce(upsertLockEntry, current));
  return { results, removed, lock: current };
}
