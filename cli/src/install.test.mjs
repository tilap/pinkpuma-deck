import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installAll, installOne, uninstallOne } from "./install.mjs";
import { readLockfile } from "./lockfile.mjs";
import { readState } from "./state.mjs";
import { gitCommit, gitRepo, readJson, skill, tmp, writeTree } from "./testkit.mjs";

process.env.DECK_CACHE = tmp("deck-cache-");
// Copy mode unless a test installs a fake `claude`.
process.env.DECK_CLAUDE_BIN = "/nonexistent/claude";

/** A stand-in for the claude CLI: logs calls and writes the settings the real one writes. */
function fakeClaude() {
  const dir = tmp("deck-fake-claude-");
  const log = path.join(dir, "calls.log");
  const bin = path.join(dir, "claude");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
const file = path.join(process.cwd(), ".claude", "settings.local.json");
const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const [a, b, c] = args;
if (a === "plugin" && b === "marketplace" && c === "add") {
  s.extraKnownMarketplaces = { deck: { source: { source: "directory", path: args[3] } } };
} else if (a === "plugin" && b === "install") {
  s.enabledPlugins = { ...(s.enabledPlugins || {}), [c]: true };
} else if (a === "plugin" && b === "uninstall") {
  delete (s.enabledPlugins || {})[c];
} else if (a === "plugin" && b === "marketplace" && c === "remove") {
  delete (s.extraKnownMarketplaces || {}).deck;
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(s));
`,
    { mode: 0o755 },
  );
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []) };
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function project(extra = {}) {
  return writeTree(tmp("deck-project-"), { ".gitignore": "node_modules\n", "AGENTS.md": "# Agents\n", ...extra });
}

function marketplaceRepo() {
  return gitRepo(tmp("deck-market-"), {
    ".claude-plugin/marketplace.json": { name: "m", plugins: [{ name: "demo", source: "./plugins/demo" }] },
    "plugins/demo/.claude-plugin/plugin.json": { name: "demo", version: "1.0.0" },
    "plugins/demo/skills/hello/SKILL.md": skill("hello"),
    "plugins/demo/skills/hello/DEFAULT_USAGE.md": "- **Hello.** Use the `hello` skill.\n",
    "plugins/demo/agents/reviewer.md": "# r\n",
  });
}

test("install fetches, normalizes, activates, and pins the commit", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const doc = { plugins: [{ id: "demo", source: `git:${repo.url}`, plugin: "demo" }] };
  const { results } = await installAll(root, doc, null);

  assert.equal(results[0].entry.resolved.sha, repo.sha);
  const lock = readLockfile(root);
  assert.equal(lock.plugins[0].resolved.sha, repo.sha);
  assert.match(lock.plugins[0].integrity, /^sha256-/);
  assert.deepEqual(lock.plugins[0].components.skills, ["hello"]);
  assert.ok(exists(root, ".deck/plugins/demo/.cursor-plugin/plugin.json"));
  assert.ok(exists(root, ".claude/skills/hello/SKILL.md"));
  assert.ok(exists(root, ".cursor/agents/reviewer.md"));
  assert.deepEqual(readState(root).plugins.demo.paths.includes(".claude/skills/hello"), true);
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /Use the `hello` skill/);
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /\.deck\//);
  assert.equal(readJson(path.join(root, ".deck/.claude-plugin/marketplace.json")).plugins[0].source, "./plugins/demo");
});

test("the lock pin holds until update, and --frozen reproduces elsewhere", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const doc = { plugins: [{ id: "demo", source: `git:${repo.url}`, plugin: "demo" }] };
  await installAll(root, doc, null);

  const next = gitCommit(repo.dir, { "plugins/demo/skills/hello/SKILL.md": skill("hello", "changed") });
  await installAll(root, doc, readLockfile(root));
  assert.equal(readLockfile(root).plugins[0].resolved.sha, repo.sha, "install keeps the pinned commit");

  const elsewhere = project();
  fs.copyFileSync(path.join(root, "ai-plugin.lock.json"), path.join(elsewhere, "ai-plugin.lock.json"));
  await installAll(elsewhere, doc, readLockfile(elsewhere), { frozen: true });
  assert.equal(readLockfile(elsewhere).plugins[0].integrity, readLockfile(root).plugins[0].integrity);

  await installAll(root, doc, readLockfile(root), { update: true });
  assert.equal(readLockfile(root).plugins[0].resolved.sha, next);
});

test("--frozen refuses an unpinned request, a stale lock, and drifted content", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const doc = { plugins: [{ id: "demo", source: `git:${repo.url}`, plugin: "demo" }] };
  await assert.rejects(installAll(root, doc, null, { frozen: true }), /not pinned by the lock/);
  await installAll(root, doc, null);
  await assert.rejects(installAll(root, { plugins: [] }, readLockfile(root), { frozen: true }), /no longer requests/);

  const lock = readLockfile(root);
  lock.plugins[0].integrity = "sha256-tampered";
  await assert.rejects(installAll(root, doc, lock, { frozen: true }), /does not match the lock/);
});

test("a request that is no longer wanted is removed everywhere", async () => {
  const repo = marketplaceRepo();
  const root = project();
  await installAll(root, { plugins: [{ id: "demo", source: `git:${repo.url}`, plugin: "demo" }] }, null);
  const { removed } = await installAll(root, { plugins: [] }, readLockfile(root));
  assert.deepEqual(removed, ["demo"]);
  assert.ok(!exists(root, ".claude/skills/hello"));
  assert.ok(!exists(root, ".deck/plugins/demo"));
  assert.deepEqual(readLockfile(root).plugins, []);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /hello/);
});

test("installOne and uninstallOne handle a single plugin", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const request = { id: "demo", source: `git:${repo.url}`, plugin: "demo" };
  const { lock } = await installOne(root, { plugins: [request] }, request, null);
  assert.equal(lock.plugins.length, 1);
  uninstallOne(root, "demo", readLockfile(root));
  assert.ok(!exists(root, ".cursor/skills/hello"));
  assert.deepEqual(readLockfile(root).plugins, []);
});

test("a failed first install leaves no normalized tree behind", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const request = { id: "nope", source: `git:${repo.url}`, plugin: "nope" };
  await assert.rejects(installOne(root, { plugins: [request] }, request, null), /no plugin "nope"/);
  assert.ok(!exists(root, ".deck/plugins/nope"));
  assert.ok(!exists(root, "ai-plugin.lock.json"));
});

test("a linked working tree installs with uncommitted files and stays out of the lock", async () => {
  const repo = marketplaceRepo();
  writeTree(repo.dir, { "plugins/demo/skills/draft/SKILL.md": skill("draft") });
  const root = project();
  const request = { id: "demo", source: `local:${repo.dir}`, plugin: "demo", linked: true };
  await installAll(root, { plugins: [request] }, null);
  assert.ok(exists(root, ".claude/skills/draft/SKILL.md"));
  assert.deepEqual(readLockfile(root).plugins, []);
});

test("an npm package is packed without scripts and pinned by version", async (t) => {
  if (spawnSync("npm", ["--version"]).status !== 0) return t.skip("npm not available");
  const pkg = writeTree(tmp("deck-npm-src-"), {
    "package.json": { name: "deck-fixture-skills", version: "1.4.2", scripts: { prepack: "exit 1" } },
    "skills/lint/SKILL.md": skill("lint"),
  });
  const root = project();
  await installAll(root, { plugins: [{ id: "lint", source: `npm:${pkg}` }] }, null);
  const resolved = readLockfile(root).plugins[0].resolved;
  assert.equal(resolved.type, "npm");
  assert.equal(resolved.version, "1.4.2");
  assert.ok(exists(root, ".cursor/skills/lint/SKILL.md"));
});

test("an archive is checked against its sha256", async (t) => {
  if (spawnSync("tar", ["--version"]).status !== 0) return t.skip("tar not available");
  const src = writeTree(tmp("deck-arch-src-"), { "kit/skills/zip-skill/SKILL.md": skill("zip-skill") });
  const out = path.join(tmp("deck-arch-"), "kit.tgz");
  spawnSync("tar", ["-czf", out, "-C", src, "kit"]);
  const bytes = fs.readFileSync(out);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes);
  try {
    const root = project();
    const request = { id: "kit", source: "archive:https://example.test/kit.tgz" };
    await installAll(root, { plugins: [request] }, null);
    const { sha256 } = readLockfile(root).plugins[0].resolved;
    assert.match(sha256, /^[0-9a-f]{64}$/);
    assert.ok(exists(root, ".claude/skills/zip-skill/SKILL.md"));
    await assert.rejects(
      installAll(project(), { plugins: [{ ...request, sha256: "0".repeat(64) }] }, null),
      /sha256 is/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("hosts can be turned off; without the claude CLI, native falls back to copy", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const request = { id: "demo", source: `git:${repo.url}`, plugin: "demo" };
  const { results } = await installAll(root, { plugins: [request], hosts: { cursor: "off" } }, null);
  assert.ok(exists(root, ".claude/skills/hello"));
  assert.ok(!exists(root, ".cursor/skills/hello"));
  assert.ok(results[0].warnings.some((w) => w.includes("CLI not found")));
});

test("Claude native mode registers .deck/ and installs each plugin from it", async () => {
  const fake = fakeClaude();
  process.env.DECK_CLAUDE_BIN = fake.bin;
  try {
    const repo = marketplaceRepo();
    const root = project();
    const request = { id: "demo", source: `git:${repo.url}`, plugin: "demo" };
    await installAll(root, { plugins: [request] }, null);

    assert.ok(!exists(root, ".claude/skills/hello"), "nothing copied for Claude");
    assert.ok(exists(root, ".cursor/skills/hello"), "Cursor still copies");
    assert.deepEqual(readState(root).plugins.demo.native, ["claude"]);
    const deckDir = path.join(root, ".deck");
    assert.deepEqual(fake.calls(), [
      `plugin marketplace add ${deckDir} --scope local`,
      "plugin install demo@deck --scope local",
    ]);
    assert.equal(readJson(path.join(deckDir, ".claude-plugin/marketplace.json")).plugins[0].name, "demo");

    const again = await installAll(root, { plugins: [request] }, readLockfile(root));
    assert.equal(again.results[0].skipped, true);
    assert.deepEqual(fake.calls().slice(2), [], "an unchanged plugin costs no claude call");

    await installAll(root, { plugins: [] }, readLockfile(root));
    assert.deepEqual(fake.calls().slice(-2), ["plugin uninstall demo@deck --scope local", "plugin marketplace remove deck"]);

    // Switching back to copy uninstalls the native plugin and copies files.
    await installAll(root, { plugins: [request] }, readLockfile(root));
    await installAll(root, { plugins: [request], hosts: { claude: "copy" } }, readLockfile(root));
    assert.ok(fake.calls().includes("plugin uninstall demo@deck --scope local"));
    assert.equal(fake.calls().at(-1), "plugin marketplace remove deck");
    assert.ok(exists(root, ".claude/skills/hello"));
  } finally {
    process.env.DECK_CLAUDE_BIN = "/nonexistent/claude";
  }
});

test("an unchanged plugin is skipped; a missing file, a mode change, or an edit reinstalls it", async () => {
  const repo = marketplaceRepo();
  const root = project();
  const doc = { plugins: [{ id: "demo", source: `git:${repo.url}`, plugin: "demo" }] };
  await installAll(root, doc, null);
  const skip = await installAll(root, doc, readLockfile(root));
  assert.equal(skip.results[0].skipped, true);

  fs.rmSync(path.join(root, ".cursor/skills/hello"), { recursive: true });
  const repaired = await installAll(root, doc, readLockfile(root));
  assert.equal(repaired.results[0].skipped, undefined);
  assert.ok(exists(root, ".cursor/skills/hello/SKILL.md"));

  const offCursor = await installAll(root, { ...doc, hosts: { cursor: "off" } }, readLockfile(root));
  assert.equal(offCursor.results[0].skipped, undefined);
  assert.ok(!exists(root, ".cursor/skills/hello"));

  fs.appendFileSync(path.join(root, ".deck/plugins/demo/skills/hello/SKILL.md"), "edit\n");
  const restored = await installAll(root, { ...doc, hosts: { cursor: "off" } }, readLockfile(root));
  assert.equal(restored.results[0].skipped, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".deck/plugins/demo/skills/hello/SKILL.md"), "utf8"), /edit/);
});

test("a pinned npm version or archive digest already in the cache is not fetched again", async () => {
  const cacheDir = path.join(process.env.DECK_CACHE, "npm", "deck-cached-only@1.0.0");
  writeTree(cacheDir, {
    "package/skills/cached/SKILL.md": skill("cached"),
    "resolved.json": { type: "npm", package: "deck-cached-only", version: "1.0.0" },
  });
  const root = project();
  // This package does not exist on the registry: only the cache can satisfy it.
  await installAll(root, { plugins: [{ id: "cached", source: "npm:deck-cached-only", version: "1.0.0" }] }, null);
  assert.ok(exists(root, ".claude/skills/cached/SKILL.md"));

  const digest = "a".repeat(64);
  writeTree(path.join(process.env.DECK_CACHE, "archive", digest), { "kit/skills/offline/SKILL.md": skill("offline") });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network used");
  };
  try {
    const other = project();
    await installAll(other, { plugins: [{ id: "kit", source: "archive:https://example.test/kit.zip", sha256: digest }] }, null);
    assert.ok(exists(other, ".cursor/skills/offline/SKILL.md"));
  } finally {
    globalThis.fetch = realFetch;
  }
});
