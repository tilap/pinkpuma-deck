import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cacheRoot } from "./sources/fetch.mjs";
import { safeSegment } from "./paths.mjs";

/**
 * Copy a working tree, uncommitted files included, into the deck cache.
 * In a git checkout, only tracked files and untracked files that .gitignore
 * does not exclude are copied: build output and caches stay behind, so the
 * copy matches what a commit of that tree would hold.
 * `resolved` is the checkout's HEAD commit, or "worktree" for a folder that is
 * not a git checkout or has no commit yet: a linked plugin is never locked.
 */
export function copyWorkingTree(source) {
  const abs = path.resolve(source);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }
  const dest = path.join(cacheRoot(), "worktrees", safeSegment(abs));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const files = gitFiles(abs);
  if (files) {
    for (const rel of files) {
      const from = path.join(abs, rel);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue; // deleted, or a submodule
      const to = path.join(dest, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode);
    }
  } else {
    fs.cpSync(abs, dest, { recursive: true });
  }

  const head = spawnSync("git", ["-C", abs, "rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" });
  return { root: dest, resolved: head.status === 0 ? head.stdout.trim() : "worktree" };
}

/** Tracked and unignored untracked files, relative to `dir`; null outside a git work tree. */
function gitFiles(dir) {
  const inside = spawnSync("git", ["-C", dir, "rev-parse", "--show-prefix"], { encoding: "utf8" });
  if (inside.status !== 0) return null;
  const r = spawnSync("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout.split("\0").filter(Boolean);
}
