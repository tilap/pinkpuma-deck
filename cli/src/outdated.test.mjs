import test from "node:test";
import assert from "node:assert/strict";
import { installAll } from "./install.mjs";
import { isOutdated, outdated } from "./outdated.mjs";
import { gitCommit, gitRepo, gitTag, skill, tmp } from "./testkit.mjs";

process.env.DECK_CACHE = tmp("deck-cache-");
process.env.DECK_CLAUDE_BIN = "/nonexistent/claude";

test("a release tag request shows a newer release as latest", async () => {
  const repo = gitRepo(tmp("deck-out-"), { "skills/a/SKILL.md": skill("a") });
  gitTag(repo.dir, "v1.0.0");
  const root = tmp();
  await installAll(root, { plugins: [{ id: "a", source: `git:${repo.url}`, ref: "v1.0.0" }] }, null);
  let [row] = outdated(root);
  assert.equal(row.current, repo.sha.slice(0, 12));
  assert.equal(row.wanted, repo.sha.slice(0, 12));
  assert.equal(row.latest, null);
  assert.equal(isOutdated(row), false);

  gitCommit(repo.dir, { "skills/a/SKILL.md": skill("a", "v2") });
  gitTag(repo.dir, "v1.1.0");
  [row] = outdated(root);
  assert.equal(row.latest, "v1.1.0");
  assert.equal(isOutdated(row), true);
});

test("a branch request is outdated when the branch moved", async () => {
  const repo = gitRepo(tmp("deck-out-"), { "skills/a/SKILL.md": skill("a") });
  const root = tmp();
  await installAll(root, { plugins: [{ id: "a", source: `git:${repo.url}` }] }, null);
  assert.equal(isOutdated(outdated(root)[0]), false);
  const next = gitCommit(repo.dir, { "skills/a/SKILL.md": skill("a", "moved") });
  const [row] = outdated(root);
  assert.equal(row.wanted, next.slice(0, 12));
  assert.equal(isOutdated(row), true);
});

test("a commit pin is never outdated; nothing locked gives no rows", async () => {
  const repo = gitRepo(tmp("deck-out-"), { "skills/a/SKILL.md": skill("a") });
  const root = tmp();
  await installAll(root, { plugins: [{ id: "a", source: `git:${repo.url}`, ref: repo.sha }] }, null);
  const [row] = outdated(root);
  assert.equal(row.note, "pinned to a commit");
  assert.equal(isOutdated(row), false);
  assert.deepEqual(outdated(tmp()), []);
});
