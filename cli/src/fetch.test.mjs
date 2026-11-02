import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gitRepo, skill, tmp } from "./testkit.mjs";

const fetchModule = fileURLToPath(new URL("./sources/fetch.mjs", import.meta.url));

function fetchInChild(cache, descriptor) {
  const script = `
    import { fetchSource } from ${JSON.stringify(fetchModule)};
    const r = await fetchSource(${JSON.stringify(descriptor)});
    console.log(JSON.stringify(r));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, DECK_CACHE: cache },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `exit ${code}`)),
    );
  });
}

test("concurrent processes fetch the same commit into an empty cache", async () => {
  const repo = gitRepo(tmp("deck-src-"), { "skills/a/SKILL.md": skill("a") });
  const cache = tmp("deck-cache-");
  const descriptor = { type: "git", url: repo.url, repo: null, sha: repo.sha };

  const results = await Promise.all(
    Array.from({ length: 8 }, () => fetchInChild(cache, descriptor)),
  );

  for (const r of results) {
    assert.equal(r.resolved.sha, repo.sha);
    assert.ok(fs.existsSync(path.join(r.root, "skills/a/SKILL.md")));
  }
  assert.equal(new Set(results.map((r) => r.root)).size, 1);
  const siblings = fs.readdirSync(path.dirname(results[0].root));
  assert.deepEqual(siblings.filter((n) => n.includes(".tmp-")), []);
});
