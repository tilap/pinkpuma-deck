import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { materialize, pluginName, treeIntegrity, writeDeckMarketplace } from "./materialize.mjs";
import { locatePlugin } from "./sources/locate.mjs";
import { readJson, skill, tmp, writeTree } from "./testkit.mjs";

async function build(files, request = {}, options = {}) {
  const source = writeTree(tmp(), files);
  const project = tmp();
  const located = await locatePlugin(source, { id: "Demo.Kit", source: "github:a/b", ...request });
  return { project, source, built: materialize(project, request.id ?? "Demo.Kit", located, options) };
}

test("writes the selected components in plugin layout with generated manifests", async () => {
  const { project, built } = await build(
    {
      ".claude-plugin/plugin.json": { name: "upstream", description: "d", author: { name: "A" } },
      "skills/hello/SKILL.md": skill("hello"),
      "skills/hello/DEFAULT_USAGE.md": "- use hello\n",
      "skills/bye/SKILL.md": skill("bye"),
      "agents/review.md": "# r\n",
      "commands/ship.md": "# ship\n",
      "rules/style.mdc": "x\n",
      "hooks/hooks.json": { hooks: { Stop: [] } },
      "mcp.json": { mcpServers: { db: { command: "${CLAUDE_PLUGIN_ROOT}/bin/db" } } },
      "CONVENTIONS.md": "# c\n",
      ".grok-plugin/plugin.json": {},
    },
    { skills: ["hello"] },
    { fallbackVersion: "0.0.0-deck.abc" },
  );
  const dir = path.join(project, ".deck/plugins/Demo.Kit");
  assert.equal(built.dir, dir);
  assert.ok(fs.existsSync(path.join(dir, "skills/hello/SKILL.md")));
  assert.ok(!fs.existsSync(path.join(dir, "skills/hello/DEFAULT_USAGE.md")));
  assert.ok(!fs.existsSync(path.join(dir, "skills/bye")), "unselected skill is not written");
  for (const rel of ["agents/review.md", "commands/ship.md", "rules/style.mdc", "hooks/hooks.json", "mcp.json", "CONVENTIONS.md"]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  }
  assert.ok(!fs.existsSync(path.join(dir, ".grok-plugin")));
  const claude = readJson(path.join(dir, ".claude-plugin/plugin.json"));
  assert.deepEqual(claude, { name: "demo-kit", version: "0.0.0-deck.abc", description: "d", author: { name: "A" } });
  assert.deepEqual(readJson(path.join(dir, ".cursor-plugin/plugin.json")), claude);
  assert.equal(readJson(path.join(dir, "plugin.json")).name, "demo-kit");
  assert.deepEqual(built.agentsSnippets, [{ skill: "hello", body: "- use hello" }]);
  assert.deepEqual(built.components, {
    skills: ["hello"],
    agents: ["review.md"],
    commands: ["ship.md"],
    rules: ["style.mdc"],
    hooks: true,
    mcp: ["db"],
  });
});

test("inline hooks are written as hooks/hooks.json", async () => {
  const { built } = await build({
    ".claude-plugin/plugin.json": { name: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "y" }] }] } },
    "skills/a/SKILL.md": skill("a"),
  });
  assert.ok(readJson(path.join(built.dir, "hooks/hooks.json")).hooks.Stop);
});

test("a root SKILL.md becomes skills/<name> without duplicating support files", async () => {
  const { built } = await build({ "SKILL.md": skill("solo"), "scripts/run.sh": "echo\n" });
  assert.ok(fs.existsSync(path.join(built.dir, "skills/solo/scripts/run.sh")));
  assert.ok(!fs.existsSync(path.join(built.dir, "scripts")));
});

test("integrity is stable and follows content", async () => {
  const files = { "skills/a/SKILL.md": skill("a") };
  const one = await build(files);
  const two = await build(files);
  assert.equal(one.built.integrity, two.built.integrity);
  fs.appendFileSync(path.join(one.built.dir, "skills/a/SKILL.md"), "more\n");
  assert.notEqual(treeIntegrity(one.built.dir), two.built.integrity);
});

test("the deck marketplace lists every normalized plugin", () => {
  const project = tmp();
  const file = writeDeckMarketplace(project, ["b", "A.x"]);
  assert.deepEqual(readJson(file).plugins, [
    { name: "a-x", source: "./plugins/A.x" },
    { name: "b", source: "./plugins/b" },
  ]);
  assert.equal(pluginName("--Weird__Name--"), "weird-name");
});
