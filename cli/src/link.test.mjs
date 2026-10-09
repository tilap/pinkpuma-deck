import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGithubCloneUrl } from "./github.mjs";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || args.join(" "));
}

function deck(project, cache, args) {
  return spawnSync(process.execPath, [cli, ...args, "--project", project], {
    encoding: "utf8",
    env: { ...process.env, DECK_CACHE: cache },
  });
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

function initCheckout(root) {
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "deck@example.com"]);
  git(root, ["config", "user.name", "deck"]);
  git(root, ["remote", "add", "origin", "https://github.com/acme/kit.git"]);
  writeTree(root, {
    ".claude-plugin/marketplace.json": JSON.stringify({
      name: "kit",
      plugins: [{ name: "demo", source: "./plugins/demo" }],
    }),
    "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({
      name: "demo",
      version: "0.1.0",
    }),
    "plugins/demo/skills/hello/SKILL.md": "# v1\n",
  });
  git(root, ["add", "."]);
  git(root, ["-c", "commit.gpgsign=false", "commit", "-m", "init"]);
}

test("parseGithubCloneUrl reads GitHub origins", () => {
  assert.equal(
    parseGithubCloneUrl("git@github.com:acme/kit.git"),
    "acme/kit",
  );
  assert.equal(
    parseGithubCloneUrl("https://github.com/acme/kit"),
    "acme/kit",
  );
  assert.equal(
    parseGithubCloneUrl("ssh://git@github.com/acme/kit.git"),
    "acme/kit",
  );
  assert.equal(parseGithubCloneUrl("https://gitlab.com/acme/kit.git"), null);
});

test("link installs the dirty working tree and leaves ai-plugin.json untouched", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-link-"));
  const checkout = path.join(tmp, "kit");
  const project = path.join(tmp, "app");
  const cache = path.join(tmp, "cache");
  fs.mkdirSync(checkout);
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(
    path.join(project, "ai-plugin.json"),
    `${JSON.stringify({ plugins: [] }, null, 2)}\n`,
  );
  const before = fs.readFileSync(path.join(project, "ai-plugin.json"), "utf8");
  initCheckout(checkout);
  fs.writeFileSync(path.join(checkout, "plugins/demo/skills/hello/SKILL.md"), "# v2 dirty\n");

  const linked = deck(project, cache, ["link", `${checkout}@demo`]);
  assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  assert.equal(fs.readFileSync(path.join(project, "ai-plugin.json"), "utf8"), before);
  assert.equal(
    fs.readFileSync(path.join(project, ".claude/skills/hello/SKILL.md"), "utf8"),
    "# v2 dirty\n",
  );
  assert.equal(
    fs.readFileSync(path.join(project, ".cursor/skills/hello/SKILL.md"), "utf8"),
    "# v2 dirty\n",
  );
  const local = JSON.parse(fs.readFileSync(path.join(project, "ai-plugin.local.json"), "utf8"));
  assert.equal(local.plugins[0].marketplace, "acme/kit");
  assert.equal(local.plugins[0].name, "demo");
  assert.equal(local.plugins[0].from, checkout);
  const ignore = fs.readFileSync(path.join(project, ".gitignore"), "utf8");
  assert.match(ignore, /^ai-plugin\.local\.json$/m);
  const listed = deck(project, cache, ["list"]);
  assert.match(listed.stdout, new RegExp(`local from=${checkout.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  fs.writeFileSync(path.join(checkout, "plugins/demo/skills/hello/SKILL.md"), "# v3\n");
  const synced = deck(project, cache, ["sync"]);
  assert.equal(synced.status, 0, synced.stderr || synced.stdout);
  assert.equal(
    fs.readFileSync(path.join(project, ".claude/skills/hello/SKILL.md"), "utf8"),
    "# v3\n",
  );

  const unlinked = deck(project, cache, ["unlink", "acme/kit@demo"]);
  assert.equal(unlinked.status, 0, unlinked.stderr || unlinked.stdout);
  assert.ok(!fs.existsSync(path.join(project, ".claude/skills/hello/SKILL.md")));
  assert.ok(!fs.existsSync(path.join(project, "ai-plugin.local.json")));
  assert.equal(fs.readFileSync(path.join(project, "ai-plugin.json"), "utf8"), before);
});

test("link refuses a checkout without a GitHub origin", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mk-link-"));
  const checkout = path.join(tmp, "kit");
  const project = path.join(tmp, "app");
  fs.mkdirSync(checkout);
  fs.mkdirSync(project);
  git(checkout, ["init", "-b", "main"]);
  const result = deck(project, path.join(tmp, "cache"), ["link", `${checkout}@demo`]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin/);
  assert.ok(!fs.existsSync(path.join(project, "ai-plugin.local.json")));
});
