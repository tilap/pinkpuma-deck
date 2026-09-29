import fs from "node:fs";
import path from "node:path";
import { LOCK_FILE } from "./paths.mjs";

const GITIGNORE = ".gitignore";

/**
 * If the project already has a .gitignore, ensure LOCK_FILE is listed in it.
 * Does not create .gitignore. Idempotent when the path is already present.
 * @returns {{ wrote: boolean, reason: string }}
 */
export function ensureLockGitignored(projectRoot) {
  const file = path.join(projectRoot, GITIGNORE);
  if (!fs.existsSync(file)) {
    return { wrote: false, reason: "missing" };
  }

  const original = fs.readFileSync(file, "utf8");
  for (const line of original.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === LOCK_FILE || trimmed === `/${LOCK_FILE}`) {
      return { wrote: false, reason: "already" };
    }
  }

  let next;
  if (original.length === 0) {
    next = `# @pinkpuma/deck — local resolved install\n${LOCK_FILE}\n`;
  } else if (original.endsWith("\n")) {
    next = `${original.replace(/\n+$/, "\n")}\n# @pinkpuma/deck — local resolved install\n${LOCK_FILE}\n`;
  } else {
    next = `${original}\n\n# @pinkpuma/deck — local resolved install\n${LOCK_FILE}\n`;
  }

  fs.writeFileSync(file, next, "utf8");
  return { wrote: true, reason: "appended" };
}
