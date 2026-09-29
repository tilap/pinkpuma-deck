/** Shared paths and lockfile location for @pinkpuma/deck. */

export const LOCK_DIR = ".agent";
export const LOCK_FILE = ".agent/plugins.lock.json";
export const VENDOR_MANIFEST_DIR = ".agent/vendor";

/** Where plugin components are copied for each host. */
export const HOSTS = {
  claude: {
    skills: ".claude/skills",
    agents: ".claude/agents",
    mcp: ".mcp.json",
    plugins: ".claude/plugins",
  },
  cursor: {
    skills: ".cursor/skills",
    agents: ".cursor/agents",
    mcp: ".cursor/mcp.json",
    plugins: ".cursor/plugins",
  },
};

export function lockPath(projectRoot) {
  return `${projectRoot}/${LOCK_FILE}`;
}

/** Filesystem-safe fragment of a marketplace id or entry id. */
export function safeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._@+-]+/g, "__");
}

export function vendorManifestPath(projectRoot, entryId) {
  return `${projectRoot}/${VENDOR_MANIFEST_DIR}/${safeSegment(entryId)}.json`;
}

/** Per-plugin support files (conventions, scripts, templates) for one host. */
export function pluginAssetRel(host, entryId) {
  return `${host.plugins}/${safeSegment(entryId)}`;
}
