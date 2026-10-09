import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addPlugin,
  emptyPlugins,
  mergePluginRequests,
  parseLinkSpec,
  readPlugins,
  removePlugin,
  writePlugins,
} from "./plugins.mjs";

test("add and remove requested plugins", () => {
  let doc = emptyPlugins();
  doc = addPlugin(doc, { marketplace: "acme/kit", name: "foo", ref: "v1.0.0" });
  doc = addPlugin(doc, { marketplace: "acme/kit", name: "bar", ref: "main" });
  doc = addPlugin(doc, { marketplace: "acme/kit", name: "foo", ref: "v2.0.0" });
  assert.equal(doc.plugins.length, 2);
  assert.equal(doc.plugins.find((plugin) => plugin.name === "foo").ref, "v2.0.0");
  doc = removePlugin(doc, "acme/kit@bar");
  assert.deepEqual(doc.plugins, [
    { marketplace: "acme/kit", name: "foo", ref: "v2.0.0" },
  ]);
});

test("write and read ai-plugin.json without resolved fields", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-plugins-"));
  writePlugins(dir, {
    plugins: [
      {
        marketplace: "acme/kit",
        name: "foo",
        ref: "main",
        resolved: "should-not-stick",
        paths: [".claude/skills/foo"],
      },
    ],
  });
  const round = readPlugins(dir);
  assert.deepEqual(round.plugins, [
    { marketplace: "acme/kit", name: "foo", ref: "main" },
  ]);
  const raw = fs.readFileSync(path.join(dir, "ai-plugin.json"), "utf8");
  assert.equal(raw.includes("resolved"), false);
});

test("ai-plugin.json drops a from path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-plugins-"));
  writePlugins(dir, {
    plugins: [
      {
        marketplace: "acme/kit",
        name: "foo",
        ref: "v1.0.0",
        from: "/tmp/checkout",
      },
    ],
  });
  assert.deepEqual(readPlugins(dir).plugins, [
    { marketplace: "acme/kit", name: "foo", ref: "v1.0.0" },
  ]);
  assert.equal(
    fs.readFileSync(path.join(dir, "ai-plugin.json"), "utf8").includes("from"),
    false,
  );
});

test("parseLinkSpec splits on the last @", () => {
  assert.deepEqual(parseLinkSpec("/Users/me@host/kit@demo"), {
    checkout: "/Users/me@host/kit",
    name: "demo",
  });
  assert.throws(() => parseLinkSpec("demo"), /Expected <checkout>@<plugin-name>/);
});

test("a local link overrides the committed plugin and keeps from", () => {
  const merged = mergePluginRequests(
    {
      plugins: [
        { marketplace: "acme/kit", name: "foo", ref: "v1.0.0" },
        { marketplace: "acme/kit", name: "bar", ref: "v2.0.0" },
      ],
    },
    {
      plugins: [
        {
          marketplace: "acme/kit",
          name: "foo",
          ref: "main",
          from: "/work/kit",
        },
      ],
    },
  );
  assert.deepEqual(merged.plugins, [
    { marketplace: "acme/kit", name: "bar", ref: "v2.0.0" },
    { marketplace: "acme/kit", name: "foo", ref: "main", from: "/work/kit" },
  ]);
});
