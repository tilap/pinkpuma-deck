import fs from "node:fs";
import path from "node:path";
import { STATE_FILE } from "./paths.mjs";

/**
 * What deck wrote on this machine, per plugin id. Never committed: paths and
 * MCP keys depend on the host modes chosen here, not on what was resolved.
 * @typedef {{ paths: string[], mcpKeys: Record<string, string[]>, settings?: Record<string, string[]> }} StateEntry
 * @typedef {{ version: 1, plugins: Record<string, StateEntry> }} State
 */

export function emptyState() {
  return { version: 1, plugins: {} };
}

export function readState(projectRoot) {
  const file = path.join(projectRoot, STATE_FILE);
  if (!fs.existsSync(file)) return emptyState();
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw?.version !== 1 || typeof raw.plugins !== "object") return emptyState();
  return raw;
}

export function writeState(projectRoot, state) {
  const file = path.join(projectRoot, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const plugins = Object.fromEntries(
    Object.keys(state.plugins)
      .sort()
      .map((id) => [id, state.plugins[id]]),
  );
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, plugins }, null, 2)}\n`, "utf8");
}

/** Which plugin id wrote a project path, if any. */
export function ownerOf(state, rel) {
  for (const [id, entry] of Object.entries(state.plugins)) {
    if (entry.paths?.includes(rel)) return id;
  }
  return null;
}
