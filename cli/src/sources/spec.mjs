/**
 * Request model shared by ai-plugin.json, ai-plugin.local.json and the lock.
 *
 * A request says what to install, not what was installed:
 *   { id, source, plugin?, skills?, path?, ref?, version?, sha256? }
 *
 * `source` is a prefixed string:
 *   github:owner/repo     a GitHub repository
 *   git:<url>             any git repository (https, ssh, file)
 *   npm:<package>         an npm package (`version` picks the version or range)
 *   archive:<https url>   a .zip or .tar.gz download (`sha256` pins the bytes)
 *   local:<abs path>      a working tree on this machine (deck link only)
 *
 * @typedef {{ id: string, source: string, plugin?: string, skills?: string[], path?: string, ref?: string, version?: string, sha256?: string, from?: string }} Request
 * @typedef {{ type: "git", url: string, ref?: string, sha?: string, repo?: string }
 *   | { type: "npm", package: string, version?: string, registry?: string }
 *   | { type: "archive", url: string, sha256?: string }
 *   | { type: "local", path: string }} Descriptor
 */

const ID = /^[a-z0-9][a-z0-9._-]*$/i;
const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;
const OPTIONAL_KEYS = ["plugin", "path", "ref", "version", "sha256", "from"];

export function isValidId(id) {
  return typeof id === "string" && ID.test(id) && !id.includes("..");
}

/** Validate one request object and drop unknown or empty fields. */
export function normalizeRequest(raw, where = "request") {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${where} is not an object`);
  }
  if (!isValidId(raw.id)) {
    throw new Error(`${where} needs an id made of letters, digits, ".", "_" or "-" (got "${raw.id}")`);
  }
  if (typeof raw.source !== "string" || !raw.source.includes(":")) {
    throw new Error(`${where} (${raw.id}) needs a source such as github:owner/repo`);
  }
  descriptorFor({ source: raw.source }, where);
  const out = { id: raw.id, source: raw.source };
  for (const key of OPTIONAL_KEYS) {
    if (raw[key] == null || raw[key] === "") continue;
    if (typeof raw[key] !== "string") {
      throw new Error(`${where} (${raw.id}).${key} must be a string`);
    }
    out[key] = raw[key];
  }
  if (raw.skills != null) {
    if (!Array.isArray(raw.skills) || raw.skills.some((s) => typeof s !== "string" || !s)) {
      throw new Error(`${where} (${raw.id}).skills must be a list of skill names`);
    }
    if (raw.skills.length > 0) out.skills = [...new Set(raw.skills)].sort();
  }
  if (out.path && (out.path.startsWith("/") || out.path.split("/").includes(".."))) {
    throw new Error(`${where} (${raw.id}).path must stay inside the source`);
  }
  return out;
}

/** deck <= 0.6 wrote `{ marketplace, name, ref }`. */
export function isLegacyRequest(raw) {
  return raw && typeof raw === "object" && !raw.source && raw.marketplace && raw.name;
}

export function fromLegacyRequest(raw) {
  return {
    id: raw.name,
    source: `github:${raw.marketplace}`,
    plugin: raw.name,
    ...(raw.ref ? { ref: raw.ref } : {}),
    ...(raw.from ? { from: raw.from } : {}),
  };
}

/**
 * Where to fetch a request's bytes from. `ref` and `sha` come from the request
 * or, for a reproducible install, from the lock.
 * @param {Pick<Request, "source" | "ref" | "version" | "sha256">} request
 * @returns {Descriptor}
 */
export function descriptorFor(request, where = "request") {
  const at = request.source.indexOf(":");
  const kind = request.source.slice(0, at);
  const value = request.source.slice(at + 1);
  if (!value) throw new Error(`${where}: empty source "${request.source}"`);
  switch (kind) {
    case "github":
      if (!GITHUB_REPO.test(value)) {
        throw new Error(`${where}: github source must be owner/repo (got "${value}")`);
      }
      return {
        type: "git",
        url: `https://github.com/${value}.git`,
        repo: value,
        ...(request.ref ? { ref: request.ref } : {}),
      };
    case "git":
      return { type: "git", url: value, ...(request.ref ? { ref: request.ref } : {}) };
    case "npm":
      return { type: "npm", package: value, ...(request.version ? { version: request.version } : {}) };
    case "archive":
      if (!value.startsWith("https://")) {
        throw new Error(`${where}: archive source must be an https URL`);
      }
      return { type: "archive", url: value, ...(request.sha256 ? { sha256: request.sha256 } : {}) };
    case "local":
      return { type: "local", path: value };
    default:
      throw new Error(`${where}: unknown source kind "${kind}" in "${request.source}"`);
  }
}

/** Default id: the plugin name, else the last path or repository segment. */
export function defaultId({ source, plugin, path }) {
  const raw =
    plugin ||
    (path ? path.split("/").filter(Boolean).pop() : null) ||
    source
      .slice(source.indexOf(":") + 1)
      .replace(/[#?].*$/, "")
      .replace(/\.git$/, "")
      .replace(/\.(zip|tgz|tar\.gz)$/, "")
      .replace(/@[^/]*$/, "")
      .split(/[/:]/)
      .filter(Boolean)
      .pop();
  return (raw || "plugin").replace(/^@/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * Parse what a user types after `deck add` into a request.
 *
 *   owner/repo@plugin            plugin from a GitHub marketplace
 *   owner/repo                   single plugin, or a skills repository
 *   owner/repo/plugin            legacy form of owner/repo@plugin
 *   https://github.com/o/r       same as o/r
 *   git+<url>[#ref]              any git host
 *   git@host:o/r.git[#ref]       ssh git URL
 *   npm:<package>[@version]      npm package
 *   https://….zip | .tar.gz      archive
 *
 * Flags: { ref, plugin, skills, path, id, sha256 } override what the spec says.
 * @returns {Request}
 */
export function parseAddSpec(spec, flags = {}) {
  if (!spec) throw new Error("add requires a source (owner/repo@plugin, git+URL, npm:pkg, https://….zip)");
  let request;

  if (spec.startsWith("npm:")) {
    const body = spec.slice(4);
    const at = body.lastIndexOf("@");
    const hasVersion = at > 0;
    request = {
      source: `npm:${hasVersion ? body.slice(0, at) : body}`,
      ...(hasVersion ? { version: body.slice(at + 1) } : {}),
    };
  } else if (/^https:\/\/.+\.(zip|tgz|tar\.gz)(\?.*)?$/.test(spec)) {
    request = { source: `archive:${spec}` };
  } else if (spec.startsWith("git+") || spec.startsWith("git@") || spec.startsWith("ssh://")) {
    const { rest, plugin } = splitPlugin(spec.startsWith("git+") ? spec.slice(4) : spec);
    const url = rest;
    const hash = url.indexOf("#");
    const github = githubFromUrl(hash === -1 ? url : url.slice(0, hash));
    request = {
      source: github ? `github:${github}` : `git:${hash === -1 ? url : url.slice(0, hash)}`,
      ...(hash === -1 ? {} : { ref: url.slice(hash + 1) }),
      ...(plugin ? { plugin } : {}),
    };
  } else if (spec.startsWith("https://") || spec.startsWith("http://")) {
    const { rest, plugin } = splitPlugin(spec);
    const [url, ref] = rest.split("#");
    const github = githubFromUrl(url);
    request = {
      source: github ? `github:${github}` : `git:${url}`,
      ...(ref ? { ref } : {}),
      ...(plugin ? { plugin } : {}),
    };
  } else {
    const at = spec.match(/^([\w.-]+\/[\w.-]+)@([^@/]+)$/);
    const parts = spec.split("/");
    if (at) {
      request = { source: `github:${at[1]}`, plugin: at[2] };
    } else if (parts.length === 2 && GITHUB_REPO.test(spec)) {
      request = { source: `github:${spec}` };
    } else if (parts.length >= 3 && GITHUB_REPO.test(`${parts[0]}/${parts[1]}`)) {
      request = { source: `github:${parts[0]}/${parts[1]}`, plugin: parts.slice(2).join("/") };
    } else {
      throw new Error(
        `Cannot read "${spec}". Use owner/repo@plugin, owner/repo, git+<url>, npm:<package>, or an https .zip URL`,
      );
    }
  }

  for (const key of ["ref", "plugin", "path", "sha256"]) {
    if (flags[key]) request[key] = flags[key];
  }
  if (flags.skills?.length) request.skills = flags.skills;
  request.id = flags.id || defaultId(request);
  return normalizeRequest(request, `"${spec}"`);
}

/**
 * A trailing `@plugin` after a git URL (and its `#ref`). The `@` of an SSH user
 * (`git@host:…`) is not one: what follows it holds a `:` or a `/`.
 */
function splitPlugin(value) {
  const at = value.lastIndexOf("@");
  if (at <= 0) return { rest: value, plugin: undefined };
  const tail = value.slice(at + 1);
  if (!tail || /[/:#]/.test(tail)) return { rest: value, plugin: undefined };
  return { rest: value.slice(0, at), plugin: tail };
}

/** owner/repo for a github.com URL, else null. */
export function githubFromUrl(url) {
  const cleaned = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match =
    cleaned.match(/^git@github\.com:([^/]+)\/([^/]+)$/) ||
    cleaned.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/) ||
    cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Two requests ask for the same thing (the lock pin still applies). */
export function sameRequest(a, b) {
  return JSON.stringify(normalizeRequest(stripLocal(a))) === JSON.stringify(normalizeRequest(stripLocal(b)));
}

function stripLocal(request) {
  const { from, ...rest } = request;
  return rest;
}
