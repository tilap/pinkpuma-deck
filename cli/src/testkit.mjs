/** Helpers shared by the node:test suites. Not used by the CLI. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tmp(prefix = "deck-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  return root;
}

export function skill(name, description = `${name} skill`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(" ")} failed`);
  return r.stdout.trim();
}

/** A git repository with one commit of `files`. Returns its file:// URL and HEAD. */
export function gitRepo(dir, files) {
  writeTree(dir, files);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return { url: `file://${dir}`, sha: git(dir, "rev-parse", "HEAD"), dir };
}

export function gitCommit(dir, files) {
  writeTree(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
  return git(dir, "rev-parse", "HEAD");
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function gitTag(dir, tag) {
  git(dir, "tag", tag);
}
