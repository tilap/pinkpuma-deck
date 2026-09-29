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
  },
  cursor: {
    skills: ".cursor/skills",
    agents: ".cursor/agents",
    mcp: ".cursor/mcp.json",
  },
};

export function lockPath(projectRoot) {
  return `${projectRoot}/${LOCK_FILE}`;
}

export function vendorManifestPath(projectRoot, entryId) {
  const safe = entryId.replace(/[^a-zA-Z0-9._@+-]+/g, "__");
  return `${projectRoot}/${VENDOR_MANIFEST_DIR}/${safe}.json`;
}
