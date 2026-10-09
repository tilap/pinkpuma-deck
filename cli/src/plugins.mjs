import fs from "node:fs";
import { entryId, parsePluginSpec } from "./lockfile.mjs";
import {
  LOCAL_PLUGINS_FILE,
  PLUGINS_FILE,
  localPluginsPath,
  pluginsPath,
} from "./paths.mjs";
import { ensureLockGitignored } from "./gitignore.mjs";

/**
 * Requested plugins. Same role as package.json dependencies: what to install,
 * not what the last sync wrote.
 * @typedef {{ marketplace: string, name: string, ref: string }} PluginRequest
 * @typedef {{ plugins: PluginRequest[] }} PluginsFile
 */

export function emptyPlugins() {
  return { plugins: [] };
}

export function normalizePlugins(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plugins)) {
    throw new Error(`Invalid ${PLUGINS_FILE}`);
  }
  return {
    plugins: raw.plugins.map((plugin, index) => {
      if (!plugin?.marketplace || !plugin?.name || !plugin?.ref) {
        throw new Error(
          `${PLUGINS_FILE} plugins[${index}] requires marketplace, name, and ref`,
        );
      }
      return {
        marketplace: plugin.marketplace,
        name: plugin.name,
        ref: plugin.ref,
      };
    }),
  };
}

export function readPlugins(projectRoot) {
  const file = pluginsPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  return normalizePlugins(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writePlugins(projectRoot, doc) {
  const normalized = normalizePlugins(doc);
  normalized.plugins.sort((a, b) => entryId(a).localeCompare(entryId(b)));
  fs.writeFileSync(
    pluginsPath(projectRoot),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

export function ensurePlugins(projectRoot) {
  const existing = readPlugins(projectRoot);
  if (existing) return existing;
  return writePlugins(projectRoot, emptyPlugins());
}

export function addPlugin(doc, { marketplace, name, ref }) {
  const id = entryId({ marketplace, name });
  const plugins = doc.plugins.filter((plugin) => entryId(plugin) !== id);
  plugins.push({ marketplace, name, ref: ref || "main" });
  return { plugins };
}

export function removePlugin(doc, spec) {
  const { marketplace, name } = parsePluginSpec(spec);
  const id = entryId({ marketplace, name });
  const plugins = doc.plugins.filter((plugin) => entryId(plugin) !== id);
  if (plugins.length === doc.plugins.length) {
    throw new Error(`No plugin entry for ${id}`);
  }
  return { plugins };
}

/**
 * Parse `<checkout>@<plugin>`. The checkout may be relative; `@` in the path is
 * kept because the split is the last `@`.
 */
export function parseLinkSpec(spec) {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1) {
    throw new Error(
      `Invalid link "${spec}". Expected <checkout>@<plugin-name>`,
    );
  }
  const name = spec.slice(at + 1);
  if (!name || name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid plugin name "${name}"`);
  }
  return { checkout: spec.slice(0, at), name };
}

/**
 * @typedef {PluginRequest & { from: string }} LocalPluginRequest
 * @typedef {{ plugins: LocalPluginRequest[] }} LocalPluginsFile
 */

function normalizeLocalEntry(plugin, index) {
  if (!plugin?.marketplace || !plugin?.name || !plugin?.ref || !plugin?.from) {
    throw new Error(
      `${LOCAL_PLUGINS_FILE} plugins[${index}] requires marketplace, name, ref, and from`,
    );
  }
  return {
    marketplace: plugin.marketplace,
    name: plugin.name,
    ref: plugin.ref,
    from: plugin.from,
  };
}

export function emptyLocalPlugins() {
  return { plugins: [] };
}

export function normalizeLocalPlugins(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.plugins)) {
    throw new Error(`Invalid ${LOCAL_PLUGINS_FILE}`);
  }
  return { plugins: raw.plugins.map(normalizeLocalEntry) };
}

export function readLocalPlugins(projectRoot) {
  const file = localPluginsPath(projectRoot);
  if (!fs.existsSync(file)) return null;
  return normalizeLocalPlugins(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function deleteLocalPlugins(projectRoot) {
  fs.rmSync(localPluginsPath(projectRoot), { force: true });
}

export function writeLocalPlugins(projectRoot, doc) {
  const normalized = normalizeLocalPlugins(doc);
  normalized.plugins.sort((a, b) => entryId(a).localeCompare(entryId(b)));
  fs.writeFileSync(
    localPluginsPath(projectRoot),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  ensureLockGitignored(projectRoot);
  return normalized;
}

export function addLocalPlugin(doc, plugin) {
  const id = entryId(plugin);
  const plugins = doc.plugins.filter((item) => entryId(item) !== id);
  plugins.push(normalizeLocalEntry(plugin, plugins.length));
  return { plugins };
}

export function removeLocalPlugin(doc, spec) {
  const { marketplace, name } = parsePluginSpec(spec);
  const id = entryId({ marketplace, name });
  const plugins = doc.plugins.filter((plugin) => entryId(plugin) !== id);
  if (plugins.length === doc.plugins.length) {
    throw new Error(`No linked plugin ${id}`);
  }
  return { plugins };
}

/** Local requests replace a committed request with the same marketplace and name. */
export function mergePluginRequests(committed, local) {
  const map = new Map();
  for (const plugin of committed?.plugins ?? []) {
    map.set(entryId(plugin), {
      marketplace: plugin.marketplace,
      name: plugin.name,
      ref: plugin.ref,
    });
  }
  for (const plugin of local?.plugins ?? []) {
    map.set(entryId(plugin), normalizeLocalEntry(plugin, 0));
  }
  return {
    plugins: [...map.values()].sort((a, b) => entryId(a).localeCompare(entryId(b))),
  };
}

/**
 * Committed request plus local links. Null when neither file exists.
 */
export function readRequestedPlugins(projectRoot) {
  const committed = readPlugins(projectRoot);
  const local = readLocalPlugins(projectRoot);
  if (!committed && !local) return null;
  return mergePluginRequests(
    committed ?? emptyPlugins(),
    local ?? emptyLocalPlugins(),
  );
}
