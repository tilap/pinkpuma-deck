import fs from "node:fs";
import path from "node:path";
import { writeGitignoreBlock } from "./gitignore.mjs";
import { PLUGINS_FILE } from "./paths.mjs";
import { emptyPlugins, readPlugins, writePlugins } from "./plugins.mjs";
import { readState } from "./state.mjs";

/**
 * Wire deck into a project. Safe to run again: each step only adds what is
 * missing, and the result lists what changed.
 *
 *   ai-plugin.json  created when missing; --commit-copies sets "gitignoreCopies": false
 *   .gitignore      created when missing; deck's managed block written
 *   AGENTS.md       created when missing (deck install fills its Skills block)
 *   CLAUDE.md       created when missing; imports @AGENTS.md so Claude reads what Cursor reads
 */

export const AGENTS_IMPORT = "@AGENTS.md";

/**
 * @param {string} projectRoot
 * @param {{ commitCopies?: boolean }} [options]
 * @returns {string[]} what was done, one line per change
 */
export function initProject(projectRoot, options = {}) {
  const done = [];

  let doc = readPlugins(projectRoot);
  if (!doc) {
    doc = emptyPlugins();
    done.push(`created ${PLUGINS_FILE}`);
  }
  if (options.commitCopies && doc.gitignoreCopies !== false) {
    doc = { ...doc, gitignoreCopies: false };
    done.push(`set "gitignoreCopies": false in ${PLUGINS_FILE} (copies in .claude/ and .cursor/ are committed)`);
  }
  if (done.length > 0) writePlugins(projectRoot, doc);

  const state = readState(projectRoot);
  const copies =
    doc.gitignoreCopies === false ? [] : Object.values(state.plugins).flatMap((entry) => entry.paths ?? []);
  const ignore = writeGitignoreBlock(projectRoot, { copies, create: true });
  if (ignore.created) done.push("created .gitignore with deck's block");
  else if (ignore.wrote) done.push("wrote deck's block in .gitignore");

  const agents = path.join(projectRoot, "AGENTS.md");
  if (!fs.existsSync(agents)) {
    fs.writeFileSync(agents, "# Agents\n");
    done.push("created AGENTS.md");
  }

  const claude = path.join(projectRoot, "CLAUDE.md");
  if (!fs.existsSync(claude)) {
    fs.writeFileSync(claude, `${AGENTS_IMPORT}\n`);
    done.push(`created CLAUDE.md (imports ${AGENTS_IMPORT})`);
  } else {
    const text = fs.readFileSync(claude, "utf8");
    if (!text.split(/\r?\n/).includes(AGENTS_IMPORT)) {
      const sep = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
      fs.writeFileSync(claude, `${text}${sep}${AGENTS_IMPORT}\n`);
      done.push(`added ${AGENTS_IMPORT} to CLAUDE.md`);
    }
  }
  return done;
}
