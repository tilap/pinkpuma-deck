import fs from "node:fs";
import path from "node:path";
import { emptyLockfile, readLockfile, writeLockfile } from "./lockfile.mjs";
import { AI_DIR, PLUGINS_FILE } from "./paths.mjs";
import { emptyPlugins, mergePluginRequests, readLocalPlugins, readPlugins } from "./plugins.mjs";

/**
 * A project's plugin set: the base (root ai-plugin.json and lock, committed),
 * plus the active profile (.ai/profiles/<name>/ai-plugin.json and lock), plus local links.
 * Every command works on this merged view; locks are split back on save.
 */

export const PROFILES_DIR = `${AI_DIR}/profiles`;
/** .ai/current → profiles/<name>: the active profile. */
export const CURRENT_LINK = `${AI_DIR}/current`;

export function profileDir(projectRoot, name) {
  return path.join(projectRoot, PROFILES_DIR, name);
}

export function isValidProfileName(name) {
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name) && name !== "current" && !name.startsWith(".");
}

/** The active profile, from the .ai/current link, or null. */
export function activeProfile(projectRoot) {
  const link = path.join(projectRoot, CURRENT_LINK);
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  const name = path.basename(fs.readlinkSync(link));
  return fs.existsSync(path.join(profileDir(projectRoot, name), PLUGINS_FILE)) ? name : null;
}

/** Profile names: folders of .ai/profiles/ that hold an ai-plugin.json. */
export function listProfiles(projectRoot) {
  const dir = path.join(projectRoot, PROFILES_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isValidProfileName(d.name))
    .filter((d) => fs.existsSync(path.join(dir, d.name, PLUGINS_FILE)))
    .map((d) => d.name)
    .sort();
}

/**
 * @param {string} projectRoot
 * @param {{ profile?: string | null }} [options] profile to merge; default: the active one
 */
export function loadProject(projectRoot, options = {}) {
  const profile = options.profile === undefined ? activeProfile(projectRoot) : options.profile;
  const base = readPlugins(projectRoot);
  const baseLock = readLockfile(projectRoot);
  const profileRoot = profile ? profileDir(projectRoot, profile) : null;
  if (profileRoot && !fs.existsSync(path.join(profileRoot, PLUGINS_FILE))) {
    throw new Error(`No profile "${profile}" (${path.relative(projectRoot, profileRoot)}/${PLUGINS_FILE})`);
  }
  const prof = profileRoot ? readPlugins(profileRoot) : null;
  const profLock = profileRoot ? readLockfile(profileRoot) : null;

  /** Where each committed request lives: "base" or the profile name. */
  const owner = new Map();
  for (const p of base?.plugins ?? []) owner.set(p.id, "base");
  for (const p of prof?.plugins ?? []) {
    if (owner.has(p.id)) {
      throw new Error(`"${p.id}" is requested by both ${PLUGINS_FILE} and profile "${profile}". Keep one.`);
    }
    owner.set(p.id, profile);
  }

  const committed = {
    ...(base?.hosts ? { hosts: base.hosts } : {}),
    plugins: [...(base?.plugins ?? []), ...(prof?.plugins ?? [])],
  };
  const doc = mergePluginRequests(committed, readLocalPlugins(projectRoot));

  const lock = emptyLockfile();
  lock.writeAgentsMd = base?.agentsMd !== false;
  lock.plugins = [...(baseLock?.plugins ?? []), ...(profLock?.plugins ?? [])].filter(
    (entry, i, all) => all.findIndex((e) => e.id === entry.id) === i,
  );

  /** Split a merged lock back into the base lock and the profile lock. */
  const saveLock = (merged) => {
    const pick = (where) => ({
      lockfileVersion: merged.lockfileVersion,
      writeAgentsMd: lock.writeAgentsMd,
      plugins: merged.plugins.filter((e) => owner.get(e.id) === where),
    });
    if (base || merged.plugins.some((e) => owner.get(e.id) === "base") || baseLock) {
      writeLockfile(projectRoot, pick("base"));
    }
    if (profileRoot) writeLockfile(profileRoot, pick(profile));
  };

  return {
    root: projectRoot,
    profile,
    profileRoot,
    base: base ?? emptyPlugins(),
    prof,
    doc,
    lock,
    owner,
    saveLock,
    exists: Boolean(base || prof || doc.plugins.length > 0),
  };
}
