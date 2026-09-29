import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
 * Fetch owner/repo at ref into a local cache dir. Returns absolute path.
 * Uses git credentials already configured on the machine.
 */
export function fetchMarketplace(marketplace, ref) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(marketplace)) {
    throw new Error(`Invalid marketplace "${marketplace}" (expected owner/repo)`);
  }
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
    return dest;
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
    return dest;
  }

  run("git", ["clone", url, dest]);
  run("git", ["-C", dest, "checkout", "--force", ref]);
  return dest;
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
