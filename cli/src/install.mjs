import { rewriteAgentsMd } from "./agents.mjs";
import { ensureDeckGitignored } from "./gitignore.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeBin, isEnabled, nativeInstall, nativeUninstall, releaseMarketplace } from "./hosts/claude-native.mjs";
import { copyInstall, removeInstalledFiles } from "./hosts/copy.mjs";
import { emptyLockfile, removeLockEntry, upsertLockEntry, writeLockfile } from "./lockfile.mjs";
import { materialize, pluginName, removeMaterialized, treeIntegrity, writeDeckMarketplace } from "./materialize.mjs";
import { PLUGINS_FILE, deckPluginRel } from "./paths.mjs";
import { loadProject } from "./project.mjs";
import { fetchSource, pinDescriptor } from "./sources/fetch.mjs";
import { locatePlugin } from "./sources/locate.mjs";
import { descriptorFor, normalizeRequest, sameRequest } from "./sources/spec.mjs";
import { readState, writeState } from "./state.mjs";

/**
 * One request → fetched, located, normalized under .ai/installed/plugins/<id>, and
 * activated for each host. The lock pins what was resolved; the state records
 * what was written on this machine.
 *
 * @typedef {import("./sources/spec.mjs").Request & { linked?: boolean }} Requested
 * @typedef {import("./lockfile.mjs").LockEntry} LockEntry
 */

/** Claude loads `.ai/installed/` natively; cursor-agent ignores plugin paths from hooks, so Cursor copies. */
const DEFAULT_HOSTS = { claude: "native", cursor: "copy" };

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

/** Host modes that can actually run here, with a warning for each fallback. */
function effectiveModes(modes) {
  const effective = { ...modes };
  const warnings = [];
  let bin = null;
  if (effective.claude === "native") {
    bin = claudeBin();
    if (!bin) {
      effective.claude = "copy";
      warnings.push("claude: `claude` CLI not found, using copy mode");
    }
  }
  if (effective.cursor === "native") {
    effective.cursor = "copy";
    warnings.push("cursor: cursor-agent cannot load plugins natively, using copy mode");
  }
  return { effective, warnings, bin };
}

/** One string per host mode, recorded in the state to notice a mode change. */
function modesKey(effective) {
  return Object.keys(effective)
    .sort()
    .map((host) => `${host}:${effective[host]}`)
    .join(",");
}

/**
 * Nothing to do for this plugin: the lock still pins it, and this machine
 * already has that exact tree, activated the same way, with every file in place.
 * Checked without fetching anything and without calling the claude CLI.
 */
function upToDate(projectRoot, request, pin, state, modes) {
  if (!pin?.integrity || request.linked) return false;
  const installed = state.plugins[request.id];
  if (!installed || installed.integrity !== pin.integrity) return false;
  if (installed.modes !== modesKey(effectiveModes(modes).effective)) return false;
  if (!installed.paths.every((rel) => fs.existsSync(path.join(projectRoot, rel)))) return false;
  if (installed.native?.includes("claude") && !isEnabled(projectRoot, pluginName(request.id))) return false;
  const dir = path.join(projectRoot, deckPluginRel(request.id));
  return fs.existsSync(dir) && treeIntegrity(dir) === pin.integrity;
}

/** Activate a normalized plugin for every host, natively or by copy. */
function activate(projectRoot, id, pluginDir, modes, state, force, integrity) {
  const { effective, warnings, bin } = effectiveModes(modes);
  const previous = state.plugins[id];
  if (previous) {
    removeInstalledFiles(projectRoot, previous);
    if (previous.native?.includes("claude") && effective.claude !== "native") {
      const current = claudeBin();
      if (current) nativeUninstall(current, projectRoot, pluginName(id));
    }
  }
  const copyHosts = Object.entries(effective)
    .filter(([, mode]) => mode === "copy")
    .map(([host]) => host);
  const result = copyInstall(projectRoot, id, pluginDir, { hosts: copyHosts, state, previous, force });
  const entry = { paths: result.paths, mcpKeys: result.mcpKeys, integrity, modes: modesKey(effective) };
  if (effective.claude === "native") {
    writeDeckMarketplace(projectRoot, new Set([...Object.keys(state.plugins), id]));
    nativeInstall(bin, projectRoot, pluginName(id));
    entry.native = ["claude"];
  }
  state.plugins[id] = entry;
  const hookWarnings = result.warnings;
  return [...warnings, ...hookWarnings];
}

function deactivate(projectRoot, id, state) {
  const previous = state.plugins[id];
  if (previous) {
    removeInstalledFiles(projectRoot, previous);
    if (previous.native?.includes("claude")) {
      const bin = claudeBin();
      if (bin) nativeUninstall(bin, projectRoot, pluginName(id));
    }
  }
  delete state.plugins[id];
  removeMaterialized(projectRoot, id);
}

/**
 * Write the lock, the state, and the deck marketplace. `saveLock` lets a caller
 * split one in-memory lock across files (the base and the active profile).
 */
function persist(projectRoot, lock, state, saveLock) {
  const anyNative = Object.values(state.plugins).some((entry) => entry.native?.includes("claude"));
  if (!anyNative) releaseMarketplace(projectRoot);
  if (saveLock) saveLock(lock);
  else writeLockfile(projectRoot, lock);
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
  let current = lock ?? emptyLockfile();
  const pin = pinFor(current, request, options.update);
  let resolved;
  let warnings;
  try {
    resolved = await resolveRequest(projectRoot, request, { pin, fetch: options.fetch });
    warnings = activate(
      projectRoot,
      request.id,
      resolved.built.dir,
      hostModes(doc),
      state,
      options.force,
      resolved.built.integrity,
    );
  } catch (err) {
    // A failed first install leaves nothing behind; a failed reinstall keeps the previous one.
    if (!state.plugins[request.id]) removeMaterialized(projectRoot, request.id);
    throw err;
  }
  const { entry, built } = resolved;
  if (!request.linked) current = upsertLockEntry(current, entry);
  persist(projectRoot, current, state, options.saveLock);
  // AGENTS.md shows a linked plugin's snippets even though the lock does not hold it.
  rewriteAgentsMd(projectRoot, request.linked ? upsertLockEntry(current, entry) : current);
  return { entry, built, warnings, lock: current };
}

/**
 * Remove a plugin's files, normalized tree, lock entry, and state.
 */
export function uninstallOne(projectRoot, id, lock, { keepFiles = false, saveLock } = {}) {
  const state = readState(projectRoot);
  if (keepFiles) {
    delete state.plugins[id];
    removeMaterialized(projectRoot, id);
  } else {
    deactivate(projectRoot, id, state);
  }
  const next = removeLockEntry(lock ?? emptyLockfile(), id);
  persist(projectRoot, next, state, saveLock);
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
  let current = lock ? { ...lock, plugins: [...lock.plugins] } : emptyLockfile();
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
    if (upToDate(projectRoot, request, pin, state, hostModes(doc))) {
      results.push({ entry: pin, warnings: [], pinned: true, linked: false, skipped: true });
      continue;
    }
    const { entry, built } = await resolveRequest(projectRoot, request, {
      pin,
      frozen: options.frozen,
      fetch: options.fetch,
    });
    const warnings = activate(projectRoot, request.id, built.dir, hostModes(doc), state, options.force, built.integrity);
    if (request.linked) linkedEntries.push(entry);
    else current = upsertLockEntry(current, entry);
    persist(projectRoot, current, state, options.saveLock);
    results.push({ entry, built, warnings, pinned: Boolean(pin), linked: Boolean(request.linked) });
  }
  persist(projectRoot, current, state, options.saveLock);
  rewriteAgentsMd(projectRoot, linkedEntries.reduce(upsertLockEntry, current));
  return { results, removed, lock: current };
}

/**
 * Resolve and pin a request without installing it anywhere: for a profile that
 * is not active. The normalized tree is built in a scratch folder, then dropped.
 * @returns {Promise<LockEntry>}
 */
export async function lockOnly(request, pin, options = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "deck-lock-"));
  try {
    const { entry } = await resolveRequest(scratch, request, { pin, fetch: options.fetch });
    return entry;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export { pinFor };

/**
 * Build the base and one profile, as pinned by their locks, into `out/<id>/`,
 * without touching the project: no host activation, no lock, state, .gitignore,
 * or AGENTS.md. Local links are ignored: the output is what is committed.
 * A plugin already in `out` with the locked integrity is kept as is; folders of
 * plugins no longer requested are removed.
 *
 * @param {string} projectRoot
 * @param {{ out: string, profile?: string | null, fetch?: typeof fetchSource }} options
 */
export async function materializeTo(projectRoot, options) {
  const out = path.resolve(options.out);
  const project = loadProject(projectRoot, { profile: options.profile ?? null });
  if (!project.exists) throw new Error(`No ${PLUGINS_FILE}. Run deck add <source>.`);
  // Links are local: the committed requests are what is built, even when a link overrides one.
  const committed = [...project.base.plugins, ...(project.prof?.plugins ?? [])];
  const unpinned = committed.filter((r) => !pinFor(project.lock, r, false)?.integrity);
  if (unpinned.length > 0) {
    throw new Error(`${unpinned.map((r) => r.id).join(", ")} not pinned by a lock. Run deck install (or deck add) first.`);
  }

  fs.mkdirSync(out, { recursive: true });
  const wanted = new Set(committed.map((r) => r.id));
  for (const entry of fs.readdirSync(out, { withFileTypes: true })) {
    const dir = path.join(out, entry.name);
    const isPlugin = fs.existsSync(path.join(dir, ".claude-plugin")) || fs.existsSync(path.join(dir, ".cursor-plugin"));
    if (entry.isDirectory() && isPlugin && !wanted.has(entry.name)) fs.rmSync(dir, { recursive: true, force: true });
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "deck-materialize-"));
  const plugins = [];
  try {
    for (const request of committed) {
      const pin = pinFor(project.lock, request, false);
      const dest = path.join(out, request.id);
      let skipped = false;
      if (fs.existsSync(dest) && treeIntegrity(dest) === pin.integrity) {
        skipped = true;
      } else {
        const { built } = await resolveRequest(scratch, request, { pin, frozen: true, fetch: options.fetch });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(built.dir, dest, { recursive: true });
      }
      plugins.push({ id: request.id, path: dest, integrity: pin.integrity, components: pin.components, skipped });
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const prompt = project.profileRoot ? path.join(project.profileRoot, "prompt.md") : null;
  return {
    profile: project.profile,
    prompt: prompt && fs.existsSync(prompt) ? prompt : null,
    out,
    plugins,
  };
}
