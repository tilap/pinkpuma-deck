import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultId,
  descriptorFor,
  fromLegacyRequest,
  githubFromUrl,
  normalizeRequest,
  parseAddSpec,
  sameRequest,
} from "./sources/spec.mjs";

test("parseAddSpec reads a GitHub marketplace plugin", () => {
  assert.deepEqual(parseAddSpec("acme/kit@demo"), {
    id: "demo",
    source: "github:acme/kit",
    plugin: "demo",
  });
});

test("parseAddSpec reads a bare repository and the legacy owner/repo/plugin form", () => {
  assert.deepEqual(parseAddSpec("vercel-labs/agent-skills"), {
    id: "agent-skills",
    source: "github:vercel-labs/agent-skills",
  });
  assert.equal(parseAddSpec("acme/kit/demo").plugin, "demo");
});

test("parseAddSpec turns github URLs into github sources and keeps other hosts as git", () => {
  assert.deepEqual(parseAddSpec("https://github.com/acme/kit#v1.2.0"), {
    id: "kit",
    source: "github:acme/kit",
    ref: "v1.2.0",
  });
  assert.deepEqual(parseAddSpec("git@github.com:acme/kit.git"), { id: "kit", source: "github:acme/kit" });
  assert.deepEqual(parseAddSpec("git+https://gitlab.com/team/tools.git#main", { plugin: "fmt" }), {
    id: "fmt",
    source: "git:https://gitlab.com/team/tools.git",
    plugin: "fmt",
    ref: "main",
  });
});

test("parseAddSpec reads npm and archive sources", () => {
  assert.deepEqual(parseAddSpec("npm:@acme/formatter@^2.0.0"), {
    id: "formatter",
    source: "npm:@acme/formatter",
    version: "^2.0.0",
  });
  assert.deepEqual(parseAddSpec("npm:left-pad"), { id: "left-pad", source: "npm:left-pad" });
  assert.deepEqual(parseAddSpec("https://cdn.example.com/kit-1.0.zip", { sha256: "ab" }), {
    id: "kit-1.0",
    source: "archive:https://cdn.example.com/kit-1.0.zip",
    sha256: "ab",
  });
});

test("parseAddSpec applies flags over the spec", () => {
  assert.deepEqual(parseAddSpec("anthropics/skills", { skills: ["pdf", "docx", "pdf"], id: "docs", ref: "main" }), {
    id: "docs",
    source: "github:anthropics/skills",
    ref: "main",
    skills: ["docx", "pdf"],
  });
});

test("parseAddSpec refuses what it cannot read", () => {
  assert.throws(() => parseAddSpec("not a spec"), /Cannot read/);
  assert.throws(() => parseAddSpec(""), /requires a source/);
});

test("normalizeRequest validates ids, sources, and paths", () => {
  assert.throws(() => normalizeRequest({ id: "../x", source: "github:a/b" }), /id/);
  assert.throws(() => normalizeRequest({ id: "x", source: "nope" }), /source/);
  assert.throws(() => normalizeRequest({ id: "x", source: "ftp:a" }), /unknown source kind/);
  assert.throws(() => normalizeRequest({ id: "x", source: "github:a/b", path: "../up" }), /inside/);
  assert.deepEqual(normalizeRequest({ id: "x", source: "github:a/b", ref: "", extra: 1 }), {
    id: "x",
    source: "github:a/b",
  });
});

test("descriptorFor maps each source kind", () => {
  assert.deepEqual(descriptorFor({ source: "github:a/b", ref: "v1" }), {
    type: "git",
    url: "https://github.com/a/b.git",
    repo: "a/b",
    ref: "v1",
  });
  assert.deepEqual(descriptorFor({ source: "npm:@a/b", version: "1.0.0" }), {
    type: "npm",
    package: "@a/b",
    version: "1.0.0",
  });
  assert.throws(() => descriptorFor({ source: "archive:http://x/a.zip" }), /https/);
});

test("legacy requests convert to the current shape", () => {
  assert.deepEqual(fromLegacyRequest({ marketplace: "tilap/toolbelt", name: "git-workflow", ref: "v1" }), {
    id: "git-workflow",
    source: "github:tilap/toolbelt",
    plugin: "git-workflow",
    ref: "v1",
  });
});

test("helpers: defaultId, githubFromUrl, sameRequest", () => {
  assert.equal(defaultId({ source: "git:https://host/team/my-tools.git" }), "my-tools");
  assert.equal(defaultId({ source: "npm:@scope/pkg" }), "pkg");
  assert.equal(githubFromUrl("https://github.com/a/b.git"), "a/b");
  assert.equal(githubFromUrl("https://gitlab.com/a/b"), null);
  assert.equal(
    sameRequest({ id: "a", source: "github:x/y", skills: ["b", "a"] }, { id: "a", source: "github:x/y", skills: ["a", "b"] }),
    true,
  );
  assert.equal(sameRequest({ id: "a", source: "github:x/y" }, { id: "a", source: "github:x/y", ref: "v2" }), false);
});
