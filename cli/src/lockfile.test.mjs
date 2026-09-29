import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emptyLockfile,
  entryId,
  normalizeLockfile,
  parsePluginSpec,
  readLockfile,
  removeLockEntry,
  setWriteAgentsMd,
  upsertLockEntry,
  writeLockfile,
} from "./lockfile.mjs";

const record = {
  marketplace: "acme/kit",
  name: "foo",
  ref: "v1.0.0",
  resolved: "abc123",
  paths: [".claude/skills/foo"],
  mcpKeys: {},
};

test("parsePluginSpec accepts owner/repo@plugin", () => {
  assert.deepEqual(parsePluginSpec("acme/kit@foo"), {
    marketplace: "acme/kit",
    name: "foo",
  });
});

test("parsePluginSpec accepts owner/repo/plugin", () => {
  assert.deepEqual(parsePluginSpec("acme/kit/foo"), {
    marketplace: "acme/kit",
    name: "foo",
  });
});

test("upsert and remove lock entries", () => {
  let lock = emptyLockfile();
  lock = upsertLockEntry(lock, record);
  lock = upsertLockEntry(lock, {
    ...record,
    name: "bar",
    ref: "main",
    resolved: "def456",
  });
  assert.equal(lock.plugins.length, 2);
  assert.equal(entryId(lock.plugins[0]), "acme/kit@foo");
  lock = removeLockEntry(lock, "acme/kit@foo");
  assert.equal(lock.plugins.length, 1);
  assert.equal(lock.plugins[0].name, "bar");
});

test("write and read lockfile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-lock-"));
  const lock = upsertLockEntry(emptyLockfile(), record);
  writeLockfile(dir, lock);
  const round = readLockfile(dir);
  assert.equal(round.lockfileVersion, 2);
  assert.equal(round.writeAgentsMd, true);
  assert.equal(round.plugins.length, 1);
  assert.equal(round.plugins[0].resolved, "abc123");
  assert.deepEqual(round.plugins[0].paths, [".claude/skills/foo"]);
  assert.deepEqual(round.plugins[0].agentsSnippets, []);
});

test("writeAgentsMd false is persisted on the lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-lock-"));
  writeLockfile(dir, setWriteAgentsMd(upsertLockEntry(emptyLockfile(), record), false));
  const round = readLockfile(dir);
  assert.equal(round.writeAgentsMd, false);
});

test("missing writeAgentsMd defaults to true", () => {
  const normalized = normalizeLockfile({
    lockfileVersion: 2,
    plugins: [
      {
        marketplace: "acme/kit",
        name: "foo",
        ref: "main",
        resolved: "abc",
        paths: [],
        mcpKeys: {},
      },
    ],
  });
  assert.equal(normalized.writeAgentsMd, true);
});

test("round-trips agentsSnippets on the lock entry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-lock-"));
  const withSnippets = {
    ...record,
    agentsSnippets: [
      { skill: "foo", body: "- **Foo.** If the `foo` skill is available, use it." },
    ],
  };
  writeLockfile(dir, upsertLockEntry(emptyLockfile(), withSnippets));
  const round = readLockfile(dir);
  assert.deepEqual(round.plugins[0].agentsSnippets, withSnippets.agentsSnippets);
});
test("rejects unsupported lockfileVersion", () => {
  assert.throws(
    () => normalizeLockfile({ lockfileVersion: 1, plugins: [] }),
    /lockfileVersion 1/,
  );
});

test("rejects missing lockfileVersion", () => {
  assert.throws(
    () => normalizeLockfile({ version: 1, plugins: [] }),
    /missing lockfileVersion/,
  );
});

test("rejects a lock entry without a resolved commit", () => {
  assert.throws(
    () =>
      normalizeLockfile({
        lockfileVersion: 2,
        plugins: [{ marketplace: "acme/kit", name: "foo", ref: "main", paths: [], mcpKeys: {} }],
      }),
    /resolved/,
  );
});
