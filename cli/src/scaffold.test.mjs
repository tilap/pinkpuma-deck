import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffoldMarketplace, scaffoldPlugin } from "./scaffold.mjs";

function tempParent() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deck-scaffold-"));
}

function scaffoldedMarketplace() {
  const parent = tempParent();
  const { root } = scaffoldMarketplace({
    name: "demo-market",
    owner: "Julien La Vinh",
    parentDir: parent,
  });
  return root;
}

test("scaffold creates marketplace tree with owner and name", () => {
  const parent = tempParent();
  const { root } = scaffoldMarketplace({
    name: "my-marketplace",
    owner: "Julien La Vinh",
    parentDir: parent,
  });

  assert.equal(root, path.join(parent, "my-marketplace"));
  assert.ok(fs.existsSync(path.join(root, "plugins", ".gitkeep")));
  assert.ok(fs.existsSync(path.join(root, ".gitignore")));
  assert.ok(fs.existsSync(path.join(root, "README.md")));
  assert.ok(fs.existsSync(path.join(root, "HOWTO.md")));
  assert.ok(fs.existsSync(path.join(root, "AGENTS.md")));

  const market = JSON.parse(
    fs.readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  assert.equal(market.name, "my-marketplace");
  assert.equal(market.owner.name, "Julien La Vinh");
  assert.deepEqual(market.plugins, []);

  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /DEFAULT_USAGE\.md/);
  assert.match(agents, /consumer project's/);
  assert.equal(agents.includes("{{NAME}}"), false);
  assert.equal(agents.includes("{{OWNER}}"), false);
  assert.match(agents, /Julien La Vinh/);
  assert.match(agents, /my-marketplace/);
  assert.match(agents, /domain/);
  assert.match(agents, /If the `<skill-name>` skill is available/);
  assert.match(agents, /If the `commit` skill is available/);

  const howto = fs.readFileSync(path.join(root, "HOWTO.md"), "utf8");
  assert.match(howto, /scaffold plugin/);
});

test("scaffold refuses invalid name", () => {
  const parent = tempParent();
  assert.throws(
    () =>
      scaffoldMarketplace({
        name: "Bad_Name",
        owner: "Someone",
        parentDir: parent,
      }),
    /Invalid marketplace name/,
  );
});

test("scaffold refuses missing owner", () => {
  const parent = tempParent();
  assert.throws(
    () =>
      scaffoldMarketplace({
        name: "ok-name",
        owner: "  ",
        parentDir: parent,
      }),
    /--owner/,
  );
});

test("scaffold refuses non-empty target", () => {
  const parent = tempParent();
  const target = path.join(parent, "taken");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "existing.txt"), "x");
  assert.throws(
    () =>
      scaffoldMarketplace({
        name: "taken",
        owner: "Someone",
        parentDir: parent,
      }),
    /not empty/,
  );
});

test("scaffold plugin creates dual manifests, skill, and registers marketplace", () => {
  const marketRoot = scaffoldedMarketplace();
  const { root, readmeUpdated, warnings } = scaffoldPlugin({
    name: "my-plugin",
    description: "Helps with example tasks.",
    marketplaceDir: marketRoot,
  });

  assert.equal(root, path.join(marketRoot, "plugins", "my-plugin"));
  assert.equal(readmeUpdated, true);
  assert.deepEqual(warnings, []);

  const claude = JSON.parse(
    fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const cursor = JSON.parse(
    fs.readFileSync(path.join(root, ".cursor-plugin", "plugin.json"), "utf8"),
  );
  assert.deepEqual(claude, cursor);
  assert.equal(claude.name, "my-plugin");
  assert.equal(claude.version, "0.1.0");
  assert.equal(claude.description, "Helps with example tasks.");
  assert.equal(claude.author.name, "Julien La Vinh");

  const skill = fs.readFileSync(
    path.join(root, "skills", "my-plugin", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /^---\nname: my-plugin\n/m);
  assert.match(skill, /Helps with example tasks\./);
  assert.equal(skill.includes("{{"), false);

  const usage = fs.readFileSync(
    path.join(root, "skills", "my-plugin", "DEFAULT_USAGE.md"),
    "utf8",
  );
  assert.match(
    usage,
    /- \*\*my-plugin\.\*\* If the `my-plugin` skill is available, follow it when: Helps with example tasks\./,
  );

  const market = JSON.parse(
    fs.readFileSync(path.join(marketRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  assert.deepEqual(market.plugins, [
    {
      name: "my-plugin",
      source: "./plugins/my-plugin",
      description: "Helps with example tasks.",
    },
  ]);

  const readme = fs.readFileSync(path.join(marketRoot, "README.md"), "utf8");
  assert.match(
    readme,
    /\| \[my-plugin\]\(plugins\/my-plugin\) \| Helps with example tasks\. \|/,
  );
});

test("scaffold plugin inherits owner from marketplace when --owner omitted", () => {
  const marketRoot = scaffoldedMarketplace();
  const { root } = scaffoldPlugin({
    name: "owned-plugin",
    description: "Owner from marketplace.",
    marketplaceDir: marketRoot,
  });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(manifest.author.name, "Julien La Vinh");
});

test("scaffold plugin refuses missing marketplace", () => {
  const dir = tempParent();
  assert.throws(
    () =>
      scaffoldPlugin({
        name: "x",
        description: "y",
        marketplaceDir: dir,
      }),
    /Not a marketplace root/,
  );
});

test("scaffold plugin refuses missing description", () => {
  const marketRoot = scaffoldedMarketplace();
  assert.throws(
    () =>
      scaffoldPlugin({
        name: "x",
        description: "  ",
        marketplaceDir: marketRoot,
      }),
    /--description/,
  );
});

test("scaffold plugin refuses existing plugin directory", () => {
  const marketRoot = scaffoldedMarketplace();
  scaffoldPlugin({
    name: "dup",
    description: "first",
    marketplaceDir: marketRoot,
  });
  assert.throws(
    () =>
      scaffoldPlugin({
        name: "dup",
        description: "second",
        marketplaceDir: marketRoot,
      }),
    /already (exists|listed)/,
  );
});
