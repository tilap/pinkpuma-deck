import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SKILLS_END,
  SKILLS_START,
  collectAgentsSnippets,
  rewriteAgentsMd,
} from "./agents.mjs";

const lockWithTwo = {
  lockfileVersion: 2,
  plugins: [
    {
      marketplace: "acme/kit",
      name: "docs",
      ref: "main",
      resolved: "aaa",
      paths: [],
      mcpKeys: {},
      agentsSnippets: [
        {
          skill: "project-docs",
          body: "- **Code change.** If the `project-docs` skill is available, update docs.",
        },
      ],
    },
    {
      marketplace: "acme/kit",
      name: "git",
      ref: "main",
      resolved: "bbb",
      paths: [],
      mcpKeys: {},
      agentsSnippets: [
        {
          skill: "commit",
          body: "- **Commit.** If the `commit` skill is available, follow it.",
        },
        {
          skill: "branch-name",
          body: "- **Branch.** If the `branch-name` skill is available, follow it.",
        },
      ],
    },
  ],
};

test("collectAgentsSnippets orders by lock then skill name", () => {
  const bodies = collectAgentsSnippets(lockWithTwo);
  assert.equal(bodies.length, 3);
  assert.match(bodies[0], /project-docs/);
  assert.match(bodies[1], /branch-name/);
  assert.match(bodies[2], /commit/);
});

test("rewriteAgentsMd does nothing when AGENTS.md is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-agents-"));
  const result = rewriteAgentsMd(dir, lockWithTwo);
  assert.equal(result.wrote, false);
  assert.equal(result.reason, "missing");
  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")));
});

test("rewriteAgentsMd appends a marked block and replaces it on resync", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-agents-"));
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    "# Agents\n\nProject rules stay here.\n",
  );
  assert.equal(rewriteAgentsMd(dir, lockWithTwo).wrote, true);
  const first = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(first, /Project rules stay here/);
  assert.ok(first.includes(SKILLS_START));
  assert.ok(first.includes(SKILLS_END));
  assert.match(first, /project-docs/);
  assert.match(first, /branch-name/);

  const onePlugin = {
    lockfileVersion: 2,
    plugins: [lockWithTwo.plugins[0]],
  };
  assert.equal(rewriteAgentsMd(dir, onePlugin).wrote, true);
  const second = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(second, /Project rules stay here/);
  assert.match(second, /project-docs/);
  assert.equal(second.includes("branch-name"), false);
  assert.equal(second.indexOf(SKILLS_START), second.lastIndexOf(SKILLS_START));
});

test("rewriteAgentsMd removes the block when no snippets remain", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-agents-"));
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    `# Agents\n\nKeep me.\n\n${SKILLS_START}\n## Skills\n\n- gone\n\n${SKILLS_END}\n`,
  );
  assert.equal(rewriteAgentsMd(dir, { plugins: [] }).wrote, true);
  const text = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(text, /Keep me/);
  assert.equal(text.includes(SKILLS_START), false);
  assert.equal(text.includes("gone"), false);
});

test("rewriteAgentsMd skips writing when writeAgentsMd is false", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-agents-"));
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    `# Agents\n\nKeep me.\n\n${SKILLS_START}\n## Skills\n\n- old\n\n${SKILLS_END}\n`,
  );
  const disabled = { ...lockWithTwo, writeAgentsMd: false };
  assert.equal(rewriteAgentsMd(dir, disabled).wrote, true);
  const text = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(text, /Keep me/);
  assert.equal(text.includes(SKILLS_START), false);
  assert.equal(text.includes("project-docs"), false);

  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Agents\n\nKeep me.\n");
  const again = rewriteAgentsMd(dir, disabled);
  assert.equal(again.wrote, false);
  assert.equal(again.reason, "disabled");
  assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "# Agents\n\nKeep me.\n");
});
