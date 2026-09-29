import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffoldMarketplace } from "./scaffold.mjs";

function tempParent() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deck-scaffold-"));
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
