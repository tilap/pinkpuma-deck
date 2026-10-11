import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LOCKFILE_FORMAT,
  emptyLockfile,
  normalizeLockfile,
  readLockfile,
  removeLockEntry,
  setWriteAgentsMd,
  upsertLockEntry,
  writeLockfile,
} from "./lockfile.mjs";
import { tmp } from "./testkit.mjs";

const entry = (id, extra = {}) => ({
  id,
  request: { id, source: "github:acme/kit", plugin: id },
  resolved: { type: "git", url: "https://github.com/acme/kit.git", sha: "a".repeat(40) },
  integrity: "sha256-x",
  components: { skills: ["s"], agents: [], commands: [], rules: [], hooks: false, mcp: [] },
  agentsSnippets: [{ skill: "s", body: "- s" }],
  ...extra,
});

test("write and read a format 3 lock, sorted by id", () => {
  const root = tmp();
  let lock = upsertLockEntry(emptyLockfile(), entry("b"));
  lock = upsertLockEntry(lock, entry("a", { nested: { type: "git", url: "u", sha: "c".repeat(40) } }));
  writeLockfile(root, setWriteAgentsMd(lock, false));
  const read = readLockfile(root);
  assert.equal(read.lockfileVersion, LOCKFILE_FORMAT);
  assert.equal(read.writeAgentsMd, false);
  assert.deepEqual(read.plugins.map((p) => p.id), ["a", "b"]);
  assert.equal(read.plugins[0].nested.sha, "c".repeat(40));
  assert.deepEqual(removeLockEntry(read, "a").plugins.map((p) => p.id), ["b"]);
});

test("npm and archive resolutions are validated", () => {
  const ok = (resolved) => normalizeLockfile({ lockfileVersion: 3, plugins: [entry("x", { resolved })] });
  ok({ type: "npm", package: "@a/b", version: "1.0.0", integrity: "sha512-x" });
  ok({ type: "archive", url: "https://x/a.zip", sha256: "f".repeat(64) });
  assert.throws(() => ok({ type: "npm", package: "@a/b" }), /package and version/);
  assert.throws(() => ok({ type: "git", url: "u" }), /commit sha/);
  assert.throws(() => ok({ type: "svn" }), /unknown type/);
});

test("rejects unknown formats and inconsistent entries", () => {
  assert.throws(() => normalizeLockfile({ lockfileVersion: 9, plugins: [] }), /supports 3$/);
  assert.throws(() => normalizeLockfile({ plugins: [] }), /missing lockfileVersion/);
  assert.throws(
    () => normalizeLockfile({ lockfileVersion: 3, plugins: [{ ...entry("a"), id: "b" }] }),
    /id and request.id differ/,
  );
});
