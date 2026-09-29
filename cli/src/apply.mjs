import fs from "node:fs";
import path from "node:path";
import { readDefaultUsage, rewriteAgentsMd } from "./agents.mjs";
import { fetchMarketplace, resolvePluginDir } from "./github.mjs";
import { entryId, emptyLockfile, upsertLockEntry, writeLockfile } from "./lockfile.mjs";
import { HOSTS, pluginAssetRel } from "./paths.mjs";

const ASSET_SKIP = new Set([
  "skills",
  "agents",
  ".claude-plugin",
  ".cursor-plugin",
  "mcp.json",
]);

/** Relative paths that can point at plugin files outside a skill directory. */
const RELATIVE_PATH = /(?:\.\.?\/)+(?:[\w.@+-]+\/)*[\w.@+-]+/g;

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
 * Delete the files and MCP keys recorded for one resolved plugin.
 * Paths in the lock are owned by deck, including files that existed before install.
 */
export function removeInstalledFiles(projectRoot, record) {
  const removed = [];
  for (const rel of record?.paths || []) {
    const abs = path.join(projectRoot, rel);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(rel);
    }
  }

  for (const [mcpRel, keys] of Object.entries(record?.mcpKeys || {})) {
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

  return { removed };
}

/**
 * Drop lock entries that are no longer requested, and delete their files.
 */
export function pruneStaleEntries(projectRoot, pluginsDoc, lock) {
  const wanted = new Set((pluginsDoc.plugins || []).map((plugin) => entryId(plugin)));
  const kept = [];
  const removed = [];
  for (const record of lock?.plugins || []) {
    if (wanted.has(entryId(record))) {
      kept.push(record);
      continue;
    }
    removeInstalledFiles(projectRoot, record);
    removed.push(entryId(record));
  }
  return { lock: { ...lock, plugins: kept }, removed };
}

function replaceSkillDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter(from) {
      return path.basename(from) !== "DEFAULT_USAGE.md";
    },
  });
}

/**
 * Copy one plugin directory into Claude and Cursor project paths.
 * Replaces any previous copy of those paths. `previous` is the lock record
 * from the last sync, used to delete paths this version no longer ships.
 */
export function installFromPluginDir(projectRoot, entry, pluginDir, previous) {
  if (previous) removeInstalledFiles(projectRoot, previous);

  const id = entryId(entry);
  const paths = [];
  const mcpKeys = {};
  const agentsSnippets = [];
  const assetDirs = {};
  let pluginVersion = null;

  for (const manifestRel of [
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
  ]) {
    const mf = path.join(pluginDir, manifestRel);
    if (!fs.existsSync(mf)) continue;
    const manifest = JSON.parse(fs.readFileSync(mf, "utf8"));
    if (manifest.version) {
      pluginVersion = manifest.version;
      break;
    }
  }

  for (const host of Object.values(HOSTS)) {
    const assetRel = pluginAssetRel(host, id);
    const assetDir = path.join(projectRoot, assetRel);
    if (copyPluginAssets(pluginDir, assetDir)) {
      paths.push(assetRel);
    }
    assetDirs[host.skills] = assetDir;
  }

  const skills = listSkillDirs(pluginDir);
  for (const skill of skills) {
    const src = path.join(pluginDir, "skills", skill);
    const snippet = readDefaultUsage(pluginDir, skill);
    if (snippet) agentsSnippets.push(snippet);
    for (const host of Object.values(HOSTS)) {
      const rel = path.join(host.skills, skill);
      const dest = path.join(projectRoot, rel);
      replaceSkillDir(src, dest);
      rewriteSkillLinks(pluginDir, skill, dest, assetDirs[host.skills]);
      paths.push(rel);
    }
  }

  const agents = listAgentFiles(pluginDir);
  for (const agentFile of agents) {
    const src = path.join(pluginDir, "agents", agentFile);
    for (const host of Object.values(HOSTS)) {
      const rel = path.join(host.agents, agentFile);
      const dest = path.join(projectRoot, rel);
      fs.rmSync(dest, { force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      paths.push(rel);
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
      mcpKeys[host.mcp] = keys;
    }
  }

  paths.sort();
  agentsSnippets.sort((a, b) => a.skill.localeCompare(b.skill));
  return {
    id,
    skills: skills.length,
    agents: agents.length,
    mcp: mcpServers ? Object.keys(mcpServers).length : 0,
    pluginVersion,
    record: {
      marketplace: entry.marketplace,
      name: entry.name,
      ref: entry.ref,
      resolved: "",
      paths,
      mcpKeys,
      agentsSnippets,
    },
  };
}

/**
 * Fetch and copy one requested plugin. `lock` supplies the previous record
 * so paths that disappeared can be deleted.
 */
export function applyEntry(projectRoot, entry, lock) {
  const fetched = fetchMarketplace(entry.marketplace, entry.ref);
  const pluginDir = resolvePluginDir(fetched.root, entry.name);
  const previous = (lock?.plugins || []).find(
    (plugin) => entryId(plugin) === entryId(entry),
  );
  const installed = installFromPluginDir(projectRoot, entry, pluginDir, previous);
  return {
    ...installed,
    record: { ...installed.record, resolved: fetched.resolved },
    cache: fetched.root,
  };
}

/**
 * Install every requested plugin and drop lock records that are no longer requested.
 * Writes the lock after the prune and after each plugin so a later failure
 * still describes what is on disk. Rewrites AGENTS.md from locked snippets.
 */
export function applyAll(projectRoot, pluginsDoc, lock) {
  let current = pruneStaleEntries(
    projectRoot,
    pluginsDoc,
    lock ?? emptyLockfile(),
  ).lock;
  writeLockfile(projectRoot, current);
  const results = [];
  for (const entry of pluginsDoc.plugins) {
    const result = applyEntry(projectRoot, entry, current);
    current = upsertLockEntry(current, result.record);
    writeLockfile(projectRoot, current);
    results.push(result);
  }
  rewriteAgentsMd(projectRoot, current);
  return results;
}

/** Persist a lock entry and refresh the AGENTS.md skills block. */
export function commitLockAndAgents(projectRoot, lock) {
  writeLockfile(projectRoot, lock);
  return rewriteAgentsMd(projectRoot, lock);
}

