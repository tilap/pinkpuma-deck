import fs from "node:fs";
import path from "node:path";
import { INSTALLED_DIR, LOCAL_PLUGINS_FILE, LOCK_FILE } from "./paths.mjs";

const GITIGNORE = ".gitignore";
/** Machine-only files. The lock is committed, like package-lock.json. */
const DECK_LOCAL_ENTRIES = [`${INSTALLED_DIR}/`, LOCAL_PLUGINS_FILE];
const DECK_HEADER = "# @pinkpuma/deck — local install";

function isListed(text, entry) {
  const bare = entry.replace(/\/$/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if ([bare, `/${bare}`, `${bare}/`, `/${bare}/`].includes(trimmed)) return true;
  }
  return false;
}

/**
 * If the project already has a .gitignore, list `.ai/installed/` and the local link
 * file in it. Does not create .gitignore. Idempotent.
 * @returns {{ wrote: boolean, reason: string }}
 */
export function ensureDeckGitignored(projectRoot) {
  const file = path.join(projectRoot, GITIGNORE);
  if (!fs.existsSync(file)) return { wrote: false, reason: "missing" };

  const original = fs.readFileSync(file, "utf8");
  let text = original;
  const missing = DECK_LOCAL_ENTRIES.filter((entry) => !isListed(text, entry));
  if (missing.length === 0) return { wrote: false, reason: "already" };

  const headerPresent = text.includes(DECK_HEADER);
  const block = `${headerPresent ? "" : `${DECK_HEADER}\n`}${missing.join("\n")}\n`;
  if (headerPresent) {
    text = text.replace(DECK_HEADER, `${DECK_HEADER}\n${missing.join("\n")}`);
  } else if (text.length === 0) {
    text = block;
  } else {
    text = `${text.replace(/\n*$/, "\n")}\n${block}`;
  }
  if (!text.endsWith("\n")) text += "\n";
  fs.writeFileSync(file, text, "utf8");
  return { wrote: true, reason: "updated" };
}

/**
 * What an existing .gitignore says about deck's files, for `deck doctor`.
 * @returns {null | { deckIgnored: boolean, localIgnored: boolean, lockIgnored: boolean }}
 */
export function gitignoreStatus(projectRoot) {
  const file = path.join(projectRoot, GITIGNORE);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  return {
    installedIgnored: isListed(text, `${INSTALLED_DIR}/`),
    localIgnored: isListed(text, LOCAL_PLUGINS_FILE),
    lockIgnored: isListed(text, LOCK_FILE),
  };
}
