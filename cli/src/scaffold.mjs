import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const TEMPLATE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "marketplace",
);

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

  copyTemplateTree(TEMPLATE_ROOT, root, { NAME: name, OWNER: ownerName });
  return { root };
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
    const outName = entry.name === "gitignore" ? ".gitignore" : entry.name;
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
