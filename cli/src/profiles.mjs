import fs from "node:fs";
import path from "node:path";
import { PLUGINS_FILE } from "./paths.mjs";
import { CURRENT_LINK, PROFILES_DIR, isValidProfileName, profileDir } from "./project.mjs";

/**
 * The prompt side of a profile. The plugins are deck's usual install; the
 * prompt is wired once and follows the .ai-profiles/current link:
 *   Claude Code  CLAUDE.md imports @.ai-profiles/current/prompt.md
 *   Cursor       .cursor/rules/deck-profile.mdc (alwaysApply) holds a copy of prompt.md
 */

export const IMPORT_LINE = `@${CURRENT_LINK}/prompt.md`;
export const CURSOR_RULE = ".cursor/rules/deck-profile.mdc";
const GITIGNORE_HEADER = "# @pinkpuma/deck — active profile";

export function createProfile(projectRoot, name) {
  if (!isValidProfileName(name)) {
    throw new Error(`Invalid profile name "${name}": use letters, digits, ".", "_" or "-" (not "current")`);
  }
  const dir = profileDir(projectRoot, name);
  if (fs.existsSync(dir)) throw new Error(`${PROFILES_DIR}/${name} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), `# ${name}\n\nYou are the ${name} agent of this project.\n`);
  fs.writeFileSync(path.join(dir, PLUGINS_FILE), `${JSON.stringify({ plugins: [] }, null, 2)}\n`);
  return dir;
}

/** Point .ai-profiles/current at a profile and wire its prompt for both hosts. */
export function useProfile(projectRoot, name) {
  const link = path.join(projectRoot, CURRENT_LINK);
  fs.rmSync(link, { force: true });
  fs.symlinkSync(name, link);
  ensureClaudeImport(projectRoot);
  writeCursorRule(projectRoot, name);
  ensureProfileGitignore(projectRoot);
}

/** Drop the active profile's link, its Cursor rule, and the CLAUDE.md import. */
export function clearProfile(projectRoot) {
  fs.rmSync(path.join(projectRoot, CURRENT_LINK), { force: true });
  fs.rmSync(path.join(projectRoot, CURSOR_RULE), { force: true });
  dropClaudeImport(projectRoot);
}

function ensureClaudeImport(projectRoot) {
  const file = path.join(projectRoot, "CLAUDE.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (text.split(/\r?\n/).includes(IMPORT_LINE)) return;
  const sep = text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, `${text}${sep}${IMPORT_LINE}\n`);
}

function dropClaudeImport(projectRoot) {
  const file = path.join(projectRoot, "CLAUDE.md");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const next = text
    .split("\n")
    .filter((line) => line !== IMPORT_LINE)
    .join("\n")
    .replace(/\n+$/, "\n");
  if (next.trim() === "") fs.rmSync(file);
  else if (next !== text) fs.writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`);
}

function writeCursorRule(projectRoot, name) {
  const prompt = path.join(profileDir(projectRoot, name), "prompt.md");
  const rule = path.join(projectRoot, CURSOR_RULE);
  if (!fs.existsSync(prompt)) {
    fs.rmSync(rule, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(rule), { recursive: true });
  const body = fs.readFileSync(prompt, "utf8");
  fs.writeFileSync(
    rule,
    `---\ndescription: Active agent profile (${name}), written by deck profile use\nalwaysApply: true\n---\n\n${body}`,
  );
}

/** The active-profile files are local: list them in an existing .gitignore. */
function ensureProfileGitignore(projectRoot) {
  const file = path.join(projectRoot, ".gitignore");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes(GITIGNORE_HEADER)) return;
  const sep = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, `${text}${sep}${GITIGNORE_HEADER}\n${CURRENT_LINK}\n${CURSOR_RULE}\n`);
}
