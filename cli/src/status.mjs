import fs from "node:fs";
import path from "node:path";
import { gitignoreStatus } from "./gitignore.mjs";
import { claudeBin, nativeInstalled } from "./hosts/claude-native.mjs";
import { hostModes } from "./install.mjs";
import { pluginName, treeIntegrity } from "./materialize.mjs";
import { LOCK_FILE, PLUGINS_FILE, deckPluginRel } from "./paths.mjs";
import { loadProject } from "./project.mjs";
import { sameRequest } from "./sources/spec.mjs";
import { readState } from "./state.mjs";

/**
 * What the project asks for (base, active profile, links), what is locked and
 * installed, and every mismatch. Reads only: it never fetches or writes.
 *
 * @typedef {{ level: "error" | "warn" | "ok", id?: string, message: string }} Finding
 * @typedef {{ id: string, from: string, source: string, linked: boolean, entry: object | null }} Row
 * @param {{ claude?: () => string | null }} [options] test seam for the claude CLI
 * @returns {{ profile: string | null, rows: Row[], findings: Finding[] }}
 */
export function status(projectRoot, options = {}) {
  const project = loadProject(projectRoot);
  const committed = [...project.base.plugins, ...(project.prof?.plugins ?? [])];
  const side = (id) => (project.owner.get(id) === "base" ? "base" : `profile ${project.profile}`);
  const rows = project.doc.plugins.map((request) => ({
    id: request.id,
    from: request.linked ? "link" : side(request.id),
    overrides: request.linked ? (committed.find((p) => p.id === request.id) ?? null) : null,
    source: request.source,
    ref: request.ref,
    linked: Boolean(request.linked),
    entry: project.lock.plugins.find((p) => p.id === request.id) ?? null,
  }));
  return { profile: project.profile, rows, findings: checkProject(project, options) };
}

function checkProject(project, options) {
  const projectRoot = project.root;
  /** @type {Finding[]} */
  const findings = [];
  const error = (message, id) => findings.push({ level: "error", message, ...(id ? { id } : {}) });
  const warn = (message, id) => findings.push({ level: "warn", message, ...(id ? { id } : {}) });

  if (!project.exists) {
    error(`No ${PLUGINS_FILE}. Run deck add <source>.`);
    return findings;
  }
  const { doc, lock } = project;
  if (lock.legacyState) warn(`${LOCK_FILE} is in the deck 0.6 format. Run deck install to convert it.`);
  const state = readState(projectRoot);
  const modes = hostModes(doc);

  const wanted = new Set(doc.plugins.map((p) => p.id));
  for (const request of doc.plugins) {
    const { id } = request;
    const entry = lock?.plugins.find((p) => p.id === id);
    if (!request.linked) {
      if (!entry) {
        error("requested but not locked. Run deck install.", id);
        continue;
      }
      const { linked, ...clean } = request;
      if (!sameRequest(entry.request, clean)) {
        error(`${PLUGINS_FILE} changed since the lock was written. Run deck install.`, id);
      }
    }

    const dir = path.join(projectRoot, deckPluginRel(id));
    if (!fs.existsSync(dir)) {
      error(`${deckPluginRel(id)} is missing. Run deck install.`, id);
      continue;
    }
    if (entry?.integrity && !request.linked) {
      const actual = treeIntegrity(dir);
      if (actual !== entry.integrity) {
        error(`${deckPluginRel(id)} differs from the lock (modified by hand?). Run deck install.`, id);
      }
    }

    const installed = state.plugins[id];
    if (!installed) {
      error("not activated for any host. Run deck install.", id);
      continue;
    }
    const missing = installed.paths.filter((rel) => !fs.existsSync(path.join(projectRoot, rel)));
    if (missing.length > 0) {
      error(`${missing.length} installed path(s) missing (${missing.slice(0, 3).join(", ")}). Run deck install.`, id);
    }

    const components = entry?.components;
    if (components?.hooks && modes.cursor === "copy") warn("ships hooks; they are not active in Cursor copy mode", id);
    if (components?.hooks && !installed.native?.includes("claude") && modes.claude !== "off") {
      warn("ships hooks; they are not active in Claude copy mode", id);
    }
  }

  for (const entry of lock.plugins) {
    if (!wanted.has(entry.id)) error(`locked but no longer requested. Run deck install.`, entry.id);
  }
  for (const id of Object.keys(state.plugins)) {
    if (!wanted.has(id)) error("installed but no longer requested (another profile?). Run deck install.", id);
  }

  const owners = new Map();
  for (const entry of lock.plugins) {
    for (const name of entry.components.skills) {
      if (owners.has(name)) {
        warn(`skill "${name}" is also shipped by "${owners.get(name)}"; copy mode cannot install both`, entry.id);
      } else {
        owners.set(name, entry.id);
      }
    }
  }

  const nativeIds = Object.entries(state.plugins)
    .filter(([, entry]) => entry.native?.includes("claude"))
    .map(([id]) => id);
  if (nativeIds.length > 0) {
    const bin = (options.claude ?? claudeBin)();
    if (!bin) {
      warn("Claude native plugins are recorded but the `claude` CLI is not on PATH; cannot check them");
    } else {
      const listed = new Set(nativeInstalled(bin, projectRoot) ?? []);
      for (const id of nativeIds) {
        if (!listed.has(pluginName(id))) error(`Claude does not list ${pluginName(id)}@deck. Run deck install.`, id);
      }
    }
  }

  const ignore = gitignoreStatus(projectRoot);
  if (ignore) {
    if (!ignore.deckIgnored) warn(".deck/ is not in .gitignore");
    if (!ignore.localIgnored) warn("ai-plugin.local.json is not in .gitignore");
    if (ignore.lockIgnored) warn(`${LOCK_FILE} is ignored by .gitignore; commit it instead`);
  }

  if (!findings.some((f) => f.level === "error")) {
    findings.push({ level: "ok", message: `${doc.plugins.length} plugin(s) match ${PLUGINS_FILE} and ${LOCK_FILE}` });
  }
  return findings;
}
