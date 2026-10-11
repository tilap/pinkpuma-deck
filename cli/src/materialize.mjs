import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DECK_DIR, deckPluginRel } from "./paths.mjs";

/**
 * Write a located plugin to `.deck/plugins/<id>/` in the layout both hosts read
 * without help: skills/, agents/, commands/, rules/, hooks/hooks.json, mcp.json,
 * the plugin's support files, and freshly generated manifests.
 *
 * Only the components the request selected are written. The tree is what
 * `--plugin-dir`, Claude's local marketplace, and copy mode all read.
 */

const COMPONENT_DIRS = new Set(["skills", "agents", "commands", "rules", "hooks"]);
const SKIP_TOP = new Set([
  ".git",
  ".github",
  ".claude-plugin",
  ".cursor-plugin",
  "plugin.json",
  "mcp.json",
  ".mcp.json",
  "marketplace.json",
]);
const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** Plugin manifest name: Cursor wants lowercase kebab-case, Claude accepts it. */
export function pluginName(id) {
  return id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}

function copyFiltered(src, dest, skip = () => false) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => {
      const rel = path.relative(src, from);
      if (rel === "") return true;
      const first = rel.split(path.sep)[0];
      return first !== ".git" && !skip(rel, from);
    },
  });
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {import("./sources/locate.mjs").Located} located
 * @param {{ fallbackVersion?: string }} [options] version for a plugin that declares none
 */
export function materialize(projectRoot, id, located, { fallbackVersion } = {}) {
  const rel = deckPluginRel(id);
  const dest = path.join(projectRoot, rel);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const { dir, components, meta } = located;

  // Support files keep their place so a skill's ../../CONVENTIONS.md still resolves.
  const skillIsRoot = components.skills.some((s) => path.resolve(s.dir) === path.resolve(dir));
  if (!skillIsRoot) {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_TOP.has(name) || COMPONENT_DIRS.has(name) || /^\.[\w-]+-plugin$/.test(name)) continue;
      copyFiltered(path.join(dir, name), path.join(dest, name));
    }
  }

  const snippets = [];
  for (const skill of components.skills) {
    const usage = path.join(skill.dir, "DEFAULT_USAGE.md");
    if (fs.existsSync(usage)) {
      const body = fs.readFileSync(usage, "utf8").trimEnd();
      if (body) snippets.push({ skill: skill.name, body });
    }
    const skillDest = path.join(dest, "skills", skill.name);
    copyFiltered(skill.dir, skillDest, (relPath) =>
      relPath === "DEFAULT_USAGE.md" ||
      // A root SKILL.md plugin: do not copy nested plugin metadata into the skill.
      (skillIsRoot && SKIP_TOP.has(relPath.split(path.sep)[0])),
    );
  }

  for (const kind of ["agents", "commands", "rules"]) {
    for (const item of components[kind]) {
      const target = path.join(dest, kind, item.rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(item.file, target);
    }
  }

  if (components.hooks) {
    const target = path.join(dest, "hooks", "hooks.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (components.hooks.file) {
      fs.copyFileSync(components.hooks.file, target);
    } else {
      const inline = components.hooks.inline;
      writeJson(target, inline.hooks ? inline : { hooks: inline });
    }
  }

  if (components.mcpServers) {
    writeJson(path.join(dest, "mcp.json"), { mcpServers: components.mcpServers });
  }

  const version = meta.version ? String(meta.version) : fallbackVersion;
  const manifest = {
    name: pluginName(id),
    ...(version ? { version } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.author && typeof meta.author === "object" ? { author: meta.author } : {}),
  };
  writeJson(path.join(dest, ".claude-plugin", "plugin.json"), manifest);
  writeJson(path.join(dest, ".cursor-plugin", "plugin.json"), manifest);
  writeJson(path.join(dest, "plugin.json"), {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: manifest.name,
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
  });

  return {
    rel,
    dir: dest,
    integrity: treeIntegrity(dest),
    components: summarize(components),
    agentsSnippets: snippets.sort((a, b) => a.skill.localeCompare(b.skill)),
    pluginVersion: meta.version ?? null,
  };
}

export function summarize(components) {
  return {
    skills: components.skills.map((s) => s.name),
    agents: components.agents.map((a) => a.rel),
    commands: components.commands.map((c) => c.rel),
    rules: components.rules.map((r) => r.rel),
    hooks: Boolean(components.hooks),
    mcp: Object.keys(components.mcpServers ?? {}).sort(),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** sha256 over sorted relative paths, executable bits, and contents. */
export function treeIntegrity(dir) {
  const files = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk(dir);
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join("/");
    const exec = fs.statSync(file).mode & 0o111 ? "x" : "-";
    hash.update(`${rel}\0${exec}\0`);
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}

/** `.deck/.claude-plugin/marketplace.json`: the local marketplace Claude installs from. */
export function writeDeckMarketplace(projectRoot, ids) {
  const file = path.join(projectRoot, DECK_DIR, ".claude-plugin", "marketplace.json");
  writeJson(file, {
    name: "deck",
    owner: { name: "@pinkpuma/deck" },
    description: "Plugins installed by @pinkpuma/deck for this project",
    plugins: [...ids].sort().map((id) => ({ name: pluginName(id), source: `./plugins/${id}` })),
  });
  return file;
}

export function removeMaterialized(projectRoot, id) {
  fs.rmSync(path.join(projectRoot, deckPluginRel(id)), { recursive: true, force: true });
}
