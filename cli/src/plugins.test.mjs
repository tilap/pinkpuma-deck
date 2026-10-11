import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  addPlugin,
  mergePluginRequests,
  parseLinkSpec,
  readLocalPlugins,
  readPlugins,
  readRequestedPlugins,
  removePlugin,
  writeLocalPlugins,
  writePlugins,
} from "./plugins.mjs";
import { readJson, tmp } from "./testkit.mjs";

test("add, remove, and write requests sorted by id", () => {
  const root = tmp();
  let doc = addPlugin({ plugins: [] }, { id: "b", source: "github:a/b" });
  doc = addPlugin(doc, { id: "a", source: "npm:@x/a", version: "^1" });
  doc = addPlugin(doc, { id: "b", source: "github:a/b", ref: "v2" });
  writePlugins(root, doc);
  assert.deepEqual(readPlugins(root).plugins, [
    { id: "a", source: "npm:@x/a", version: "^1" },
    { id: "b", source: "github:a/b", ref: "v2" },
  ]);
  assert.deepEqual(removePlugin(readPlugins(root), "a").plugins.map((p) => p.id), ["b"]);
  assert.throws(() => removePlugin(readPlugins(root), "zzz"), /No plugin with id/);
});

test("hosts modes are validated and duplicate ids refused", () => {
  const root = tmp();
  writePlugins(root, { plugins: [], hosts: { cursor: "off" } });
  assert.deepEqual(readPlugins(root).hosts, { cursor: "off" });
  assert.throws(() => writePlugins(root, { plugins: [], hosts: { cursor: "magic" } }), /must be one of/);
  assert.throws(() => writePlugins(root, { plugins: [], hosts: { vim: "copy" } }), /unknown host/);
  assert.throws(
    () => writePlugins(root, { plugins: [{ id: "a", source: "github:a/b" }, { id: "a", source: "npm:a" }] }),
    /duplicate id/,
  );
});

test("ai-plugin.json never stores a local path", () => {
  const root = tmp();
  writePlugins(root, { plugins: [{ id: "a", source: "github:a/b", from: "/abs" }] });
  assert.equal(readJson(path.join(root, "ai-plugin.json")).plugins[0].from, undefined);
});

test("parseLinkSpec splits a plugin name after the last path segment", () => {
  assert.deepEqual(parseLinkSpec("../kit@demo"), { checkout: "../kit", name: "demo" });
  assert.deepEqual(parseLinkSpec("/x/@scope/kit"), { checkout: "/x/@scope/kit", name: undefined });
  assert.deepEqual(parseLinkSpec("./skills"), { checkout: "./skills", name: undefined });
});

test("a local link overrides the committed request with the same id", () => {
  const root = tmp();
  writePlugins(root, { plugins: [{ id: "demo", source: "github:a/b", ref: "v1" }, { id: "x", source: "npm:x" }] });
  writeLocalPlugins(root, { plugins: [{ id: "demo", source: "local:/work/kit", plugin: "demo" }] });
  const merged = readRequestedPlugins(root);
  assert.deepEqual(merged.plugins.find((p) => p.id === "demo"), {
    id: "demo",
    source: "local:/work/kit",
    plugin: "demo",
    linked: true,
  });
  assert.equal(mergePluginRequests(null, null).plugins.length, 0);
});
