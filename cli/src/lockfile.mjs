import fs from "node:fs";
import { LOCK_FILE, lockPath } from "./paths.mjs";
import { normalizeRequest } from "./sources/spec.mjs";

/**
 * ai-plugin.lock.json — committed, like package-lock.json.
 *
 * Each entry pins what a request resolved to (commit SHA, npm version, archive
 * digest), the integrity of the normalized plugin tree, and its components.
 * Nothing machine-specific: what deck wrote on disk lives in .ai/installed/state.json.
 *
 * @typedef {{ skill: string, body: string }} AgentsSnippet
 * @typedef {import("./sources/fetch.mjs").Resolved} Resolved
 * @typedef {{ skills: string[], agents: string[], commands: string[], rules: string[], hooks: boolean, mcp: string[] }} ComponentSummary
 * @typedef {{ id: string, request: import("./sources/spec.mjs").Request, resolved: Resolved, nested?: Resolved, integrity?: string, components: ComponentSummary, agentsSnippets: AgentsSnippet[] }} LockEntry
 * @typedef {{ lockfileVersion: number, writeAgentsMd: boolean, plugins: LockEntry[] }} Lockfile
 */

export const LOCKFILE_FORMAT = 3;

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
    case "path":
      if (!resolved.path || resolved.path.startsWith("/") || resolved.path.split("/").includes("..")) {
        throw new Error(`${where}.resolved.path must stay inside the project`);
      }
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
 * Normalize and validate a parsed lockfile.
 * @returns {Lockfile}
 */
export function normalizeLockfile(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plugins)) {
    throw new Error(`Invalid lockfile at ${LOCK_FILE}`);
  }
  if (typeof raw.lockfileVersion !== "number") {
    throw new Error(`${LOCK_FILE} is missing lockfileVersion (expected ${LOCKFILE_FORMAT})`);
  }
  if (raw.lockfileVersion !== LOCKFILE_FORMAT) {
    throw new Error(
      `${LOCK_FILE} has lockfileVersion ${raw.lockfileVersion}; this CLI supports ${LOCKFILE_FORMAT}`,
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
