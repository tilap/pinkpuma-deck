import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeSegment } from "./paths.mjs";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `${cmd} failed`;
    throw new Error(err);
  }
  return r.stdout;
}

function cacheRoot() {
  return process.env.DECK_CACHE ||
    path.join(os.homedir(), ".cache", "pinkpuma-deck");
}

function headCommit(dir) {
  return run("git", ["-C", dir, "rev-parse", "HEAD"]).trim();
}

function copyTree(source, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, {
    recursive: true,
    filter(src) {
      const rel = path.relative(source, src);
      return rel === "" || (rel !== ".git" && !rel.startsWith(`.git${path.sep}`));
    },
  });
}

function assertGitCheckout(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(path.join(abs, ".git"))) {
    throw new Error(`Not a git checkout: ${abs}`);
  }
  return abs;
}

/**
 * owner/repo from a GitHub origin URL. Returns null for any other remote.
 */
export function parseGithubCloneUrl(url) {
  const cleaned = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match =
    cleaned.match(/^git@github\.com:([^/]+)\/([^/]+)$/) ||
    cleaned.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/) ||
    cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

/** Current branch, or `HEAD` when detached. */
export function checkoutRef(dir) {
  const abs = assertGitCheckout(dir);
  const branch = run("git", ["-C", abs, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  return branch === "HEAD" ? "HEAD" : branch;
}

/** `owner/repo` from `origin`. */
export function marketplaceIdFromCheckout(dir) {
  const abs = assertGitCheckout(dir);
  let url;
  try {
    url = run("git", ["-C", abs, "remote", "get-url", "origin"]).trim();
  } catch {
    throw new Error(`No origin remote in ${abs}`);
  }
  const id = parseGithubCloneUrl(url);
  if (!id) {
    throw new Error(
      `Cannot derive owner/repo from origin (${url}). Expected a GitHub remote.`,
    );
  }
  return id;
}

/**
 * Copy a checkout, including uncommitted files, into the deck cache.
 * `resolved` is HEAD; dirty files are still in the copy.
 */
export function copyWorkingTree(source) {
  const abs = assertGitCheckout(source);
  const dest = path.join(cacheRoot(), "worktrees", safeSegment(abs));
  copyTree(abs, dest);
  return { root: dest, resolved: headCommit(abs) };
}
