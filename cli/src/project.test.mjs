import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { activeProfile, listProfiles, loadProject } from "./project.mjs";
import { clearProfile, createProfile, CURSOR_RULE, IMPORT_LINE, useProfile } from "./profiles.mjs";
import { readJson, tmp, writeTree } from "./testkit.mjs";

const lockEntry = (id) => ({
  id,
  request: { id, source: "github:a/b" },
  resolved: { type: "git", url: "u", sha: "a".repeat(40) },
  integrity: "sha256-x",
  components: { skills: [], agents: [], commands: [], rules: [], hooks: false, mcp: [] },
  agentsSnippets: [],
});

function project() {
  return writeTree(tmp("deck-proj-"), {
    "ai-plugin.json": { plugins: [{ id: "base-a", source: "github:a/b" }], agentsMd: false },
    "ai-plugin.lock.json": { lockfileVersion: 3, writeAgentsMd: true, plugins: [lockEntry("base-a")] },
    ".ai/profiles/builder/ai-plugin.json": { plugins: [{ id: "prof-b", source: "github:a/b" }] },
    ".ai/profiles/builder/ai-plugin.lock.json": { lockfileVersion: 3, writeAgentsMd: true, plugins: [lockEntry("prof-b")] },
    ".ai/profiles/tester/ai-plugin.json": { plugins: [] },
    ".ai/profiles/notes/readme.md": "not a profile\n",
  });
}

test("the base alone, then base + active profile, merged and split back", () => {
  const root = project();
  assert.deepEqual(listProfiles(root), ["builder", "tester"]);
  assert.equal(loadProject(root).profile, null);
  assert.deepEqual(loadProject(root).doc.plugins.map((p) => p.id), ["base-a"]);

  fs.symlinkSync("profiles/builder", path.join(root, ".ai/current"));
  const merged = loadProject(root);
  assert.equal(activeProfile(root), "builder");
  assert.deepEqual(merged.doc.plugins.map((p) => p.id), ["base-a", "prof-b"]);
  assert.deepEqual(merged.lock.plugins.map((p) => p.id), ["base-a", "prof-b"]);
  assert.equal(merged.lock.writeAgentsMd, false, "agentsMd comes from the base ai-plugin.json");

  merged.saveLock({ ...merged.lock, plugins: [lockEntry("base-a"), lockEntry("prof-b")] });
  assert.deepEqual(readJson(path.join(root, "ai-plugin.lock.json")).plugins.map((p) => p.id), ["base-a"]);
  assert.deepEqual(readJson(path.join(root, ".ai/profiles/builder/ai-plugin.lock.json")).plugins.map((p) => p.id), ["prof-b"]);
});

test("an id in both the base and the profile is refused", () => {
  const root = project();
  writeTree(root, { ".ai/profiles/builder/ai-plugin.json": { plugins: [{ id: "base-a", source: "npm:x" }] } });
  assert.throws(() => loadProject(root, { profile: "builder" }), /requested by both/);
});

test("profile use and off wire the prompt for Claude and Cursor, and only that", () => {
  const root = writeTree(tmp("deck-prof-"), { "CLAUDE.md": "# Rules\n", ".gitignore": "node_modules\n" });
  createProfile(root, "builder");
  assert.throws(() => createProfile(root, "builder"), /already exists/);
  assert.throws(() => createProfile(root, "current"), /Invalid profile name/);

  useProfile(root, "builder");
  useProfile(root, "builder");
  assert.equal(fs.readlinkSync(path.join(root, ".ai/current")), "profiles/builder");
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), `# Rules\n\n${IMPORT_LINE}\n`);
  assert.match(fs.readFileSync(path.join(root, CURSOR_RULE), "utf8"), /alwaysApply: true[\s\S]*You are the builder agent/);
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), "node_modules\n", "deck install owns .gitignore, not profile use");

  clearProfile(root);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "# Rules\n");
  assert.ok(!fs.existsSync(path.join(root, CURSOR_RULE)));
  assert.equal(activeProfile(root), null);
});
