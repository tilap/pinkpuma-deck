import fs from "node:fs";
import path from "node:path";
import { entryId, parsePluginSpec } from "./lockfile.mjs";
import { AGENT_DIR, PLUGINS_FILE, pluginsPath } from "./paths.mjs";

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
  fs.mkdirSync(path.join(projectRoot, AGENT_DIR), { recursive: true });
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
