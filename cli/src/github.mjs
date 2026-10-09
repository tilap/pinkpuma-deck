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

/**
 * Optional local checkout for a marketplace. `DECK_LOCAL_owner__repo` is an absolute
 * path. The current branch name and `HEAD` read that working tree, including
 * uncommitted files. Any other ref is checked out from a local clone of it.
 */
function localSource(marketplace) {
  const key = `DECK_LOCAL_${marketplace.replaceAll("/", "__")}`;
  const value = process.env[key];
  if (!value) return null;
  if (!fs.existsSync(path.join(value, ".git"))) {
    throw new Error(
      `${key} does not point at a git checkout: ${value}`,
    );
  }
  return value;
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

function fetchLocalMarketplace(source, marketplace, ref) {
  const dest = path.join(cacheRoot(), marketplace, ref.replace(/[^\w.-]+/g, "_"));
  const branch = run("git", ["-C", source, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const useWorktree = ref === "HEAD" || ref === branch;
  if (useWorktree) {
    copyTree(source, dest);
    return { root: dest, resolved: headCommit(source) };
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  run("git", ["clone", "--local", source, dest]);
  run("git", ["-C", dest, "checkout", "--force", ref]);
  return { root: dest, resolved: headCommit(dest) };
}

/**
 * Fetch owner/repo at ref into a local cache dir.
 * Returns the checkout path and the commit SHA that ref resolved to.
 * Uses git credentials already configured on the machine, unless a DECK_LOCAL_*
 * checkout is set for this marketplace.
 */
export function fetchMarketplace(marketplace, ref) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(marketplace)) {
    throw new Error(`Invalid marketplace "${marketplace}" (expected owner/repo)`);
  }
  const local = localSource(marketplace);
  if (local) return fetchLocalMarketplace(local, marketplace, ref);

  const dest = path.join(cacheRoot(), marketplace, ref.replace(/[^\w.-]+/g, "_"));
  const url = `https://github.com/${marketplace}.git`;

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(path.join(dest, ".git"))) {
    run("git", ["-C", dest, "fetch", "--depth", "1", "origin", ref]);
    try {
      run("git", ["-C", dest, "checkout", "--force", "FETCH_HEAD"]);
    } catch {
      run("git", ["-C", dest, "checkout", "--force", ref]);
    }
    return { root: dest, resolved: headCommit(dest) };
  }

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  // Prefer branch/tag shallow clone; fall back to clone + checkout for SHAs.
  const shallow = spawnSync(
    "git",
    ["clone", "--depth", "1", "--branch", ref, url, dest],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (shallow.status === 0) {
    return { root: dest, resolved: headCommit(dest) };
  }

  run("git", ["clone", url, dest]);
  run("git", ["-C", dest, "checkout", "--force", ref]);
  return { root: dest, resolved: headCommit(dest) };
}

/**
 * Resolve plugin directory inside a marketplace checkout.
 */
export function resolvePluginDir(repoRoot, pluginName) {
  const marketplacePath = path.join(repoRoot, ".claude-plugin", "marketplace.json");
  if (fs.existsSync(marketplacePath)) {
    const market = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
    const entry = (market.plugins || []).find((p) => p.name === pluginName);
    if (entry?.source) {
      const dir = path.resolve(repoRoot, entry.source);
      if (!fs.existsSync(dir)) {
        throw new Error(
          `Plugin "${pluginName}" source "${entry.source}" missing in marketplace`,
        );
      }
      return dir;
    }
  }

  const conventional = path.join(repoRoot, "plugins", pluginName);
  if (fs.existsSync(conventional)) {
    return conventional;
  }

  // Single-plugin repo: root has manifests.
  if (
    fs.existsSync(path.join(repoRoot, ".claude-plugin", "plugin.json")) ||
    fs.existsSync(path.join(repoRoot, ".cursor-plugin", "plugin.json"))
  ) {
    return repoRoot;
  }

  throw new Error(
    `Plugin "${pluginName}" not found under ${repoRoot} (no marketplace entry or plugins/${pluginName})`,
  );
}
