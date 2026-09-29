import fs from "node:fs";
import path from "node:path";
import { ensureLockGitignored } from "./gitignore.mjs";
import { AGENT_DIR, LOCK_FILE, lockPath } from "./paths.mjs";

/** Supported lockfile format version. Bump when the schema is not backward-compatible. */
export const LOCKFILE_FORMAT = 2;

/**
 * @typedef {{ skill: string, body: string }} AgentsSnippet
 * @typedef {{ marketplace: string, name: string, ref: string, resolved: string, paths: string[], mcpKeys: Record<string, string[]>, agentsSnippets: AgentsSnippet[] }} LockEntry
 * @typedef {{ lockfileVersion: number, writeAgentsMd: boolean, plugins: LockEntry[] }} Lockfile
 */

export function emptyLockfile() {
  return { lockfileVersion: LOCKFILE_FORMAT, writeAgentsMd: true, plugins: [] };
}

export function entryId(entry) {
  return `${entry.marketplace}@${entry.name}`;
}

/** Parse `owner/repo@plugin` or `owner/repo/plugin`. */
export function parsePluginSpec(spec) {
  const at = spec.match(/^([^@]+)@([^@]+)$/);
  if (at) {
    return { marketplace: at[1], name: at[2] };
  }
  const parts = spec.split("/");
  if (parts.length >= 3) {
    return {
      marketplace: `${parts[0]}/${parts[1]}`,
      name: parts.slice(2).join("/"),
    };
  }
  throw new Error(
    `Invalid plugin spec "${spec}". Expected owner/repo@plugin-name`,
  );
}

function normalizeSnippet(snippet, pluginIndex, snippetIndex) {
  if (!snippet || typeof snippet !== "object") {
    throw new Error(
      `${LOCK_FILE} plugins[${pluginIndex}].agentsSnippets[${snippetIndex}] is not an object`,
    );
  }
  if (!snippet.skill || typeof snippet.body !== "string") {
    throw new Error(
      `${LOCK_FILE} plugins[${pluginIndex}].agentsSnippets[${snippetIndex}] requires skill and body`,
    );
  }
  return { skill: snippet.skill, body: snippet.body };
}

function normalizeEntry(plugin, index) {
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`${LOCK_FILE} plugins[${index}] is not an object`);
  }
  const { marketplace, name, ref, resolved, paths, mcpKeys, agentsSnippets } = plugin;
  if (!marketplace || !name || !ref || !resolved) {
    throw new Error(
      `${LOCK_FILE} plugins[${index}] requires marketplace, name, ref, and resolved`,
    );
  }
  if (!Array.isArray(paths)) {
    throw new Error(`${LOCK_FILE} plugins[${index}].paths must be an array`);
  }
  if (!mcpKeys || typeof mcpKeys !== "object" || Array.isArray(mcpKeys)) {
    throw new Error(`${LOCK_FILE} plugins[${index}].mcpKeys must be an object`);
  }
  const snippets = Array.isArray(agentsSnippets)
    ? agentsSnippets.map((snippet, i) => normalizeSnippet(snippet, index, i))
    : [];
  return {
    marketplace,
    name,
    ref,
    resolved,
    paths: [...paths],
    mcpKeys,
    agentsSnippets: snippets,
  };
}

/**
 * Normalize and validate a parsed lockfile object.
 */
export function normalizeLockfile(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plugins)) {
    throw new Error(`Invalid lockfile at ${LOCK_FILE}`);
  }
  if (typeof raw.lockfileVersion !== "number") {
    throw new Error(
      `${LOCK_FILE} is missing lockfileVersion (expected ${LOCKFILE_FORMAT})`,
    );
  }
  if (raw.lockfileVersion !== LOCKFILE_FORMAT) {
    throw new Error(
      `${LOCK_FILE} has lockfileVersion ${raw.lockfileVersion}; this CLI supports ${LOCKFILE_FORMAT} only`,
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
  if (!fs.existsSync(file)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return normalizeLockfile(raw);
}

export function writeLockfile(projectRoot, lock) {
  const dir = path.join(projectRoot, AGENT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(projectRoot);
  const normalized = normalizeLockfile({
    lockfileVersion: LOCKFILE_FORMAT,
    writeAgentsMd: lock.writeAgentsMd !== false,
    plugins: lock.plugins,
  });
  normalized.plugins.sort((a, b) => entryId(a).localeCompare(entryId(b)));
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  ensureLockGitignored(projectRoot);
  return file;
}

export function setWriteAgentsMd(lock, writeAgentsMd) {
  return { ...lock, writeAgentsMd: writeAgentsMd !== false };
}

export function upsertLockEntry(lock, record) {
  const id = entryId(record);
  const plugins = lock.plugins.filter((plugin) => entryId(plugin) !== id);
  plugins.push(record);
  return { ...lock, plugins };
}

export function removeLockEntry(lock, spec) {
  const { marketplace, name } = parsePluginSpec(spec);
  const id = entryId({ marketplace, name });
  return {
    ...lock,
    plugins: lock.plugins.filter((plugin) => entryId(plugin) !== id),
  };
}
