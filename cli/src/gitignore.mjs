import fs from "node:fs";
import path from "node:path";
import { LOCAL_PLUGINS_FILE, LOCK_FILE } from "./paths.mjs";

const GITIGNORE = ".gitignore";
const DECK_LOCAL_FILES = [LOCK_FILE, LOCAL_PLUGINS_FILE];

function isListed(text, file) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === file || trimmed === `/${file}`) return true;
  }
  return false;
}

/**
 * If the project already has a .gitignore, ensure the lock and the local plugin
 * request are listed in it. Does not create .gitignore. Idempotent.
 * @returns {{ wrote: boolean, reason: string }}
 */
export function ensureLockGitignored(projectRoot) {
  const file = path.join(projectRoot, GITIGNORE);
  if (!fs.existsSync(file)) {
    return { wrote: false, reason: "missing" };
  }

  const original = fs.readFileSync(file, "utf8");
  const missing = DECK_LOCAL_FILES.filter((name) => !isListed(original, name));
  if (missing.length === 0) {
    return { wrote: false, reason: "already" };
  }

  const block = `# @pinkpuma/deck — local install\n${missing.join("\n")}\n`;
  let next;
  if (original.length === 0) {
    next = block;
  } else if (original.endsWith("\n")) {
    next = `${original.replace(/\n+$/, "\n")}\n${block}`;
  } else {
    next = `${original}\n\n${block}`;
  }

  fs.writeFileSync(file, next, "utf8");
  return { wrote: true, reason: "appended" };
}
