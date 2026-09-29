import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installFromPluginDir, pruneStaleEntries, removeInstalledFiles } from "./apply.mjs";

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

test("installFromPluginDir copies skills, agents, and mcp for both hosts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-apply-"));
  const plugin = path.join(tmp, "plugin");
  const project = path.join(tmp, "project");
  fs.mkdirSync(project);

  writeTree(plugin, {
    ".claude-plugin/plugin.json": JSON.stringify({
      name: "demo",
      version: "0.2.0",
    }),
    "skills/hello/SKILL.md": "---\nname: hello\ndescription: hi\n---\n# Hello\n",
    "agents/reviewer.md": "# Reviewer\n",
    "mcp.json": JSON.stringify({
      mcpServers: { demo: { command: "echo", args: ["1"] } },
    }),
  });

  const entry = {
    marketplace: "acme/kit",
    name: "demo",
    ref: "main",
  };
  const result = installFromPluginDir(project, entry, plugin);
  assert.equal(result.skills, 1);
  assert.equal(result.agents, 1);
  assert.equal(result.mcp, 1);
  assert.equal(result.pluginVersion, "0.2.0");
  assert.ok(result.record.paths.includes(".claude/skills/hello"));
  assert.ok(result.record.paths.includes(".cursor/skills/hello"));
  assert.deepEqual(result.record.mcpKeys[".mcp.json"], ["deck__acme_kit__demo__demo"]);

  assert.ok(
    fs.existsSync(path.join(project, ".claude/skills/hello/SKILL.md")),
  );
  assert.ok(
    fs.existsSync(path.join(project, ".cursor/skills/hello/SKILL.md")),
  );
  assert.ok(fs.existsSync(path.join(project, ".claude/agents/reviewer.md")));
  assert.ok(fs.existsSync(path.join(project, ".cursor/agents/reviewer.md")));

  const claudeMcp = JSON.parse(
    fs.readFileSync(path.join(project, ".mcp.json"), "utf8"),
  );
  const cursorMcp = JSON.parse(
    fs.readFileSync(path.join(project, ".cursor/mcp.json"), "utf8"),
  );
  const key = "deck__acme_kit__demo__demo";
  assert.ok(claudeMcp.mcpServers[key]);
  assert.ok(cursorMcp.mcpServers[key]);

  removeInstalledFiles(project, result.record);
  assert.ok(!fs.existsSync(path.join(project, ".claude/skills/hello")));
  assert.ok(!fs.existsSync(path.join(project, ".mcp.json")));
});

test("install replaces an existing agent and remove deletes it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-apply-"));
  const plugin = path.join(tmp, "plugin");
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".claude/agents"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".claude/agents/reviewer.md"),
    "# USER OWNED\n",
  );
  writeTree(plugin, {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
    "agents/reviewer.md": "# Plugin reviewer\n",
    "agents/other.md": "# Other\n",
  });
  const entry = { marketplace: "acme/kit", name: "demo", ref: "main" };
  const result = installFromPluginDir(project, entry, plugin);
  assert.equal(
    fs.readFileSync(path.join(project, ".claude/agents/reviewer.md"), "utf8"),
    "# Plugin reviewer\n",
  );
  assert.ok(result.record.paths.includes(".claude/agents/reviewer.md"));

  removeInstalledFiles(project, result.record);
  assert.ok(!fs.existsSync(path.join(project, ".claude/agents/reviewer.md")));
  assert.ok(!fs.existsSync(path.join(project, ".claude/agents/other.md")));
});

test("support files are copied per plugin and skill links are rewritten", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-apply-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(project);
  const first = path.join(tmp, "first");
  const second = path.join(tmp, "second");
  writeTree(first, {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "one", version: "1.0.0" }),
    "CONVENTIONS.md": "# one\n",
    "skills/commit/SKILL.md": "See [../../CONVENTIONS.md](../../CONVENTIONS.md).\n",
  });
  writeTree(second, {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "two", version: "1.0.0" }),
    "CONVENTIONS.md": "# two\n",
    "templates/publish-npm.yml": "name: publish\n",
    "skills/setup/SKILL.md":
      "See [../../CONVENTIONS.md](../../CONVENTIONS.md) and [../../templates/publish-npm.yml](../../templates/publish-npm.yml).\n",
  });
  const entryOne = { marketplace: "acme/kit", name: "one", ref: "main" };
  const entryTwo = { marketplace: "acme/kit", name: "two", ref: "main" };
  installFromPluginDir(project, entryOne, first);
  installFromPluginDir(project, entryTwo, second);

  const commit = fs.readFileSync(path.join(project, ".claude/skills/commit/SKILL.md"), "utf8");
  const setup = fs.readFileSync(path.join(project, ".claude/skills/setup/SKILL.md"), "utf8");
  const commitHref = commit.match(/\(([^)]+CONVENTIONS\.md)\)/)[1];
  const setupHref = setup.match(/\(([^)]+CONVENTIONS\.md)\)/)[1];
  const templateHref = setup.match(/\(([^)]+publish-npm\.yml)\)/)[1];
  const commitFile = path.resolve(path.join(project, ".claude/skills/commit"), commitHref);
  const setupFile = path.resolve(path.join(project, ".claude/skills/setup"), setupHref);
  const templateFile = path.resolve(path.join(project, ".claude/skills/setup"), templateHref);
  assert.notEqual(commitFile, setupFile);
  assert.equal(fs.readFileSync(commitFile, "utf8"), "# one\n");
  assert.equal(fs.readFileSync(setupFile, "utf8"), "# two\n");
  assert.equal(fs.readFileSync(templateFile, "utf8"), "name: publish\n");
});

test("pruneStaleEntries removes plugins missing from the request", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-apply-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(project);
  const keepDir = path.join(tmp, "keep");
  const dropDir = path.join(tmp, "drop");
  writeTree(keepDir, { "skills/keep/SKILL.md": "# keep\n" });
  writeTree(dropDir, { "skills/drop/SKILL.md": "# drop\n" });
  const keep = { marketplace: "acme/kit", name: "keep", ref: "main" };
  const drop = { marketplace: "acme/kit", name: "drop", ref: "main" };
  const keepResult = installFromPluginDir(project, keep, keepDir);
  const dropResult = installFromPluginDir(project, drop, dropDir);
  const lock = {
    lockfileVersion: 2,
    plugins: [
      { ...keepResult.record, resolved: "aaa" },
      { ...dropResult.record, resolved: "bbb" },
    ],
  };
  const pruned = pruneStaleEntries(project, { plugins: [keep] }, lock);
  assert.deepEqual(pruned.removed, ["acme/kit@drop"]);
  assert.equal(pruned.lock.plugins.length, 1);
  assert.equal(pruned.lock.plugins[0].name, "keep");
  assert.ok(fs.existsSync(path.join(project, ".claude/skills/keep/SKILL.md")));
  assert.ok(!fs.existsSync(path.join(project, ".claude/skills/drop/SKILL.md")));
});

test("reinstall deletes a skill the plugin no longer ships", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-apply-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(project);
  const before = path.join(tmp, "before");
  const after = path.join(tmp, "after");
  writeTree(before, {
    "skills/gone/SKILL.md": "# gone\n",
    "skills/stay/SKILL.md": "# stay v1\n",
  });
  writeTree(after, {
    "skills/stay/SKILL.md": "# stay v2\n",
  });
  const entry = { marketplace: "acme/kit", name: "demo", ref: "main" };
  const first = installFromPluginDir(project, entry, before);
  const second = installFromPluginDir(project, entry, after, {
    ...first.record,
    resolved: "aaa",
  });
  assert.equal(
    fs.readFileSync(path.join(project, ".claude/skills/stay/SKILL.md"), "utf8"),
    "# stay v2\n",
  );
  assert.ok(!fs.existsSync(path.join(project, ".claude/skills/gone")));
  assert.ok(!second.record.paths.includes(".claude/skills/gone"));
  assert.ok(second.record.paths.includes(".claude/skills/stay"));
});
