import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const PLUGIN_VERSION = "0.1.0";

const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);

const MARKETPLACE_TEMPLATE_ROOT = path.join(TEMPLATES_DIR, "marketplace");
const PLUGIN_TEMPLATE_ROOT = path.join(TEMPLATES_DIR, "plugin");

/**
 * @param {{ name: string, owner: string, parentDir: string }} opts
 * @returns {{ root: string }}
 */
export function scaffoldMarketplace({ name, owner, parentDir }) {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid marketplace name "${name ?? ""}" — use lowercase letters, digits, hyphens (e.g. my-marketplace)`,
    );
  }
  const ownerName = typeof owner === "string" ? owner.trim() : "";
  if (!ownerName) {
    throw new Error(`scaffold requires --owner <name>`);
  }

  const root = path.resolve(parentDir, name);
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${root}`);
    }
  } else {
    fs.mkdirSync(root, { recursive: true });
  }

  copyTemplateTree(MARKETPLACE_TEMPLATE_ROOT, root, { NAME: name, OWNER: ownerName });
  return { root };
}

/**
 * @param {{
 *   name: string,
 *   description: string,
 *   owner?: string,
 *   marketplaceDir: string,
 * }} opts
 * @returns {{ root: string, readmeUpdated: boolean, warnings: string[] }}
 */
export function scaffoldPlugin({ name, description, owner, marketplaceDir }) {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid plugin name "${name ?? ""}" — use lowercase letters, digits, hyphens (e.g. my-plugin)`,
    );
  }
  const desc = typeof description === "string" ? description.trim() : "";
  if (!desc) {
    throw new Error(`scaffold plugin requires --description <text>`);
  }
  if (desc.includes("\n") || desc.includes("\r")) {
    throw new Error(`--description must be a single line`);
  }

  const marketRoot = path.resolve(marketplaceDir);
  const marketPath = path.join(marketRoot, ".claude-plugin", "marketplace.json");
  if (!fs.existsSync(marketPath)) {
    throw new Error(
      `Not a marketplace root (missing .claude-plugin/marketplace.json): ${marketRoot}`,
    );
  }

  /** @type {{ name?: string, owner?: { name?: string }, plugins?: Array<{ name: string }> }} */
  const market = JSON.parse(fs.readFileSync(marketPath, "utf8"));
  if (!Array.isArray(market.plugins)) {
    market.plugins = [];
  }

  const ownerName =
    (typeof owner === "string" ? owner.trim() : "") ||
    (typeof market.owner?.name === "string" ? market.owner.name.trim() : "");
  if (!ownerName) {
    throw new Error(
      `scaffold plugin requires --owner <name> (or owner.name in marketplace.json)`,
    );
  }

  if (market.plugins.some((plugin) => plugin.name === name)) {
    throw new Error(`Plugin already listed in marketplace.json: ${name}`);
  }

  const root = path.join(marketRoot, "plugins", name);
  if (fs.existsSync(root)) {
    throw new Error(`Plugin directory already exists: ${root}`);
  }

  fs.mkdirSync(path.dirname(root), { recursive: true });
  copyTemplateTree(PLUGIN_TEMPLATE_ROOT, root, {
    NAME: name,
    DESCRIPTION: desc,
    OWNER: ownerName,
    VERSION: PLUGIN_VERSION,
  });

  // Re-write manifests with JSON.stringify so description/owner are safely escaped
  const manifest = {
    name,
    version: PLUGIN_VERSION,
    description: desc,
    author: { name: ownerName },
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), manifestJson);
  fs.writeFileSync(path.join(root, ".cursor-plugin", "plugin.json"), manifestJson);

  market.plugins.push({
    name,
    source: `./plugins/${name}`,
    description: desc,
  });
  fs.writeFileSync(marketPath, `${JSON.stringify(market, null, 2)}\n`);

  const warnings = [];
  const readmeUpdated = appendReadmePluginRow(marketRoot, name, desc, warnings);

  return { root, readmeUpdated, warnings };
}

/**
 * @param {string} marketRoot
 * @param {string} name
 * @param {string} description
 * @param {string[]} warnings
 * @returns {boolean}
 */
function appendReadmePluginRow(marketRoot, name, description, warnings) {
  const readmePath = path.join(marketRoot, "README.md");
  if (!fs.existsSync(readmePath)) {
    warnings.push("No README.md — add a Plugins table row yourself");
    return false;
  }
  const text = fs.readFileSync(readmePath, "utf8");
  const lines = text.split("\n");
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|\s*Plugin\s*\|/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    warnings.push("README.md has no Plugins table — add a row yourself");
    return false;
  }
  let insertAt = headerIdx + 1;
  if (insertAt < lines.length && /^\|\s*-+/.test(lines[insertAt])) {
    insertAt += 1;
  }
  while (
    insertAt < lines.length &&
    lines[insertAt].trim().startsWith("|") &&
    !/^\|\s*-+/.test(lines[insertAt])
  ) {
    insertAt += 1;
  }
  const row = `| [${name}](plugins/${name}) | ${description} |`;
  lines.splice(insertAt, 0, row);
  fs.writeFileSync(readmePath, lines.join("\n"));
  return true;
}

/**
 * @param {string} from
 * @param {string} to
 * @param {Record<string, string>} vars
 */
function copyTemplateTree(from, to, vars) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    // npm omits .gitignore from published packages — ship as "gitignore", write as ".gitignore"
    let outName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    // Dynamic skill dir: templates use __NAME__
    if (outName === "__NAME__") outName = vars.NAME;
    const dest = path.join(to, outName);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTemplateTree(src, dest, vars);
      continue;
    }
    const raw = fs.readFileSync(src, "utf8");
    fs.writeFileSync(dest, substitute(raw, vars), "utf8");
  }
}

/**
 * @param {string} text
 * @param {Record<string, string>} vars
 */
function substitute(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) {
      throw new Error(`Unknown template variable {{${key}}}`);
    }
    return vars[key];
  });
}
