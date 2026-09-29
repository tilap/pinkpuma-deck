import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addEntry,
  emptyLockfile,
  entryId,
  normalizeLockfile,
  parsePluginSpec,
  removeEntry,
  writeLockfile,
  readLockfile,
} from "./lockfile.mjs";

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

test("add and remove lock entries", () => {
  let lock = emptyLockfile();
  lock = addEntry(lock, {
    marketplace: "acme/kit",
    name: "foo",
    ref: "v1.0.0",
  });
  lock = addEntry(lock, {
    marketplace: "acme/kit",
    name: "bar",
    ref: "main",
  });
  assert.equal(lock.plugins.length, 2);
  assert.equal(entryId(lock.plugins[0]), "acme/kit@bar");
  lock = removeEntry(lock, "acme/kit@foo");
  assert.equal(lock.plugins.length, 1);
  assert.equal(lock.plugins[0].name, "bar");
});

test("write and read lockfile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-lock-"));
  let lock = emptyLockfile();
  lock = addEntry(lock, {
    marketplace: "acme/kit",
    name: "foo",
    ref: "main",
  });
  writeLockfile(dir, lock);
  const round = readLockfile(dir);
  assert.equal(round.lockfileVersion, 1);
  assert.equal(round.plugins.length, 1);
  assert.equal(round.plugins[0].marketplace, "acme/kit");
});

test("rejects unsupported lockfileVersion", () => {
  assert.throws(
    () => normalizeLockfile({ lockfileVersion: 99, plugins: [] }),
    /lockfileVersion 99/,
  );
});

test("rejects missing lockfileVersion", () => {
  assert.throws(
    () => normalizeLockfile({ version: 1, plugins: [] }),
    /missing lockfileVersion/,
  );
});
