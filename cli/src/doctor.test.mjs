import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { doctor } from "./doctor.mjs";
import { installAll } from "./install.mjs";
import { readLockfile } from "./lockfile.mjs";
import { writePlugins } from "./plugins.mjs";
import { writeState, readState } from "./state.mjs";
import { gitRepo, skill, tmp, writeTree } from "./testkit.mjs";

process.env.DECK_CACHE = tmp("deck-cache-");
process.env.DECK_CLAUDE_BIN = "/nonexistent/claude";

async function installed(files = {}) {
  const repo = gitRepo(tmp("deck-doc-repo-"), {
    "skills/hello/SKILL.md": skill("hello"),
    "hooks/hooks.json": { hooks: { Stop: [] } },
    ...files,
  });
  const root = writeTree(tmp("deck-doc-"), { ".gitignore": "node_modules\n" });
  const doc = { plugins: [{ id: "demo", source: `git:${repo.url}` }] };
  writePlugins(root, doc);
  await installAll(root, doc, null);
  return root;
}

const levels = (findings, level) => findings.filter((f) => f.level === level).map((f) => f.message);

test("a fresh install is healthy, with warnings for inactive hooks", async () => {
  const root = await installed();
  const findings = doctor(root);
  assert.deepEqual(levels(findings, "error"), []);
  assert.ok(levels(findings, "warn").some((m) => m.includes("not active in Cursor")));
  assert.ok(levels(findings, "ok")[0].includes("1 plugin(s) match"));
});

test("reports a hand-edited plugin tree and missing installed files", async () => {
  const root = await installed();
  fs.appendFileSync(path.join(root, ".deck/plugins/demo/skills/hello/SKILL.md"), "edit\n");
  fs.rmSync(path.join(root, ".cursor/skills/hello"), { recursive: true });
  const errors = levels(doctor(root), "error");
  assert.ok(errors.some((m) => m.includes("differs from the lock")));
  assert.ok(errors.some((m) => m.includes("installed path(s) missing")));
});

test("reports a request changed since the lock, an unrequested lock entry, and an unlocked request", async () => {
  const root = await installed();
  const lock = readLockfile(root);
  writePlugins(root, { plugins: [{ ...lock.plugins[0].request, ref: "other" }, { id: "new", source: "npm:x" }] });
  let errors = levels(doctor(root), "error");
  assert.ok(errors.some((m) => m.includes("changed since the lock")));
  assert.ok(errors.some((m) => m.includes("requested but not locked")));
  writePlugins(root, { plugins: [] });
  errors = levels(doctor(root), "error");
  assert.ok(errors.some((m) => m.includes("no longer requested")));
});

test("checks .gitignore and native plugins against the claude CLI", async () => {
  const root = await installed();
  fs.appendFileSync(path.join(root, ".gitignore"), "ai-plugin.lock.json\n");
  const state = readState(root);
  state.plugins.demo.native = ["claude"];
  writeState(root, state);
  const fake = writeTree(tmp(), {
    claude: '#!/bin/sh\necho \'[{"id":"other@deck"}]\'\n',
  });
  fs.chmodSync(path.join(fake, "claude"), 0o755);
  const findings = doctor(root, { claude: () => path.join(fake, "claude") });
  assert.ok(levels(findings, "warn").some((m) => m.includes("commit it instead")));
  assert.ok(levels(findings, "error").some((m) => m.includes("does not list demo@deck")));
});

test("without ai-plugin.json there is one clear error", () => {
  assert.deepEqual(doctor(tmp()), [{ level: "error", message: "No ai-plugin.json. Run deck init or deck add." }]);
});
