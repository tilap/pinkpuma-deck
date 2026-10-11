import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureDeckGitignored } from "./gitignore.mjs";
import { tmp } from "./testkit.mjs";

test("does nothing without a .gitignore", () => {
  const root = tmp();
  assert.deepEqual(ensureDeckGitignored(root), { wrote: false, reason: "missing" });
  assert.ok(!fs.existsSync(path.join(root, ".gitignore")));
});

test("lists .deck/ and the local link file once", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
  assert.equal(ensureDeckGitignored(root).wrote, true);
  assert.equal(ensureDeckGitignored(root).wrote, false);
  const text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.equal(text, "node_modules\n\n# @pinkpuma/deck — local install\n.deck/\nai-plugin.local.json\n");
});

test("stops ignoring the lock an older deck ignored", () => {
  const root = tmp();
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    "dist\n\n# @pinkpuma/deck — local install\nai-plugin.lock.json\nai-plugin.local.json\n",
  );
  const result = ensureDeckGitignored(root);
  assert.equal(result.unignoredLock, true);
  const text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.ok(!text.includes("ai-plugin.lock.json"));
  assert.match(text, /# @pinkpuma\/deck — local install\n\.deck\/\nai-plugin\.local\.json\n/);
});

test("an existing /.deck entry counts", () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, ".gitignore"), "/.deck\nai-plugin.local.json\n");
  assert.equal(ensureDeckGitignored(root).wrote, false);
});
