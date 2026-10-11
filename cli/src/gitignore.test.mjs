import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BLOCK_END, BLOCK_START, gitignoreStatus, readBlock, writeGitignoreBlock } from "./gitignore.mjs";
import { tmp } from "./testkit.mjs";

const read = (root) => fs.readFileSync(path.join(root, ".gitignore"), "utf8");

test("install never creates .gitignore; init does", () => {
  const root = tmp();
  assert.deepEqual(writeGitignoreBlock(root), { wrote: false, created: false });
  assert.ok(!fs.existsSync(path.join(root, ".gitignore")));
  assert.deepEqual(writeGitignoreBlock(root, { create: true }), { wrote: true, created: true });
  assert.equal(
    read(root),
    `${BLOCK_START}\n.ai/installed/\n.ai/current\nai-plugin.local.json\n.cursor/rules/deck-profile.mdc\n${BLOCK_END}\n`,
  );
});

test("the block is appended once, then rewritten in place with the copies", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
  writeGitignoreBlock(root);
  fs.appendFileSync(path.join(root, ".gitignore"), "dist\n");
  writeGitignoreBlock(root, { copies: [".cursor/skills/commit", ".claude/agents/r.md", ".cursor/skills/commit"] });
  const text = read(root);
  assert.ok(text.startsWith("node_modules\n\n# >>> @pinkpuma/deck"));
  assert.ok(text.endsWith(`${BLOCK_END}\ndist\n`), "lines after the block stay");
  assert.deepEqual(readBlock(root).slice(4), ["/.claude/agents/r.md", "/.cursor/skills/commit"]);
  assert.equal(writeGitignoreBlock(root, { copies: [".claude/agents/r.md", ".cursor/skills/commit"] }).wrote, false);
  writeGitignoreBlock(root, { copies: [] });
  assert.equal(readBlock(root).length, 4);
});

test("status reads the block and a lock the user ignored", () => {
  const root = tmp();
  assert.equal(gitignoreStatus(root), null);
  fs.writeFileSync(path.join(root, ".gitignore"), "ai-plugin.lock.json\n");
  assert.deepEqual(gitignoreStatus(root), { block: false, lockIgnored: true });
  writeGitignoreBlock(root);
  assert.equal(gitignoreStatus(root).block, true);
});
