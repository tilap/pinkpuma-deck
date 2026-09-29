import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLockGitignored } from "./gitignore.mjs";
import { emptyLockfile, writeLockfile } from "./lockfile.mjs";

test("ensureLockGitignored does nothing without a .gitignore", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-gi-"));
  const result = ensureLockGitignored(dir);
  assert.equal(result.wrote, false);
  assert.equal(result.reason, "missing");
  assert.ok(!fs.existsSync(path.join(dir, ".gitignore")));
});

test("ensureLockGitignored appends the lock path once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-gi-"));
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
  assert.equal(ensureLockGitignored(dir).wrote, true);
  const first = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.match(first, /node_modules\//);
  assert.match(first, /^\.agent\/plugins\.lock\.json$/m);
  assert.equal(ensureLockGitignored(dir).wrote, false);
  assert.equal(ensureLockGitignored(dir).reason, "already");
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), first);
});

test("writeLockfile adds the lock path to an existing .gitignore", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-gi-"));
  fs.writeFileSync(path.join(dir, ".gitignore"), ".DS_Store\n");
  writeLockfile(dir, emptyLockfile());
  const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.match(text, /\.agent\/plugins\.lock\.json/);
  assert.ok(fs.existsSync(path.join(dir, ".agent/plugins.lock.json")));
});
