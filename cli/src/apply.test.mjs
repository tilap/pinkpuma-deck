import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installFromPluginDir, uninstallEntry } from "./apply.mjs";

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

  uninstallEntry(project, entry);
  assert.ok(!fs.existsSync(path.join(project, ".claude/skills/hello")));
  assert.ok(!fs.existsSync(path.join(project, ".mcp.json")));
});
