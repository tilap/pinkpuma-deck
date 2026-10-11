import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readBlock } from "./gitignore.mjs";
import { initProject } from "./init.mjs";
import { readJson, tmp, writeTree } from "./testkit.mjs";

const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("init sets up an empty folder, then has nothing left to do", () => {
  const root = tmp();
  assert.deepEqual(initProject(root), [
    "created ai-plugin.json",
    "created .gitignore with deck's block",
    "created AGENTS.md",
    "created CLAUDE.md (imports @AGENTS.md)",
  ]);
  assert.deepEqual(readJson(path.join(root, "ai-plugin.json")), { plugins: [] });
  assert.equal(read(root, "CLAUDE.md"), "@AGENTS.md\n");
  assert.equal(read(root, "AGENTS.md"), "# Agents\n");
  assert.ok(readBlock(root).includes(".ai/installed/"));
  assert.deepEqual(initProject(root), []);
});

test("init keeps existing files and only adds what is missing", () => {
  const root = writeTree(tmp(), {
    ".gitignore": "node_modules\n",
    "AGENTS.md": "# Mine\n",
    "CLAUDE.md": "# Rules\n",
    "ai-plugin.json": { plugins: [], agentsMd: false },
  });
  assert.deepEqual(initProject(root), ["wrote deck's block in .gitignore", "added @AGENTS.md to CLAUDE.md"]);
  assert.equal(read(root, "AGENTS.md"), "# Mine\n");
  assert.equal(read(root, "CLAUDE.md"), "# Rules\n\n@AGENTS.md\n");
  assert.ok(read(root, ".gitignore").startsWith("node_modules\n\n# >>> @pinkpuma/deck"));
  assert.equal(readJson(path.join(root, "ai-plugin.json")).agentsMd, false);
});

test("--commit-copies records the choice and keeps copies out of the block", () => {
  const root = writeTree(tmp(), {
    ".ai/installed/state.json": { version: 1, plugins: { kit: { paths: [".cursor/skills/commit"], mcpKeys: {} } } },
  });
  initProject(root);
  assert.ok(readBlock(root).includes("/.cursor/skills/commit"));
  assert.deepEqual(initProject(root, { commitCopies: true }), [
    'set "gitignoreCopies": false in ai-plugin.json (copies in .claude/ and .cursor/ are committed)',
    "wrote deck's block in .gitignore",
  ]);
  assert.equal(readJson(path.join(root, "ai-plugin.json")).gitignoreCopies, false);
  assert.ok(!readBlock(root).includes("/.cursor/skills/commit"));
});
