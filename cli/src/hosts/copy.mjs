import fs from "node:fs";
import path from "node:path";
import { HOSTS, pluginAssetRel } from "../paths.mjs";
import { ownerOf } from "../state.mjs";

/**
 * Copy mode: vendor a normalized plugin (`.ai/installed/plugins/<id>/`) into the
 * project paths each host scans. Used when a host cannot load the plugin
 * natively. Hooks are not activated in this mode; the result says so.
 */

const NOT_ASSETS = new Set([
  "skills",
  "agents",
  "commands",
  "rules",
  "hooks",
  ".claude-plugin",
  ".cursor-plugin",
  "plugin.json",
  "mcp.json",
]);

/** Relative paths that can point at plugin files outside a skill directory. */
const RELATIVE_PATH = /(?:\.\.?\/)+(?:[\w.@+-]+\/)*[\w.@+-]+/g;

function isInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function walkFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(abs));
    else files.push(abs);
  }
  return files;
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

function listFilesRel(dir) {
  return walkFiles(dir).map((abs) => path.relative(dir, abs)).sort();
}

function readMcpFile(filePath) {
  if (!fs.existsSync(filePath)) return { mcpServers: {} };
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (raw.mcpServers) return raw;
  return { mcpServers: raw };
}

function writeMcpFile(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

export function mcpNamespace(id, serverName) {
  return `deck__${id}__${serverName}`;
}

/** Replace `${CLAUDE_PLUGIN_ROOT}` / `${CURSOR_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` in a string. */
function substituteRoot(text, value) {
  return text.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, value);
}

function substituteDeep(value, root) {
  if (typeof value === "string") return substituteRoot(value, root);
  if (Array.isArray(value)) return value.map((item) => substituteDeep(item, root));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteDeep(v, root)]));
  }
  return value;
}

/**
 * Point skill-relative links at the per-plugin asset directory so two plugins
 * can both ship a CONVENTIONS.md without sharing one path, and replace plugin
 * root variables with that directory.
 */
function rewriteSkillFiles(pluginDir, skillName, destSkillDir, assetDir, projectRoot) {
  const sourceSkillDir = path.join(pluginDir, "skills", skillName);
  for (const file of walkFiles(destSkillDir)) {
    if (!/\.(md|mdc|markdown|txt|sh|json|ya?ml)$/.test(file)) continue;
    const relInSkill = path.relative(destSkillDir, file);
    const sourceFile = path.join(sourceSkillDir, relInSkill);
    let text = fs.readFileSync(file, "utf8");
    const original = text;
    if (file.endsWith(".md")) {
      const replacements = [];
      for (const token of new Set(text.match(RELATIVE_PATH) || [])) {
        const resolved = path.resolve(path.dirname(sourceFile), token);
        if (!isInside(pluginDir, resolved) || isInside(sourceSkillDir, resolved)) continue;
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
        const vendored = path.join(assetDir, path.relative(pluginDir, resolved));
        if (!fs.existsSync(vendored)) continue;
        const rewritten = path.relative(path.dirname(file), vendored);
        if (rewritten !== token) replacements.push([token, rewritten]);
      }
      replacements.sort((a, b) => b[0].length - a[0].length);
      for (const [from, to] of replacements) text = text.split(from).join(to);
    }
    text = substituteRoot(text, path.relative(projectRoot, assetDir) || ".");
    if (text !== original) fs.writeFileSync(file, text);
  }
}

/**
 * Refuse to write over a path another plugin owns, or that deck did not write.
 * `previous` paths belong to this plugin already.
 */
function claim(projectRoot, rel, id, state, previous, force) {
  if (previous.has(rel)) return;
  const owner = ownerOf(state, rel);
  if (owner && owner !== id) {
    throw new Error(`${id}: ${rel} is already installed by "${owner}". Give one of them another skill name, or remove "${owner}".`);
  }
  if (!owner && !force && fs.existsSync(path.join(projectRoot, rel))) {
    throw new Error(`${id}: ${rel} already exists and was not written by deck. Move it, or pass --force to replace it.`);
  }
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {string} pluginDir normalized plugin directory
 * @param {{ hosts: Array<keyof typeof HOSTS>, state: import("../state.mjs").State, previous?: import("../state.mjs").StateEntry, force?: boolean }} options
 * @returns {{ paths: string[], mcpKeys: Record<string, string[]>, warnings: string[] }}
 */
export function copyInstall(projectRoot, id, pluginDir, options) {
  const previous = new Set(options.previous?.paths ?? []);
  const paths = [];
  const mcpKeys = {};
  const warnings = [];
  const plan = [];

  const skills = listDirs(path.join(pluginDir, "skills")).filter((name) =>
    fs.existsSync(path.join(pluginDir, "skills", name, "SKILL.md")),
  );
  const agents = listFilesRel(path.join(pluginDir, "agents"));
  const commands = listFilesRel(path.join(pluginDir, "commands"));
  const rules = listFilesRel(path.join(pluginDir, "rules"));
  const assets = fs.readdirSync(pluginDir).filter((name) => !NOT_ASSETS.has(name) && !name.startsWith("."));

  for (const hostName of options.hosts) {
    const host = HOSTS[hostName];
    for (const skill of skills) plan.push(path.join(host.skills, skill));
    for (const rel of agents) plan.push(path.join(host.agents, rel));
    for (const rel of commands) plan.push(path.join(host.commands, id, rel));
    if (host.rules) for (const rel of rules) plan.push(path.join(host.rules, id, rel));
    if (!host.rules && rules.length > 0) {
      warnings.push(`${hostName}: ${rules.length} rule file(s) skipped (no rules support)`);
    }
  }
  for (const rel of plan) claim(projectRoot, rel, id, options.state, previous, options.force);

  for (const hostName of options.hosts) {
    const host = HOSTS[hostName];
    const assetRel = pluginAssetRel(host, id);
    const assetDir = path.join(projectRoot, assetRel);
    fs.rmSync(assetDir, { recursive: true, force: true });
    if (assets.length > 0) {
      fs.mkdirSync(assetDir, { recursive: true });
      for (const name of assets) {
        fs.cpSync(path.join(pluginDir, name), path.join(assetDir, name), { recursive: true });
      }
      paths.push(assetRel);
    }

    for (const skill of skills) {
      const rel = path.join(host.skills, skill);
      const dest = path.join(projectRoot, rel);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(path.join(pluginDir, "skills", skill), dest, { recursive: true });
      rewriteSkillFiles(pluginDir, skill, dest, assetDir, projectRoot);
      paths.push(rel);
    }

    const copyFiles = (kind, list, targetRoot) => {
      for (const relFile of list) {
        const rel = path.join(targetRoot, relFile);
        const dest = path.join(projectRoot, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(pluginDir, kind, relFile), dest);
        paths.push(rel);
      }
    };
    copyFiles("agents", agents, host.agents);
    copyFiles("commands", commands, path.join(host.commands, id));
    if (host.rules) copyFiles("rules", rules, path.join(host.rules, id));

    const mcpFile = path.join(pluginDir, "mcp.json");
    if (fs.existsSync(mcpFile)) {
      const servers = JSON.parse(fs.readFileSync(mcpFile, "utf8")).mcpServers ?? {};
      const abs = path.join(projectRoot, host.mcp);
      const doc = readMcpFile(abs);
      const keys = [];
      const root = `./${path.relative(projectRoot, assetDir)}`;
      for (const [serverName, config] of Object.entries(servers)) {
        const key = mcpNamespace(id, serverName);
        doc.mcpServers[key] = substituteDeep(config, root);
        keys.push(key);
      }
      writeMcpFile(abs, doc);
      mcpKeys[host.mcp] = keys;
    }

    if (fs.existsSync(path.join(pluginDir, "hooks", "hooks.json"))) {
      warnings.push(`${hostName}: hooks are not active in copy mode`);
    }
  }

  paths.sort();
  return { paths: [...new Set(paths)], mcpKeys, warnings };
}

/** Delete the files and MCP keys a state entry recorded. */
export function removeInstalledFiles(projectRoot, record) {
  const removed = [];
  for (const rel of record?.paths || []) {
    const abs = path.join(projectRoot, rel);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
      pruneEmptyParents(projectRoot, path.dirname(abs));
    }
  }
  for (const [mcpRel, keys] of Object.entries(record?.mcpKeys || {})) {
    const abs = path.join(projectRoot, mcpRel);
    if (!fs.existsSync(abs)) continue;
    const doc = readMcpFile(abs);
    for (const key of keys) delete doc.mcpServers[key];
    if (Object.keys(doc.mcpServers).length === 0) fs.rmSync(abs, { force: true });
    else writeMcpFile(abs, doc);
  }
  return { removed };
}

/** Remove now-empty per-plugin directories such as .cursor/rules/<id>/. */
function pruneEmptyParents(projectRoot, dir) {
  let current = dir;
  while (isInside(projectRoot, current) && current !== projectRoot) {
    const base = path.basename(current);
    if ([".claude", ".cursor", "skills", "agents", "commands", "rules", "plugins"].includes(base)) return;
    if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) return;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}
