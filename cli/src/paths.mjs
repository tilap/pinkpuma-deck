/** Shared paths for @pinkpuma/deck. */

export const PLUGINS_FILE = "ai-plugin.json";
export const LOCAL_PLUGINS_FILE = "ai-plugin.local.json";
export const LOCK_FILE = "ai-plugin.lock.json";

/** Everything AI-tooling in a project lives under .ai/. */
export const AI_DIR = ".ai";
/** Like node_modules: one normalized plugin per id, and what deck wrote here. Never committed. */
export const INSTALLED_DIR = `${AI_DIR}/installed`;
export const STATE_FILE = `${INSTALLED_DIR}/state.json`;

/** Where copy mode writes plugin components for each host. */
export const HOSTS = {
  claude: {
    skills: ".claude/skills",
    agents: ".claude/agents",
    commands: ".claude/commands",
    rules: null,
    mcp: ".mcp.json",
    plugins: ".claude/plugins",
    rootVar: "CLAUDE_PLUGIN_ROOT",
  },
  cursor: {
    skills: ".cursor/skills",
    agents: ".cursor/agents",
    commands: ".cursor/commands",
    rules: ".cursor/rules",
    mcp: ".cursor/mcp.json",
    plugins: ".cursor/plugins",
    rootVar: "CURSOR_PLUGIN_ROOT",
  },
};

export function pluginsPath(projectRoot) {
  return `${projectRoot}/${PLUGINS_FILE}`;
}

export function localPluginsPath(projectRoot) {
  return `${projectRoot}/${LOCAL_PLUGINS_FILE}`;
}

export function lockPath(projectRoot) {
  return `${projectRoot}/${LOCK_FILE}`;
}

export function deckPluginRel(id) {
  return `${INSTALLED_DIR}/plugins/${id}`;
}

/** Filesystem-safe fragment of a marketplace id or entry id. */
export function safeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._@+-]+/g, "__");
}

/** Per-plugin support files (conventions, scripts, templates) for one host. */
export function pluginAssetRel(host, id) {
  return `${host.plugins}/${safeSegment(id)}`;
}
