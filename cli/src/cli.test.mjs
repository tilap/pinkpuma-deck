import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitRepo, readJson, skill, tmp, writeTree } from "./testkit.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");
const env = { ...process.env, DECK_CACHE: tmp("deck-cache-"), DECK_CLAUDE_BIN: "/nonexistent/claude" };

function deck(root, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args, "-C", root], { encoding: "utf8", env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function market() {
  return gitRepo(tmp("deck-cli-market-"), {
    ".claude-plugin/marketplace.json": {
      name: "m",
      plugins: [
        { name: "base-kit", source: "./plugins/base-kit" },
        { name: "build-kit", source: "./plugins/build-kit" },
        { name: "test-kit", source: "./plugins/test-kit" },
      ],
    },
    "plugins/base-kit/skills/commit/SKILL.md": skill("commit"),
    "plugins/build-kit/skills/pdf/SKILL.md": skill("pdf"),
    "plugins/test-kit/skills/e2e/SKILL.md": skill("e2e"),
  });
}

const has = (root, rel) => fs.existsSync(path.join(root, rel));

test("profiles: add to the base and to profiles, switch, and turn off", () => {
  const repo = market();
  const root = writeTree(tmp("deck-cli-"), { ".gitignore": "node_modules\n" });
  const src = (name) => `git+${repo.url}@${name}`;

  assert.equal(deck(root, "add", src("base-kit")).code, 0);
  assert.equal(deck(root, "profile", "new", "builder").code, 0);
  assert.equal(deck(root, "profile", "new", "tester").code, 0);
  const lockedOnly = deck(root, "add", src("build-kit"), "--profile", "builder");
  assert.equal(lockedOnly.code, 0, lockedOnly.err);
  assert.match(lockedOnly.out, /not active/);
  assert.ok(!has(root, ".claude/skills/pdf"), "an inactive profile is locked, not installed");
  assert.ok(readJson(path.join(root, ".ai/builder/ai-plugin.lock.json")).plugins[0].resolved.sha);
  assert.equal(deck(root, "add", src("test-kit"), "--profile", "tester").code, 0);

  const use = deck(root, "profile", "use", "builder");
  assert.equal(use.code, 0, use.err);
  assert.ok(has(root, ".claude/skills/commit") && has(root, ".claude/skills/pdf"));
  assert.match(use.out, /base-kit .*\(up to date\)/);

  const swap = deck(root, "profile", "use", "tester");
  assert.equal(swap.code, 0, swap.err);
  assert.match(swap.out, /- build-kit \(no longer requested\)/);
  assert.ok(has(root, ".cursor/skills/e2e") && !has(root, ".cursor/skills/pdf") && has(root, ".cursor/skills/commit"));
  assert.deepEqual(readJson(path.join(root, "ai-plugin.lock.json")).plugins.map((p) => p.id), ["base-kit"]);

  const st = deck(root, "status");
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /Profile: tester/);
  assert.match(st.out, /test-kit {2}\[profile tester\]/);
  assert.match(deck(root, "profile", "list").out, /\* tester/);

  assert.equal(deck(root, "profile", "off").code, 0);
  assert.ok(!has(root, ".cursor/skills/e2e") && has(root, ".cursor/skills/commit"));
  assert.ok(!has(root, ".ai/current"));
});

test("options a command does not take are refused", () => {
  const root = tmp("deck-cli-");
  const r = deck(root, "status", "--frozen");
  assert.equal(r.code, 1);
  assert.match(r.err, /deck status does not take --frozen/);
  assert.match(deck(root, "install", "--bogus").err, /Unknown option: --bogus/);
  assert.match(deck(root, "nope").err, /Unknown command: nope/);
});

test("deprecated commands and flags still work and say what replaces them", () => {
  const repo = market();
  const root = tmp("deck-cli-");
  const init = deck(root, "init");
  assert.equal(init.code, 0);
  assert.match(init.err, /"init" is deprecated/);

  const add = deck(root, "add", `git+${repo.url}`, "--plugin", "base-kit");
  assert.equal(add.code, 0, add.err);
  assert.match(add.err, /--plugin is deprecated/);

  const sync = deck(root, "sync", "--no-agents-md");
  assert.equal(sync.code, 0, sync.err);
  assert.match(sync.err, /"sync" is deprecated: use deck install/);
  assert.equal(readJson(path.join(root, "ai-plugin.json")).agentsMd, false);

  assert.match(deck(root, "list").err, /"list" is deprecated: use deck status/);
  assert.match(deck(root, "doctor").err, /"doctor" is deprecated: use deck status/);
});
