import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyInstall, removeInstalledFiles } from "./hosts/copy.mjs";
import { emptyState } from "./state.mjs";
import { readJson, skill, tmp, writeTree } from "./testkit.mjs";

function plugin(files) {
  return writeTree(tmp(), {
    ".claude-plugin/plugin.json": { name: "demo" },
    ".cursor-plugin/plugin.json": { name: "demo" },
    ...files,
  });
}

const both = { hosts: ["claude", "cursor"] };

test("copies skills, agents, commands, rules, and MCP for both hosts", () => {
  const dir = plugin({
    "skills/hello/SKILL.md": skill("hello"),
    "agents/review/sec.md": "# s\n",
    "commands/ship.md": "# ship\n",
    "rules/style.mdc": "x\n",
    "mcp.json": { mcpServers: { db: { command: "${CLAUDE_PLUGIN_ROOT}/bin/db", args: ["--x"] } } },
    "bin/db": "#!/bin/sh\n",
  });
  const project = tmp();
  const result = copyInstall(project, "demo", dir, { ...both, state: emptyState() });
  for (const rel of [
    ".claude/skills/hello/SKILL.md",
    ".cursor/skills/hello/SKILL.md",
    ".claude/agents/review/sec.md",
    ".cursor/agents/review/sec.md",
    ".claude/commands/demo/ship.md",
    ".cursor/commands/demo/ship.md",
    ".cursor/rules/demo/style.mdc",
    ".claude/plugins/demo/bin/db",
  ]) {
    assert.ok(fs.existsSync(path.join(project, rel)), rel);
  }
  assert.ok(!fs.existsSync(path.join(project, ".claude/rules")));
  assert.deepEqual(readJson(path.join(project, ".mcp.json")).mcpServers.deck__demo__db, {
    command: "./.claude/plugins/demo/bin/db",
    args: ["--x"],
  });
  assert.equal(readJson(path.join(project, ".cursor/mcp.json")).mcpServers.deck__demo__db.command, "./.cursor/plugins/demo/bin/db");
  assert.ok(result.warnings.some((w) => w.includes("rule")));
});

test("support files are per plugin and skill links and root variables are rewritten", () => {
  const dir = plugin({
    "skills/hello/SKILL.md": `${skill("hello")}See [conv](../../CONVENTIONS.md). Run \${CLAUDE_PLUGIN_ROOT}/scripts/x.sh\n`,
    "CONVENTIONS.md": "# c\n",
    "scripts/x.sh": "echo\n",
  });
  const project = tmp();
  copyInstall(project, "demo", dir, { hosts: ["claude"], state: emptyState() });
  const text = fs.readFileSync(path.join(project, ".claude/skills/hello/SKILL.md"), "utf8");
  assert.match(text, /\(\.\.\/\.\.\/plugins\/demo\/CONVENTIONS\.md\)/);
  assert.match(text, /Run \.claude\/plugins\/demo\/scripts\/x\.sh/);
});

test("refuses a skill path another plugin owns, or one deck did not write", () => {
  const dir = plugin({ "skills/hello/SKILL.md": skill("hello") });
  const project = tmp();
  const state = emptyState();
  state.plugins.other = { paths: [".claude/skills/hello"], mcpKeys: {} };
  assert.throws(() => copyInstall(project, "demo", dir, { hosts: ["claude"], state }), /already installed by "other"/);

  writeTree(project, { ".cursor/skills/hello/SKILL.md": "mine\n" });
  assert.throws(
    () => copyInstall(project, "demo", dir, { hosts: ["cursor"], state: emptyState() }),
    /was not written by deck/,
  );
  copyInstall(project, "demo", dir, { hosts: ["cursor"], state: emptyState(), force: true });
  assert.match(fs.readFileSync(path.join(project, ".cursor/skills/hello/SKILL.md"), "utf8"), /name: hello/);
});

test("reinstall over its own paths, then remove everything it wrote", () => {
  const dir = plugin({
    "skills/hello/SKILL.md": skill("hello"),
    "rules/style.mdc": "x\n",
    "mcp.json": { mcpServers: { db: { command: "db" } } },
  });
  const project = tmp();
  writeTree(project, { ".mcp.json": { mcpServers: { mine: { command: "keep" } } } });
  const first = copyInstall(project, "demo", dir, { ...both, state: emptyState() });
  const state = { version: 1, plugins: { demo: { paths: first.paths, mcpKeys: first.mcpKeys } } };
  const again = copyInstall(project, "demo", dir, { ...both, state, previous: state.plugins.demo });
  removeInstalledFiles(project, { paths: again.paths, mcpKeys: again.mcpKeys });
  assert.ok(!fs.existsSync(path.join(project, ".claude/skills/hello")));
  assert.ok(!fs.existsSync(path.join(project, ".cursor/rules/demo")));
  assert.ok(fs.existsSync(path.join(project, ".cursor/rules")), "host folders stay");
  assert.ok(!fs.existsSync(path.join(project, ".cursor/mcp.json")));
  assert.deepEqual(Object.keys(readJson(path.join(project, ".mcp.json")).mcpServers), ["mine"]);
});
