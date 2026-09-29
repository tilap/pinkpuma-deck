import fs from "node:fs";
import path from "node:path";
import { fetchMarketplace, resolvePluginDir } from "./github.mjs";
import { entryId } from "./lockfile.mjs";
import {
  HOSTS,
  VENDOR_MANIFEST_DIR,
  pluginAssetRel,
  vendorManifestPath,
} from "./paths.mjs";

const ASSET_SKIP = new Set([
  "skills",
  "agents",
  ".claude-plugin",
  ".cursor-plugin",
  "mcp.json",
]);

/** Relative paths that can point at plugin files outside a skill directory. */
const RELATIVE_PATH = /(?:\.\.?\/)+(?:[\w.@+-]+\/)*[\w.@+-]+/g;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function listSkillDirs(pluginDir) {
  const skillsRoot = path.join(pluginDir, "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) =>
      fs.existsSync(path.join(skillsRoot, name, "SKILL.md"))
    );
}

function listAgentFiles(pluginDir) {
  const agentsRoot = path.join(pluginDir, "agents");
  if (!fs.existsSync(agentsRoot)) return [];
  return fs
    .readdirSync(agentsRoot)
    .filter((f) => f.endsWith(".md"));
}

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

function readPluginMcp(pluginDir) {
  const candidates = [
    path.join(pluginDir, "mcp.json"),
    path.join(pluginDir, ".mcp.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw.mcpServers && typeof raw.mcpServers === "object") {
      return raw.mcpServers;
    }
    // Bare map of server name → config
    if (raw && typeof raw === "object" && !raw.mcpServers) {
      return raw;
    }
  }

  for (const rel of [
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
  ]) {
    const file = path.join(pluginDir, rel);
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (manifest.mcpServers && typeof manifest.mcpServers === "object") {
      return manifest.mcpServers;
    }
  }
  return null;
}

function readMcpFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { mcpServers: {} };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (raw.mcpServers) return raw;
  return { mcpServers: raw };
}

function writeMcpFile(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

function mcpNamespace(entry, serverName) {
  return `deck__${entry.marketplace.replace("/", "_")}__${entry.name}__${serverName}`;
}

function copyPluginAssets(pluginDir, destDir) {
  const names = fs.readdirSync(pluginDir).filter((name) => {
    if (name.startsWith(".")) return false;
    return !ASSET_SKIP.has(name);
  });
  if (names.length === 0) return false;
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of names) {
    fs.cpSync(path.join(pluginDir, name), path.join(destDir, name), { recursive: true });
  }
  return true;
}

/**
 * Point skill-relative links at the per-plugin asset directory so two plugins
 * can both ship a CONVENTIONS.md without sharing one path.
 */
function rewriteSkillLinks(pluginDir, skillName, destSkillDir, assetDir) {
  const sourceSkillDir = path.join(pluginDir, "skills", skillName);
  for (const file of walkFiles(destSkillDir)) {
    if (!file.endsWith(".md")) continue;
    const relInSkill = path.relative(destSkillDir, file);
    const sourceFile = path.join(sourceSkillDir, relInSkill);
    let text = fs.readFileSync(file, "utf8");
    const tokens = [...new Set(text.match(RELATIVE_PATH) || [])];
    const replacements = [];
    for (const token of tokens) {
      const resolved = path.resolve(path.dirname(sourceFile), token);
      if (!isInside(pluginDir, resolved) || isInside(sourceSkillDir, resolved)) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
      const vendored = path.join(assetDir, path.relative(pluginDir, resolved));
      if (!fs.existsSync(vendored)) continue;
      const rewritten = path.relative(path.dirname(file), vendored);
      if (rewritten !== token) replacements.push([token, rewritten]);
    }
    replacements.sort((a, b) => b[0].length - a[0].length);
    for (const [from, to] of replacements) {
      text = text.split(from).join(to);
    }
    fs.writeFileSync(file, text);
  }
}

/**
 * Remove previously vendored files for this entry (from manifest).
 */
export function uninstallEntry(projectRoot, entry) {
  const id = entryId(entry);
  const manifestFile = vendorManifestPath(projectRoot, id);
  if (!fs.existsSync(manifestFile)) {
    return { removed: [] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const removed = [];

  for (const rel of manifest.paths || []) {
    const abs = path.join(projectRoot, rel);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
    }
  }

  for (const [mcpRel, keys] of Object.entries(manifest.mcpKeys || {})) {
    const abs = path.join(projectRoot, mcpRel);
    if (!fs.existsSync(abs)) continue;
    const doc = readMcpFile(abs);
    for (const key of keys) {
      delete doc.mcpServers[key];
    }
    if (Object.keys(doc.mcpServers).length === 0) {
      fs.rmSync(abs, { force: true });
    } else {
      writeMcpFile(abs, doc);
    }
  }

  fs.rmSync(manifestFile, { force: true });
  return { removed };
}

/** Drop the vendor manifest and leave copied files in place. */
export function dropVendorManifest(projectRoot, entry) {
  fs.rmSync(vendorManifestPath(projectRoot, entryId(entry)), { force: true });
}

/**
 * Uninstall vendor manifests whose plugin is no longer in the lock.
 */
export function pruneStaleEntries(projectRoot, lock) {
  const dir = path.join(projectRoot, VENDOR_MANIFEST_DIR);
  if (!fs.existsSync(dir)) return [];
  const wanted = new Set((lock.plugins || []).map((plugin) => entryId(plugin)));
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(dir, name);
    const manifest = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (!manifest?.id || wanted.has(manifest.id)) continue;
    if (!manifest.marketplace || !manifest.name) continue;
    uninstallEntry(projectRoot, {
      marketplace: manifest.marketplace,
      name: manifest.name,
    });
    removed.push(manifest.id);
  }
  return removed;
}

/**
 * Copy one plugin directory into Claude + Cursor project paths.
 * Existing skill directories and agent files are left untouched and are not
 * recorded, so a later remove cannot delete them.
 */
export function installFromPluginDir(projectRoot, entry, pluginDir) {
  uninstallEntry(projectRoot, entry);

  const installed = {
    id: entryId(entry),
    marketplace: entry.marketplace,
    name: entry.name,
    ref: entry.ref,
    pluginVersion: null,
    paths: [],
    mcpKeys: {},
  };
  const skipped = [];
  const assetDirs = {};

  for (const manifestRel of [
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
  ]) {
    const mf = path.join(pluginDir, manifestRel);
    if (fs.existsSync(mf)) {
      const j = JSON.parse(fs.readFileSync(mf, "utf8"));
      if (j.version) {
        installed.pluginVersion = j.version;
        break;
      }
    }
  }

  for (const host of Object.values(HOSTS)) {
    const assetRel = pluginAssetRel(host, installed.id);
    const assetDir = path.join(projectRoot, assetRel);
    if (copyPluginAssets(pluginDir, assetDir)) {
      installed.paths.push(assetRel);
    }
    assetDirs[host.skills] = assetDir;
  }

  const skills = listSkillDirs(pluginDir);
  for (const skill of skills) {
    const src = path.join(pluginDir, "skills", skill);
    for (const host of Object.values(HOSTS)) {
      const rel = path.join(host.skills, skill);
      const dest = path.join(projectRoot, rel);
      if (fs.existsSync(dest)) {
        skipped.push(rel);
        continue;
      }
      copyDir(src, dest);
      rewriteSkillLinks(pluginDir, skill, dest, assetDirs[host.skills]);
      installed.paths.push(rel);
    }
  }

  const agents = listAgentFiles(pluginDir);
  for (const agentFile of agents) {
    const src = path.join(pluginDir, "agents", agentFile);
    for (const host of Object.values(HOSTS)) {
      const rel = path.join(host.agents, agentFile);
      const dest = path.join(projectRoot, rel);
      if (fs.existsSync(dest)) {
        skipped.push(rel);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      installed.paths.push(rel);
    }
  }

  const mcpServers = readPluginMcp(pluginDir);
  if (mcpServers) {
    for (const host of Object.values(HOSTS)) {
      const abs = path.join(projectRoot, host.mcp);
      const doc = readMcpFile(abs);
      const keys = [];
      for (const [serverName, config] of Object.entries(mcpServers)) {
        const key = mcpNamespace(entry, serverName);
        doc.mcpServers[key] = config;
        keys.push(key);
      }
      writeMcpFile(abs, doc);
      installed.mcpKeys[host.mcp] = keys;
    }
  }

  fs.mkdirSync(path.join(projectRoot, VENDOR_MANIFEST_DIR), { recursive: true });
  const manifestFile = vendorManifestPath(projectRoot, installed.id);
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify(installed, null, 2)}\n`,
    "utf8",
  );

  return {
    id: installed.id,
    skills: skills.length,
    agents: agents.length,
    mcp: mcpServers ? Object.keys(mcpServers).length : 0,
    pluginVersion: installed.pluginVersion,
    skipped,
  };
}

/**
 * Fetch and copy one lock entry into Claude + Cursor project paths.
 */
export function applyEntry(projectRoot, entry) {
  const repoRoot = fetchMarketplace(entry.marketplace, entry.ref);
  const pluginDir = resolvePluginDir(repoRoot, entry.name);
  const result = installFromPluginDir(projectRoot, entry, pluginDir);
  return { ...result, cache: repoRoot };
}

export function applyAll(projectRoot, lock) {
  pruneStaleEntries(projectRoot, lock);
  const results = [];
  for (const entry of lock.plugins) {
    results.push(applyEntry(projectRoot, entry));
  }
  return results;
}
