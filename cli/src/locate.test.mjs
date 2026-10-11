import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { entryDescriptor, locatePlugin, skillName } from "./sources/locate.mjs";
import { skill, tmp, writeTree } from "./testkit.mjs";

const req = (extra = {}) => ({ id: "demo", source: "github:acme/kit", ...extra });
const names = (located) => located.components.skills.map((s) => s.name);

test("plugins/<name> without a marketplace", async () => {
  const root = writeTree(tmp(), {
    "plugins/demo/.claude-plugin/plugin.json": { name: "demo", version: "1.2.0" },
    "plugins/demo/skills/hello/SKILL.md": skill("hello"),
    "plugins/demo/agents/review/security.md": "# sec\n",
  });
  const located = await locatePlugin(root, req({ plugin: "demo" }));
  assert.equal(located.dir, path.join(root, "plugins/demo"));
  assert.deepEqual(names(located), ["hello"]);
  assert.deepEqual(located.components.agents.map((a) => a.rel), ["review/security.md"]);
  assert.equal(located.meta.version, "1.2.0");
});

test("marketplace string source, including a bare name under pluginRoot", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      metadata: { pluginRoot: "./tools" },
      plugins: [
        { name: "demo", source: "demo" },
        { name: "other", source: "./elsewhere/other" },
      ],
    },
    "tools/demo/skills/a/SKILL.md": skill("a"),
    "elsewhere/other/skills/b/SKILL.md": skill("b"),
  });
  assert.deepEqual(names(await locatePlugin(root, req({ plugin: "demo" }))), ["a"]);
  assert.deepEqual(names(await locatePlugin(root, req({ id: "other", plugin: "other" }))), ["b"]);
});

test("strict:false entry: only the skills it lists (anthropics/skills shape)", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [{ name: "docs", source: "./", strict: false, skills: ["./skills/pdf", "./skills/docx"] }],
    },
    "skills/pdf/SKILL.md": skill("pdf"),
    "skills/docx/SKILL.md": skill("docx"),
    "skills/art/SKILL.md": skill("art"),
  });
  assert.deepEqual(names(await locatePlugin(root, req({ plugin: "docs" }))), ["docx", "pdf"]);
});

test("strict:false entry with components conflicts with a plugin.json", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [{ name: "demo", source: "./p", strict: false, skills: ["./skills/a"] }],
    },
    "p/.claude-plugin/plugin.json": { name: "demo" },
    "p/skills/a/SKILL.md": skill("a"),
  });
  await assert.rejects(locatePlugin(root, req({ plugin: "demo" })), /conflicting manifests/);
});

test("strict entry components are added to plugin.json's", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [{ name: "demo", source: "./p", skills: ["./extra"] }],
    },
    "p/.claude-plugin/plugin.json": { name: "demo", skills: "./skills/" },
    "p/skills/a/SKILL.md": skill("a"),
    "p/extra/b/SKILL.md": skill("b"),
  });
  assert.deepEqual(names(await locatePlugin(root, req({ plugin: "demo" }))), ["a", "b"]);
});

test("custom component paths in plugin.json replace default folders", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/plugin.json": {
      name: "demo",
      skills: ["./custom"],
      agents: "./roles/reviewer.md",
      mcpServers: "./servers.json",
      hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "x" }] }] },
    },
    "custom/one/SKILL.md": skill("one"),
    "skills/ignored/SKILL.md": skill("ignored"),
    "roles/reviewer.md": "# r\n",
    "servers.json": { mcpServers: { db: { command: "db" } } },
  });
  const located = await locatePlugin(root, req());
  assert.deepEqual(names(located), ["one"]);
  assert.deepEqual(located.components.agents.map((a) => a.rel), ["reviewer.md"]);
  assert.deepEqual(Object.keys(located.components.mcpServers), ["db"]);
  assert.ok(located.components.hooks.inline.PostToolUse);
});

test("a Cursor marketplace and Cursor rules and commands", async () => {
  const root = writeTree(tmp(), {
    ".cursor-plugin/marketplace.json": { name: "m", plugins: [{ name: "demo", source: "./demo" }] },
    "demo/.cursor-plugin/plugin.json": { name: "demo" },
    "demo/rules/style.mdc": "---\nalwaysApply: true\n---\nx\n",
    "demo/commands/ship.md": "# ship\n",
    "demo/hooks/hooks.json": { version: 1, hooks: {} },
  });
  const located = await locatePlugin(root, req());
  assert.deepEqual(located.components.rules.map((r) => r.rel), ["style.mdc"]);
  assert.deepEqual(located.components.commands.map((r) => r.rel), ["ship.md"]);
  assert.ok(located.components.hooks.file.endsWith("hooks/hooks.json"));
});

test("object sources are fetched, pinned by the lock, and sub-pathed", async () => {
  const fetched = writeTree(tmp(), { "plugins/api/skills/scan/SKILL.md": skill("scan") });
  const calls = [];
  const fakeFetch = async (descriptor) => {
    calls.push(descriptor);
    return { root: fetched, resolved: { type: "git", url: descriptor.url, sha: "b".repeat(40) } };
  };
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [{ name: "api", source: { source: "git-subdir", url: "acme/mono", path: "plugins/api", ref: "v1" } }],
    },
  });
  const located = await locatePlugin(root, req({ plugin: "api" }), {
    fetch: fakeFetch,
    nested: { type: "git", url: "https://github.com/acme/mono.git", sha: "a".repeat(40) },
  });
  assert.deepEqual(names(located), ["scan"]);
  assert.equal(calls[0].url, "https://github.com/acme/mono.git");
  assert.equal(calls[0].ref, "v1");
  assert.equal(calls[0].sha, "a".repeat(40), "the lock pin wins over the entry ref");
  assert.equal(located.nested.sha, "b".repeat(40));
});

test("entryDescriptor covers every supported source and refuses the rest", () => {
  assert.equal(entryDescriptor("x", { source: "github", repo: "a/b", sha: "c" }).descriptor.sha, "c");
  assert.equal(entryDescriptor("x", { source: "url", url: "https://gitlab.com/a/b.git" }).descriptor.type, "git");
  assert.equal(entryDescriptor("x", { source: "npm", package: "@a/b", version: "^1" }).descriptor.version, "^1");
  assert.equal(entryDescriptor("x", { source: "archive", url: "https://x/a.zip" }).descriptor.type, "archive");
  assert.throws(() => entryDescriptor("x", { source: "command", command: "ls" }), /not supported/);
  assert.throws(() => entryDescriptor("x", { source: "git-subdir", url: "a/b" }), /needs url and path/);
});

test("a repository of skills, with a skills filter", async () => {
  const root = writeTree(tmp(), {
    "skills/a/SKILL.md": skill("a"),
    "skills/b/SKILL.md": skill("b"),
    "README.md": "# skills\n",
  });
  assert.deepEqual(names(await locatePlugin(root, req())), ["a", "b"]);
  assert.deepEqual(names(await locatePlugin(root, req({ skills: ["b"] }))), ["b"]);
  await assert.rejects(locatePlugin(root, req({ skills: ["zzz"] })), /zzz not found\. Available: a, b/);
});

test("a single SKILL.md at the root, named by its front matter", async () => {
  const root = writeTree(tmp(), { "SKILL.md": skill("root-skill"), "scripts/run.sh": "echo\n" });
  const located = await locatePlugin(root, req());
  assert.deepEqual(names(located), ["root-skill"]);
  assert.equal(skillName(root), "root-skill");
});

test("request path narrows the source before anything else", async () => {
  const root = writeTree(tmp(), { "packages/kit/skills/a/SKILL.md": skill("a") });
  assert.deepEqual(names(await locatePlugin(root, req({ path: "packages/kit" }))), ["a"]);
  await assert.rejects(locatePlugin(root, req({ path: "nope" })), /does not exist/);
});

test("several plugins and no choice: the error lists them", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [
        { name: "a", source: "./a" },
        { name: "b", source: "./b" },
      ],
    },
  });
  await assert.rejects(locatePlugin(root, req()), /Available: a, b/);
  await assert.rejects(locatePlugin(root, req({ plugin: "c" })), /no plugin "c"/);
});

test("nothing to install is an error", async () => {
  const root = writeTree(tmp(), { "README.md": "hi\n" });
  await assert.rejects(locatePlugin(root, req()), /nothing to install/);
});

test("a source path cannot leave the marketplace", async () => {
  const root = writeTree(tmp(), {
    ".claude-plugin/marketplace.json": { name: "m", plugins: [{ name: "demo", source: "../outside" }] },
  });
  await assert.rejects(locatePlugin(root, req()), /leaves the source directory/);
});
