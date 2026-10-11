import fs from "node:fs";
import { LOCK_FILE, lockPath } from "./paths.mjs";
import { fromLegacyRequest, normalizeRequest } from "./sources/spec.mjs";

/**
 * ai-plugin.lock.json — committed, like package-lock.json.
 *
 * Each entry pins what a request resolved to (commit SHA, npm version, archive
 * digest), the integrity of the normalized plugin tree, and its components.
 * Nothing machine-specific: what deck wrote on disk lives in .deck/state.json.
 *
 * @typedef {{ skill: string, body: string }} AgentsSnippet
 * @typedef {import("./sources/fetch.mjs").Resolved} Resolved
 * @typedef {{ skills: string[], agents: string[], commands: string[], rules: string[], hooks: boolean, mcp: string[] }} ComponentSummary
 * @typedef {{ id: string, request: import("./sources/spec.mjs").Request, resolved: Resolved, nested?: Resolved, integrity?: string, components: ComponentSummary, agentsSnippets: AgentsSnippet[] }} LockEntry
 * @typedef {{ lockfileVersion: number, writeAgentsMd: boolean, plugins: LockEntry[] }} Lockfile
 */

export const LOCKFILE_FORMAT = 3;
const LEGACY_FORMAT = 2;

export function emptyLockfile() {
  return { lockfileVersion: LOCKFILE_FORMAT, writeAgentsMd: true, plugins: [] };
}

const EMPTY_COMPONENTS = { skills: [], agents: [], commands: [], rules: [], hooks: false, mcp: [] };

function normalizeSnippets(list, where) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(`${where}.agentsSnippets must be an array`);
  return list.map((snippet, i) => {
    if (!snippet?.skill || typeof snippet.body !== "string") {
      throw new Error(`${where}.agentsSnippets[${i}] requires skill and body`);
    }
    return { skill: snippet.skill, body: snippet.body };
  });
}

function normalizeResolved(resolved, where) {
  if (!resolved || typeof resolved !== "object" || !resolved.type) {
    throw new Error(`${where}.resolved must say what was fetched`);
  }
  switch (resolved.type) {
    case "git":
    case "local":
      if (!resolved.sha) throw new Error(`${where}.resolved needs a commit sha`);
      break;
    case "npm":
      if (!resolved.package || !resolved.version) throw new Error(`${where}.resolved needs package and version`);
      break;
    case "archive":
      if (!resolved.url || !resolved.sha256) throw new Error(`${where}.resolved needs url and sha256`);
      break;
    default:
      throw new Error(`${where}.resolved has unknown type "${resolved.type}"`);
  }
  return { ...resolved };
}

function normalizeEntry(plugin, index) {
  const where = `${LOCK_FILE} plugins[${index}]`;
  if (!plugin || typeof plugin !== "object") throw new Error(`${where} is not an object`);
  const request = normalizeRequest(plugin.request, `${where}.request`);
  if (plugin.id !== request.id) throw new Error(`${where}: id and request.id differ`);
  return {
    id: request.id,
    request,
    resolved: normalizeResolved(plugin.resolved, where),
    ...(plugin.nested ? { nested: normalizeResolved(plugin.nested, `${where}.nested`) } : {}),
    ...(typeof plugin.integrity === "string" && plugin.integrity ? { integrity: plugin.integrity } : {}),
    components: { ...EMPTY_COMPONENTS, ...(plugin.components ?? {}) },
    agentsSnippets: normalizeSnippets(plugin.agentsSnippets, where),
  };
}

/**
 * deck <= 0.6 (format 2) kept machine paths in the lock. They move to the
 * state so `remove` can still delete what an older deck wrote.
 */
function fromLegacyLock(raw) {
  const legacyState = {};
  const plugins = raw.plugins.map((plugin, index) => {
    if (!plugin?.marketplace || !plugin?.name || !plugin?.resolved) {
      throw new Error(`${LOCK_FILE} plugins[${index}] requires marketplace, name, and resolved`);
    }
    const request = normalizeRequest(fromLegacyRequest(plugin), `${LOCK_FILE} plugins[${index}]`);
    legacyState[request.id] = {
      paths: Array.isArray(plugin.paths) ? [...plugin.paths] : [],
      mcpKeys: plugin.mcpKeys && typeof plugin.mcpKeys === "object" ? plugin.mcpKeys : {},
    };
    return {
      id: request.id,
      request,
      resolved: { type: "git", url: `https://github.com/${plugin.marketplace}.git`, sha: plugin.resolved },
      components: { ...EMPTY_COMPONENTS },
      agentsSnippets: normalizeSnippets(plugin.agentsSnippets, `${LOCK_FILE} plugins[${index}]`),
    };
  });
  return { plugins, legacyState };
}

/**
 * Normalize and validate a parsed lockfile. A format-2 lock is converted;
 * `legacyState` then holds the paths it recorded.
 * @returns {Lockfile & { legacyState?: Record<string, { paths: string[], mcpKeys: object }> }}
 */
export function normalizeLockfile(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plugins)) {
    throw new Error(`Invalid lockfile at ${LOCK_FILE}`);
  }
  if (typeof raw.lockfileVersion !== "number") {
    throw new Error(`${LOCK_FILE} is missing lockfileVersion (expected ${LOCKFILE_FORMAT})`);
  }
  if (raw.lockfileVersion === LEGACY_FORMAT) {
    const { plugins, legacyState } = fromLegacyLock(raw);
    return { lockfileVersion: LOCKFILE_FORMAT, writeAgentsMd: raw.writeAgentsMd !== false, plugins, legacyState };
  }
  if (raw.lockfileVersion !== LOCKFILE_FORMAT) {
    throw new Error(
      `${LOCK_FILE} has lockfileVersion ${raw.lockfileVersion}; this CLI supports ${LOCKFILE_FORMAT} (and reads ${LEGACY_FORMAT})`,
    );
  }
  return {
    lockfileVersion: LOCKFILE_FORMAT,
    writeAgentsMd: raw.writeAgentsMd !== false,
    plugins: raw.plugins.map(normalizeEntry),
  };
}

export function readLockfile(projectRoot) {
  const file = lockPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  return normalizeLockfile(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeLockfile(projectRoot, lock) {
  const file = lockPath(projectRoot);
  const normalized = normalizeLockfile({
    lockfileVersion: LOCKFILE_FORMAT,
    writeAgentsMd: lock.writeAgentsMd !== false,
    plugins: lock.plugins,
  });
  normalized.plugins.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return file;
}

export function setWriteAgentsMd(lock, writeAgentsMd) {
  return { ...lock, writeAgentsMd: writeAgentsMd !== false };
}

export function upsertLockEntry(lock, record) {
  const plugins = lock.plugins.filter((plugin) => plugin.id !== record.id);
  plugins.push(record);
  return { ...lock, plugins };
}

export function removeLockEntry(lock, id) {
  return { ...lock, plugins: lock.plugins.filter((plugin) => plugin.id !== id) };
}
