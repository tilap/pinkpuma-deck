import fs from "node:fs";
import path from "node:path";
import { plannedCopyPaths } from "./hosts/copy.mjs";
import { readLockfile } from "./lockfile.mjs";
import { CURRENT_LINK_PATH, CURSOR_RULE_PATH, HOSTS, INSTALLED_DIR, LOCAL_PLUGINS_FILE, LOCK_FILE } from "./paths.mjs";
import { listProfiles, profileDir } from "./project.mjs";

/**
 * One block of .gitignore belongs to deck, between two markers, and is
 * rewritten whole: the local files, and (unless the project commits them) every
 * path copy mode writes in .claude/ and .cursor/ — for the base and for every
 * profile, active or not, so switching profiles never changes a committed file.
 * Lines outside the block are never touched. Like npm with node_modules: commit
 * the intent, not the output.
 */

const GITIGNORE = ".gitignore";
export const BLOCK_START = "# >>> @pinkpuma/deck (managed: rewritten by deck install)";
export const BLOCK_END = "# <<< @pinkpuma/deck";

/** Local files every project ignores. */
export const LOCAL_ENTRIES = [`${INSTALLED_DIR}/`, CURRENT_LINK_PATH, LOCAL_PLUGINS_FILE, CURSOR_RULE_PATH];

/**
 * The copies deck's block ignores: every path copy mode writes for each plugin
 * the base or any profile pins (from the committed locks), plus what this
 * machine actually wrote (a link, or Claude falling back to copy mode).
 * Nothing when the project commits its copies.
 * @param {string} projectRoot
 * @param {import("./state.mjs").State} state
 * @param {{ gitignoreCopies?: boolean } | null} doc the base ai-plugin.json
 * @param {Record<string, string>} modes declared host modes (see hostModes)
 * @returns {string[]}
 */
export function copiesToIgnore(projectRoot, state, doc, modes) {
  if (doc?.gitignoreCopies === false) return [];
  // Every host that is not off: a native host falls back to copy mode on a
  // machine without its CLI, and that machine must not change a committed
  // file. Ignoring a path nothing wrote costs nothing.
  const hosts = Object.keys(HOSTS).filter((name) => modes[name] !== "off");
  const locks = [projectRoot, ...listProfiles(projectRoot).map((name) => profileDir(projectRoot, name))];
  const planned = locks.flatMap((root) => {
    let lock = null;
    try {
      lock = readLockfile(root);
    } catch {
      // An unreadable lock is reported by `deck status`; it ignores nothing here.
    }
    return (lock?.plugins ?? []).flatMap((entry) => plannedCopyPaths(entry.id, entry.components, hosts));
  });
  const written = Object.values(state.plugins).flatMap((entry) => entry.paths ?? []);
  return [...planned, ...written];
}

/** The current block's lines (markers excluded), or null when there is none. */
export function readBlock(projectRoot) {
  const file = path.join(projectRoot, GITIGNORE);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.indexOf(BLOCK_START);
  const end = lines.indexOf(BLOCK_END, start + 1);
  if (start === -1 || end === -1) return null;
  return lines.slice(start + 1, end);
}

/**
 * Write deck's block in .gitignore.
 * @param {string} projectRoot
 * @param {{ copies?: string[], create?: boolean }} [options]
 *   copies: project paths copy mode wrote, to ignore (empty when they are committed)
 *   create: create .gitignore when it is missing (deck init); install never creates it
 * @returns {{ wrote: boolean, created: boolean }}
 */
export function writeGitignoreBlock(projectRoot, { copies = [], create = false } = {}) {
  const file = path.join(projectRoot, GITIGNORE);
  const exists = fs.existsSync(file);
  if (!exists && !create) return { wrote: false, created: false };

  const original = exists ? fs.readFileSync(file, "utf8") : "";
  const lines = original.length > 0 ? original.replace(/\n$/, "").split(/\r?\n/) : [];
  const block = [BLOCK_START, ...LOCAL_ENTRIES, ...[...new Set(copies)].sort().map((rel) => `/${rel}`), BLOCK_END];
  const start = lines.indexOf(BLOCK_START);
  const end = start === -1 ? -1 : lines.indexOf(BLOCK_END, start + 1);

  let next;
  if (start !== -1 && end !== -1) {
    next = [...lines.slice(0, start), ...block, ...lines.slice(end + 1)];
  } else {
    next = lines.length > 0 && lines.at(-1) !== "" ? [...lines, "", ...block] : [...lines, ...block];
  }
  const text = `${next.join("\n")}\n`;
  if (text === original) return { wrote: false, created: false };
  fs.writeFileSync(file, text, "utf8");
  return { wrote: true, created: !exists };
}

/**
 * What .gitignore says about deck's files, for `deck status`.
 * @returns {null | { block: boolean, lockIgnored: boolean }}
 */
export function gitignoreStatus(projectRoot) {
  const file = path.join(projectRoot, GITIGNORE);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim());
  return {
    block: readBlock(projectRoot) !== null,
    lockIgnored: lines.some((l) => [LOCK_FILE, `/${LOCK_FILE}`].includes(l)),
  };
}
