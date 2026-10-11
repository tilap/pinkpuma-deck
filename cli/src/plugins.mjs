import fs from "node:fs";
import { ensureDeckGitignored } from "./gitignore.mjs";
import { LOCAL_PLUGINS_FILE, PLUGINS_FILE, localPluginsPath, pluginsPath } from "./paths.mjs";
import { fromLegacyRequest, isLegacyRequest, normalizeRequest } from "./sources/spec.mjs";

/**
 * ai-plugin.json — what to install. Same role as package.json dependencies.
 *   { "plugins": [Request, …], "hosts": { "claude": "native", "cursor": "copy" }, "agentsMd": true }
 * Entries written by deck <= 0.6 (`{ marketplace, name, ref }`) are read and
 * rewritten in the current shape on the next write.
 *
 * @typedef {import("./sources/spec.mjs").Request} Request
 * @typedef {"copy" | "native" | "off"} HostMode
 * @typedef {{ plugins: Request[], hosts?: { claude?: HostMode, cursor?: HostMode }, agentsMd?: boolean }} PluginsFile
 */

const HOST_MODES = new Set(["copy", "native", "off"]);

export function emptyPlugins() {
  return { plugins: [] };
}

function normalizeHosts(hosts) {
  if (hosts == null) return undefined;
  if (typeof hosts !== "object") throw new Error(`${PLUGINS_FILE} hosts must be an object`);
  const out = {};
  for (const [name, mode] of Object.entries(hosts)) {
    if (!["claude", "cursor"].includes(name)) throw new Error(`${PLUGINS_FILE} hosts.${name}: unknown host`);
    if (!HOST_MODES.has(mode)) {
      throw new Error(`${PLUGINS_FILE} hosts.${name} must be one of ${[...HOST_MODES].join(", ")}`);
    }
    out[name] = mode;
  }
  return out;
}

function normalizeList(list, file) {
  if (!Array.isArray(list)) throw new Error(`Invalid ${file}`);
  const seen = new Set();
  return list.map((raw, index) => {
    const request = normalizeRequest(isLegacyRequest(raw) ? fromLegacyRequest(raw) : raw, `${file} plugins[${index}]`);
    if (seen.has(request.id)) throw new Error(`${file}: duplicate id "${request.id}"`);
    seen.add(request.id);
    return request;
  });
}

export function normalizePlugins(raw) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid ${PLUGINS_FILE}`);
  const hosts = normalizeHosts(raw.hosts);
  if (raw.agentsMd != null && typeof raw.agentsMd !== "boolean") {
    throw new Error(`${PLUGINS_FILE} agentsMd must be true or false`);
  }
  return {
    plugins: normalizeList(raw.plugins, PLUGINS_FILE).map(({ from, ...request }) => request),
    ...(hosts ? { hosts } : {}),
    ...(raw.agentsMd === false ? { agentsMd: false } : {}),
  };
}

export function readPlugins(projectRoot) {
  const file = pluginsPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  return normalizePlugins(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writePlugins(projectRoot, doc) {
  const normalized = normalizePlugins(doc);
  normalized.plugins.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(pluginsPath(projectRoot), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function ensurePlugins(projectRoot) {
  return readPlugins(projectRoot) ?? writePlugins(projectRoot, emptyPlugins());
}

export function addPlugin(doc, request) {
  return { ...doc, plugins: [...doc.plugins.filter((p) => p.id !== request.id), request] };
}

export function removePlugin(doc, id) {
  const plugins = doc.plugins.filter((plugin) => plugin.id !== id);
  if (plugins.length === doc.plugins.length) throw new Error(`No plugin with id "${id}" in ${PLUGINS_FILE}`);
  return { ...doc, plugins };
}

/**
 * Parse `<checkout>[@<plugin>]`. The checkout may be relative; `@` in the path
 * is kept because the split is the last `@` after the last `/`.
 */
export function parseLinkSpec(spec) {
  const slash = Math.max(spec.lastIndexOf("/"), spec.lastIndexOf("\\"));
  const at = spec.lastIndexOf("@");
  if (at > slash && at > 0) {
    const name = spec.slice(at + 1);
    if (!name) throw new Error(`Invalid link "${spec}". Expected <checkout>[@<plugin-name>]`);
    return { checkout: spec.slice(0, at), name };
  }
  return { checkout: spec, name: undefined };
}

// --- ai-plugin.local.json: gitignored links to working trees ---------------

export function emptyLocalPlugins() {
  return { plugins: [] };
}

export function normalizeLocalPlugins(raw) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid ${LOCAL_PLUGINS_FILE}`);
  return { plugins: normalizeList(raw.plugins, LOCAL_PLUGINS_FILE) };
}

export function readLocalPlugins(projectRoot) {
  const file = localPluginsPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  // deck 0.6 links: { marketplace, name, ref, from } → a local source.
  const plugins = (raw.plugins ?? []).map((p) =>
    isLegacyRequest(p) ? { id: p.name, source: `local:${p.from}`, plugin: p.name } : p,
  );
  return normalizeLocalPlugins({ plugins });
}

export function deleteLocalPlugins(projectRoot) {
  fs.rmSync(localPluginsPath(projectRoot), { force: true });
}

export function writeLocalPlugins(projectRoot, doc) {
  const normalized = normalizeLocalPlugins(doc);
  normalized.plugins.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(localPluginsPath(projectRoot), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  ensureDeckGitignored(projectRoot);
  return normalized;
}

export function addLocalPlugin(doc, request) {
  return { plugins: [...doc.plugins.filter((p) => p.id !== request.id), request] };
}

export function removeLocalPlugin(doc, id) {
  const plugins = doc.plugins.filter((plugin) => plugin.id !== id);
  if (plugins.length === doc.plugins.length) throw new Error(`No linked plugin "${id}"`);
  return { plugins };
}

/** Local links replace a committed request with the same id. */
export function mergePluginRequests(committed, local) {
  const map = new Map();
  for (const plugin of committed?.plugins ?? []) map.set(plugin.id, plugin);
  for (const plugin of local?.plugins ?? []) map.set(plugin.id, { ...plugin, linked: true });
  return {
    ...(committed?.hosts ? { hosts: committed.hosts } : {}),
    plugins: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Committed request plus local links. Null when neither file exists. */
export function readRequestedPlugins(projectRoot) {
  const committed = readPlugins(projectRoot);
  const local = readLocalPlugins(projectRoot);
  if (!committed && !local) return null;
  return mergePluginRequests(committed ?? emptyPlugins(), local ?? emptyLocalPlugins());
}
