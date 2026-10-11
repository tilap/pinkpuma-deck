import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyWorkingTree } from "./worktree.mjs";
import { gitRepo, tmp, writeTree } from "./testkit.mjs";

process.env.DECK_CACHE = tmp("deck-cache-");

test("a checkout copies tracked and new files, not what .gitignore excludes", () => {
  const repo = gitRepo(tmp("deck-wt-"), { ".gitignore": "__pycache__/\n", "skills/a/SKILL.md": "a\n" });
  writeTree(repo.dir, {
    "skills/a/SKILL.md": "edited\n",
    "skills/b/SKILL.md": "new\n",
    "scripts/__pycache__/x.pyc": "junk",
  });
  const { root, resolved } = copyWorkingTree(repo.dir);
  assert.equal(resolved, repo.sha);
  assert.equal(fs.readFileSync(path.join(root, "skills/a/SKILL.md"), "utf8"), "edited\n");
  assert.ok(fs.existsSync(path.join(root, "skills/b/SKILL.md")));
  assert.ok(!fs.existsSync(path.join(root, "scripts/__pycache__")));
  assert.ok(!fs.existsSync(path.join(root, ".git")));
});

test("a plain folder, or a repository without commits, is copied whole", () => {
  const plain = writeTree(tmp("deck-wt-plain-"), { "SKILL.md": "x\n" });
  assert.equal(copyWorkingTree(plain).resolved, "worktree");
  assert.throws(() => copyWorkingTree(path.join(plain, "missing")), /Not a directory/);
});
