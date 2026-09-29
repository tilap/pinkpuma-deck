import fs from "node:fs";
import path from "node:path";

export const AGENTS_FILE = "AGENTS.md";
export const SKILLS_START = "<!-- pinkpuma-deck:skills:start -->";
export const SKILLS_END = "<!-- pinkpuma-deck:skills:end -->";

/**
 * Collect DEFAULT_USAGE.md bodies from locked plugins, in lock order then skill name.
 * @param {{ plugins?: Array<{ agentsSnippets?: Array<{ skill: string, body: string }> }> }} lock
 */
export function collectAgentsSnippets(lock) {
  const snippets = [];
  for (const record of lock?.plugins || []) {
    const items = [...(record.agentsSnippets || [])].sort((a, b) =>
      a.skill.localeCompare(b.skill),
    );
    for (const item of items) {
      if (!item?.body?.trim()) continue;
      snippets.push(item.body.trimEnd());
    }
  }
  return snippets;
}

function buildSkillsBlock(snippets) {
  return [
    SKILLS_START,
    "## Skills",
    "",
    ...snippets,
    "",
    SKILLS_END,
  ].join("\n");
}

/**
 * Rewrite the pinkpuma-deck skills block in AGENTS.md from the lock.
 * Does nothing when AGENTS.md is missing.
 * When writeAgentsMd is false or there are no snippets, removes an existing marked block.
 */
export function rewriteAgentsMd(projectRoot, lock) {
  const file = path.join(projectRoot, AGENTS_FILE);
  if (!fs.existsSync(file)) return { wrote: false, reason: "missing" };

  const enabled = lock?.writeAgentsMd !== false;
  const snippets = enabled ? collectAgentsSnippets(lock) : [];
  const original = fs.readFileSync(file, "utf8");
  const start = original.indexOf(SKILLS_START);
  const end = original.indexOf(SKILLS_END);

  let next;
  if (snippets.length === 0) {
    if (start === -1 || end === -1 || end < start) {
      return {
        wrote: false,
        reason: enabled ? "no-snippets" : "disabled",
      };
    }
    const before = original.slice(0, start).replace(/\n+$/, "");
    const after = original.slice(end + SKILLS_END.length).replace(/^\n+/, "\n");
    next = `${before}${after === "\n" || after === "" ? "\n" : after}`;
    if (!next.endsWith("\n")) next += "\n";
  } else {
    const block = buildSkillsBlock(snippets);
    if (start !== -1 && end !== -1 && end > start) {
      const before = original.slice(0, start).replace(/\n+$/, "\n\n");
      const after = original.slice(end + SKILLS_END.length).replace(/^\n*/, "\n");
      next = `${before}${block}${after.startsWith("\n") ? after : `\n${after}`}`;
    } else {
      const body = original.replace(/\n*$/, "\n\n");
      next = `${body}${block}\n`;
    }
  }

  if (next === original) return { wrote: false, reason: "unchanged" };
  fs.writeFileSync(file, next, "utf8");
  return { wrote: true, snippets: snippets.length, enabled };
}

/** Read optional DEFAULT_USAGE.md next to a skill; empty or missing → null. */
export function readDefaultUsage(pluginDir, skillName) {
  const file = path.join(pluginDir, "skills", skillName, "DEFAULT_USAGE.md");
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, "utf8").trimEnd();
  return body ? { skill: skillName, body } : null;
}
