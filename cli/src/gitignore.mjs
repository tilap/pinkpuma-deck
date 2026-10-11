import fs from "node:fs";
import path from "node:path";
import { CURRENT_LINK_PATH, CURSOR_RULE_PATH, INSTALLED_DIR, LOCAL_PLUGINS_FILE, LOCK_FILE } from "./paths.mjs";

/**
 * One block of .gitignore belongs to deck, between two markers, and is
 * rewritten whole: the local files, and (unless the project commits them) every
 * path copy mode wrote in .claude/ and .cursor/. Lines outside the block are
 * never touched. Like npm with node_modules: commit the intent, not the output.
 */

const GITIGNORE = ".gitignore";
export const BLOCK_START = "# >>> @pinkpuma/deck (managed: rewritten by deck install)";
export const BLOCK_END = "# <<< @pinkpuma/deck";

/** Local files every project ignores. */
export const LOCAL_ENTRIES = [`${INSTALLED_DIR}/`, CURRENT_LINK_PATH, LOCAL_PLUGINS_FILE, CURSOR_RULE_PATH];

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
