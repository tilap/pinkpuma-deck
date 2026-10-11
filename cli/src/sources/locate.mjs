import fs from "node:fs";
import path from "node:path";
import { fetchSource, pinDescriptor } from "./fetch.mjs";

/**
 * Find the plugin a request names inside a fetched tree, and list its
 * components the way Claude Code and Cursor would load them.
 *
 * @typedef {{ name: string, dir: string }} SkillRef
 * @typedef {{ rel: string, file: string }} FileRef
 * @typedef {{
 *   skills: SkillRef[], agents: FileRef[], commands: FileRef[], rules: FileRef[],
 *   hooks: { file?: string, inline?: object } | null,
 *   mcpServers: Record<string, object> | null,
 * }} Components
 * @typedef {{ name?: string, version?: string, description?: string, author?: object }} Meta
 * @typedef {{ dir: string, meta: Meta, components: Components, nested: import("./fetch.mjs").Resolved | null }} Located
 */

const MARKETPLACES = [".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json"];
const MANIFESTS = [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"];
const PATH_FIELDS = ["skills", "agents", "commands", "rules"];
const EXT = {
  agents: [".md", ".mdc", ".markdown"],
  commands: [".md", ".mdc", ".markdown", ".txt"],
  rules: [".md", ".mdc", ".markdown"],
};

/**
 * @param {string} root fetched source root
 * @param {import("./spec.mjs").Request} request
 * @param {{ nested?: import("./fetch.mjs").Resolved | null, fetch?: typeof fetchSource }} [options]
 * @returns {Promise<Located>}
 */
export async function locatePlugin(root, request, options = {}) {
  const fetch = options.fetch ?? fetchSource;
  const base = request.path ? insideOrThrow(root, request.path, "path") : root;
  if (!fs.existsSync(base)) {
    throw new Error(`${request.id}: path "${request.path}" does not exist in the source`);
  }

  const market = readMarketplace(base);
  let entry = null;
  if (market && market.plugins.length > 0) {
    if (request.plugin) {
      entry = market.plugins.find((p) => p.name === request.plugin) ?? null;
      if (!entry && !fs.existsSync(path.join(base, "plugins", request.plugin))) {
        throw new Error(
          `${request.id}: no plugin "${request.plugin}" in ${market.file}. Available: ${market.plugins.map((p) => p.name).join(", ")}`,
        );
      }
    } else if (market.plugins.length === 1) {
      entry = market.plugins[0];
    } else if (!(request.skills && hasSkills(base))) {
      throw new Error(
        `${request.id}: ${market.file} lists several plugins; pick one with @<plugin> or --plugin. Available: ${market.plugins.map((p) => p.name).join(", ")}`,
      );
    }
  }

  let dir = base;
  let nested = null;
  if (entry) {
    const target = await resolveEntrySource(base, market, entry, options.nested, fetch);
    dir = target.dir;
    nested = target.nested;
  } else if (request.plugin && fs.existsSync(path.join(base, "plugins", request.plugin))) {
    dir = path.join(base, "plugins", request.plugin);
  }

  const manifests = readManifests(dir);
  const declared = declaredComponents(manifests, entry, request.id);
  const components = collectComponents(dir, declared);

  if (request.skills) {
    const byName = new Map(components.skills.map((s) => [s.name, s]));
    const missing = request.skills.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new Error(
        `${request.id}: skill(s) ${missing.join(", ")} not found. Available: ${[...byName.keys()].join(", ") || "none"}`,
      );
    }
    components.skills = request.skills.map((name) => byName.get(name));
  }

  if (isEmpty(components)) {
    throw new Error(`${request.id}: nothing to install in ${dir} (no skills, agents, commands, rules, hooks, or MCP servers)`);
  }

  const meta = {
    ...pick(entry ?? {}, ["version", "description", "author"]),
    ...pick(manifests.claude ?? manifests.cursor ?? {}, ["name", "version", "description", "author"]),
  };
  return { dir, meta, components, nested };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${err.message}`);
  }
}

function readMarketplace(root) {
  for (const rel of MARKETPLACES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const doc = readJson(file);
    return {
      file: rel,
      plugins: Array.isArray(doc.plugins) ? doc.plugins.filter((p) => p && p.name) : [],
      pluginRoot: doc.metadata?.pluginRoot ?? doc.pluginRoot ?? null,
    };
  }
  return null;
}

function readManifests(dir) {
  const [claude, cursor] = MANIFESTS.map((rel) => {
    const file = path.join(dir, rel);
    return fs.existsSync(file) ? readJson(file) : null;
  });
  return { claude, cursor };
}

function insideOrThrow(root, rel, what) {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`${what} "${rel}" leaves the source directory`);
  }
  return abs;
}

/** An entry source: a path inside the marketplace, or an object naming another place. */
async function resolveEntrySource(base, market, entry, pinned, fetch) {
  const source = entry.source ?? "./";
  if (typeof source === "string") {
    const rel =
      source.startsWith("./") || source === "." || source.startsWith("../")
        ? source
        : path.posix.join(market.pluginRoot ?? ".", source);
    const dir = insideOrThrow(base, rel, `plugin "${entry.name}" source`);
    if (!fs.existsSync(dir)) {
      throw new Error(`Plugin "${entry.name}" source "${source}" is missing in the marketplace`);
    }
    return { dir, nested: null };
  }
  if (!source || typeof source !== "object") {
    throw new Error(`Plugin "${entry.name}" has an unreadable source`);
  }

  const { descriptor, subdir } = entryDescriptor(entry.name, source);
  const fetched = await fetch(pinDescriptor(descriptor, pinned));
  const dir = subdir ? insideOrThrow(fetched.root, subdir, `plugin "${entry.name}" path`) : fetched.root;
  if (!fs.existsSync(dir)) {
    throw new Error(`Plugin "${entry.name}": path "${subdir}" is missing in ${descriptor.url ?? descriptor.package}`);
  }
  return { dir, nested: fetched.resolved };
}

function githubUrl(value) {
  return /^[\w.-]+\/[\w.-]+$/.test(value) ? `https://github.com/${value}.git` : value;
}

/** Map a Claude Code marketplace source object to a fetch descriptor. */
export function entryDescriptor(name, source) {
  const pinned = {
    ...(source.ref ? { ref: source.ref } : {}),
    ...(source.sha ? { sha: source.sha } : {}),
  };
  switch (source.source) {
    case "github":
      if (!source.repo) throw new Error(`Plugin "${name}": github source needs repo`);
      return {
        descriptor: { type: "git", url: githubUrl(source.repo), repo: source.repo, ...pinned },
        subdir: source.path ?? null,
      };
    case "url":
    case "git":
      if (!source.url) throw new Error(`Plugin "${name}": ${source.source} source needs url`);
      return { descriptor: { type: "git", url: source.url, ...pinned }, subdir: source.path ?? null };
    case "git-subdir":
      if (!source.url || !source.path) {
        throw new Error(`Plugin "${name}": git-subdir source needs url and path`);
      }
      return {
        descriptor: {
          type: "git",
          url: githubUrl(source.url),
          ...(/^[\w.-]+\/[\w.-]+$/.test(source.url) ? { repo: source.url } : {}),
          ...pinned,
        },
        subdir: source.path,
      };
    case "npm":
      if (!source.package) throw new Error(`Plugin "${name}": npm source needs package`);
      return {
        descriptor: {
          type: "npm",
          package: source.package,
          ...(source.version ? { version: source.version } : {}),
          ...(source.registry ? { registry: source.registry } : {}),
        },
        subdir: null,
      };
    case "archive":
      if (!source.url) throw new Error(`Plugin "${name}": archive source needs url`);
      return {
        descriptor: { type: "archive", url: source.url, ...(source.sha256 ? { sha256: source.sha256 } : {}) },
        subdir: null,
      };
    default:
      throw new Error(
        `Plugin "${name}": source type "${source.source}" is not supported by deck (supported: path, github, url, git-subdir, npm, archive)`,
      );
  }
}

/**
 * Component declarations from plugin.json (Claude first, Cursor for what Claude
 * does not say) and from the marketplace entry, with Claude Code's strict rules:
 *   no plugin.json      → the entry is the manifest
 *   strict (default)    → entry component paths are added to plugin.json's
 *   strict: false       → an entry that declares components is a conflict
 */
function declaredComponents(manifests, entry, id) {
  const declared = {};
  for (const manifest of [manifests.claude, manifests.cursor]) {
    if (!manifest) continue;
    for (const field of [...PATH_FIELDS, "hooks", "mcpServers"]) {
      if (manifest[field] != null && declared[field] == null) declared[field] = manifest[field];
    }
  }
  if (!entry) return declared;

  const hasManifest = Boolean(manifests.claude || manifests.cursor);
  const entryFields = [...PATH_FIELDS, "hooks", "mcpServers"].filter((f) => entry[f] != null);
  if (entryFields.length === 0) return declared;
  if (hasManifest && entry.strict === false) {
    throw new Error(
      `${id}: plugin "${entry.name}" has conflicting manifests: both plugin.json and its strict:false marketplace entry declare components`,
    );
  }
  for (const field of entryFields) {
    if (!hasManifest || declared[field] == null) {
      declared[field] = entry[field];
    } else if (PATH_FIELDS.includes(field)) {
      declared[field] = [...asList(declared[field]), ...asList(entry[field])];
    } else if (field === "hooks") {
      declared.hooks = entry.hooks;
    }
  }
  return declared;
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

function collectComponents(dir, declared) {
  return {
    skills: collectSkills(dir, declared.skills),
    agents: collectFiles(dir, "agents", declared.agents),
    commands: collectFiles(dir, "commands", declared.commands),
    rules: collectFiles(dir, "rules", declared.rules),
    hooks: collectHooks(dir, declared.hooks),
    mcpServers: collectMcp(dir, declared.mcpServers),
  };
}

function hasSkills(dir) {
  return collectSkills(dir, undefined).length > 0;
}

/** A declared path is a skill directory, or a directory of skill directories. */
function collectSkills(dir, declared) {
  const found = new Map();
  const add = (skillDir) => {
    const name = skillName(skillDir);
    if (!found.has(name)) found.set(name, { name, dir: skillDir });
  };
  const scan = (abs) => {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
    if (fs.existsSync(path.join(abs, "SKILL.md"))) {
      add(abs);
      return;
    }
    for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
      if (child.isDirectory() && fs.existsSync(path.join(abs, child.name, "SKILL.md"))) {
        add(path.join(abs, child.name));
      }
    }
  };

  if (declared != null) {
    for (const rel of asList(declared)) {
      if (typeof rel === "string") scan(insideOrThrow(dir, rel, "skills path"));
    }
  } else if (fs.existsSync(path.join(dir, "skills"))) {
    scan(path.join(dir, "skills"));
  } else if (fs.existsSync(path.join(dir, "SKILL.md"))) {
    add(dir);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `name:` from the SKILL.md front matter, else the directory name. */
export function skillName(skillDir) {
  const text = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = front?.[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
  return (name || path.basename(skillDir)).trim();
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function collectFiles(dir, kind, declared) {
  const roots = declared != null
    ? asList(declared).filter((rel) => typeof rel === "string").map((rel) => insideOrThrow(dir, rel, `${kind} path`))
    : [path.join(dir, kind)];
  const files = [];
  for (const abs of roots) {
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) {
      files.push({ rel: path.basename(abs), file: abs });
      continue;
    }
    for (const file of walk(abs)) {
      if (!EXT[kind].some((ext) => file.endsWith(ext))) continue;
      if (path.basename(file).toLowerCase() === "readme.md") continue;
      files.push({ rel: path.relative(abs, file), file });
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

function collectHooks(dir, declared) {
  if (declared && typeof declared === "object" && !Array.isArray(declared)) {
    return { inline: declared };
  }
  const rel = typeof declared === "string" ? declared : "hooks/hooks.json";
  const file = insideOrThrow(dir, rel, "hooks path");
  return fs.existsSync(file) ? { file } : null;
}

function mcpFromFile(file) {
  const raw = readJson(file);
  if (raw?.mcpServers && typeof raw.mcpServers === "object") return raw.mcpServers;
  return raw && typeof raw === "object" ? raw : null;
}

function collectMcp(dir, declared) {
  if (declared != null) {
    const merged = {};
    for (const item of asList(declared)) {
      if (typeof item === "string") Object.assign(merged, mcpFromFile(insideOrThrow(dir, item, "mcpServers path")) ?? {});
      else if (item && typeof item === "object") Object.assign(merged, item);
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }
  for (const rel of ["mcp.json", ".mcp.json"]) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) {
      const servers = mcpFromFile(file);
      if (servers && Object.keys(servers).length > 0) return servers;
    }
  }
  return null;
}

function isEmpty(c) {
  return (
    c.skills.length === 0 &&
    c.agents.length === 0 &&
    c.commands.length === 0 &&
    c.rules.length === 0 &&
    !c.hooks &&
    !c.mcpServers
  );
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj[key] != null) out[key] = obj[key];
  return out;
}
