import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DECK_DIR } from "../paths.mjs";

/**
 * Native mode for Claude Code: `.deck/` is a local marketplace registered at
 * local scope, and each plugin is installed from it. Claude then reads
 * `.deck/plugins/<id>/` in place, with hooks, commands, MCP, and
 * `${CLAUDE_PLUGIN_ROOT}` handled by Claude itself.
 *
 * Writing `.claude/settings.local.json` by hand is not enough: the install is
 * also recorded in the user's plugin registry, so deck drives the `claude` CLI.
 */

export const MARKETPLACE = "deck";

/** The `claude` executable, or null. `DECK_CLAUDE_BIN` overrides PATH. */
export function claudeBin() {
  const explicit = process.env.DECK_CLAUDE_BIN;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const r = spawnSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return r.status === 0 ? "claude" : null;
}

function claude(bin, projectRoot, args) {
  const r = spawnSync(bin, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw new Error(`claude ${args.join(" ")}: ${r.error.message}`);
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function must(result, what) {
  if (!result.ok) throw new Error(`${what} failed: ${result.out}`);
  return result;
}

function localSettings(projectRoot) {
  const file = path.join(projectRoot, ".claude", "settings.local.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Register `.deck/` as the `deck` marketplace at local scope, or refresh it. */
export function ensureMarketplace(bin, projectRoot) {
  const deckDir = path.join(projectRoot, DECK_DIR);
  const known = localSettings(projectRoot).extraKnownMarketplaces?.[MARKETPLACE]?.source;
  if (known?.source === "directory" && path.resolve(known.path) === path.resolve(deckDir)) {
    must(claude(bin, projectRoot, ["plugin", "marketplace", "update", MARKETPLACE]), "claude plugin marketplace update");
    return;
  }
  if (known) claude(bin, projectRoot, ["plugin", "marketplace", "remove", MARKETPLACE]);
  must(
    claude(bin, projectRoot, ["plugin", "marketplace", "add", deckDir, "--scope", "local"]),
    "claude plugin marketplace add",
  );
}

/**
 * @param {string} bin
 * @param {string} projectRoot
 * @param {string} name plugin manifest name (see materialize.pluginName)
 */
export function nativeInstall(bin, projectRoot, name) {
  ensureMarketplace(bin, projectRoot);
  const id = `${name}@${MARKETPLACE}`;
  const enabled = localSettings(projectRoot).enabledPlugins?.[id] === true;
  if (enabled) {
    // Already installed: the directory source is read in place; refresh its record.
    const updated = claude(bin, projectRoot, ["plugin", "update", id, "--scope", "local"]);
    if (updated.ok) return;
  }
  must(claude(bin, projectRoot, ["plugin", "install", id, "--scope", "local"]), `claude plugin install ${id}`);
}

export function nativeUninstall(bin, projectRoot, name) {
  const id = `${name}@${MARKETPLACE}`;
  if (localSettings(projectRoot).enabledPlugins?.[id] === undefined) return;
  claude(bin, projectRoot, ["plugin", "uninstall", id, "--scope", "local"]);
}

/** Unregister the deck marketplace once no plugin is installed from it. */
export function releaseMarketplace(bin, projectRoot) {
  const settings = localSettings(projectRoot);
  if (!settings.extraKnownMarketplaces?.[MARKETPLACE]) return false;
  const stillEnabled = Object.keys(settings.enabledPlugins ?? {}).some((id) => id.endsWith(`@${MARKETPLACE}`));
  if (stillEnabled) return false;
  claude(bin, projectRoot, ["plugin", "marketplace", "remove", MARKETPLACE]);
  return true;
}

/** Plugin ids Claude reports as installed from the deck marketplace. */
export function nativeInstalled(bin, projectRoot) {
  const r = claude(bin, projectRoot, ["plugin", "list", "--json"]);
  if (!r.ok) return null;
  return [...new Set([...r.out.matchAll(/"([\w.-]+)@deck"/g)].map((m) => m[1]))].sort();
}
