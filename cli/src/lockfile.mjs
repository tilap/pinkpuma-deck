import fs from "node:fs";
import path from "node:path";
import { LOCK_DIR, LOCK_FILE, lockPath } from "./paths.mjs";

/** Supported lockfile format version. Bump when the schema is not backward-compatible. */
export const LOCKFILE_FORMAT = 1;

/**
 * @typedef {{ marketplace: string, name: string, ref: string }} LockEntry
 * @typedef {{ lockfileVersion: number, plugins: LockEntry[] }} Lockfile
 */

export function emptyLockfile() {
  return { lockfileVersion: LOCKFILE_FORMAT, plugins: [] };
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
      `${LOCK_FILE} has lockfileVersion ${raw.lockfileVersion}; this CLI supports ${LOCKFILE_FORMAT} only. Upgrade @pinkpuma/deck or migrate the lockfile.`,
    );
  }
  return {
    lockfileVersion: LOCKFILE_FORMAT,
    plugins: raw.plugins,
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
  const dir = path.join(projectRoot, LOCK_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(projectRoot);
  const normalized = normalizeLockfile({
    lockfileVersion: lock.lockfileVersion ?? LOCKFILE_FORMAT,
    plugins: lock.plugins,
  });
  const out = `${JSON.stringify(normalized, null, 2)}\n`;
  fs.writeFileSync(file, out, "utf8");
  return file;
}

export function ensureLockfile(projectRoot) {
  const existing = readLockfile(projectRoot);
  if (existing) return existing;
  const lock = emptyLockfile();
  writeLockfile(projectRoot, lock);
  return lock;
}

export function addEntry(lock, { marketplace, name, ref }) {
  const id = entryId({ marketplace, name });
  const next = lock.plugins.filter(
    (p) => entryId(p) !== id,
  );
  next.push({ marketplace, name, ref: ref || "main" });
  next.sort((a, b) => entryId(a).localeCompare(entryId(b)));
  return { ...lock, plugins: next };
}

export function removeEntry(lock, spec) {
  const { marketplace, name } = parsePluginSpec(spec);
  const id = entryId({ marketplace, name });
  const plugins = lock.plugins.filter((p) => entryId(p) !== id);
  if (plugins.length === lock.plugins.length) {
    throw new Error(`No lock entry for ${id}`);
  }
  return { ...lock, plugins };
}
