#!/usr/bin/env node
import path from "node:path";
import {
  applyAll,
  applyEntry,
  commitLockAndAgents,
  removeInstalledFiles,
} from "./apply.mjs";
import {
  emptyLockfile,
  entryId,
  parsePluginSpec,
  readLockfile,
  removeLockEntry,
  setWriteAgentsMd,
  upsertLockEntry,
} from "./lockfile.mjs";
import { LOCK_FILE, PLUGINS_FILE } from "./paths.mjs";
import {
  addPlugin,
  ensurePlugins,
  readPlugins,
  removePlugin,
  writePlugins,
} from "./plugins.mjs";

function usage() {
  return `deck (@pinkpuma/deck) — sync marketplace plugins into a project

Usage:
  deck init [--project <dir>]
  deck add <owner/repo@plugin> [--ref <ref>] [--project <dir>] [--no-sync] [--no-agents-md|--agents-md]
  deck remove <owner/repo@plugin> [--project <dir>] [--keep-files] [--no-agents-md|--agents-md]
  deck sync [--project <dir>] [--no-agents-md|--agents-md]
  deck list [--project <dir>]

Request: ${PLUGINS_FILE}
Lock:    ${LOCK_FILE}
Copies skills/agents into .claude/ and .cursor/, plus per-plugin support files
under .claude/plugins and .cursor/plugins. Merges MCP into .mcp.json and .cursor/mcp.json.
Recorded paths are replaced on sync and deleted on remove.
When AGENTS.md exists and lock.writeAgentsMd is true (default), sync rewrites a marked
Skills block from each skill's DEFAULT_USAGE.md. --no-agents-md sets writeAgentsMd to
false in the lock and removes that block; --agents-md turns it back on.
`;
}

function parseArgs(argv) {
  const args = {
    _: [],
    project: process.cwd(),
    sync: true,
    keepFiles: false,
    ref: "main",
    writeAgentsMd: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project" || a === "-C") {
      args.project = path.resolve(argv[++i] || "");
    } else if (a === "--ref") {
      args.ref = argv[++i] || "main";
    } else if (a === "--no-sync") {
      args.sync = false;
    } else if (a === "--keep-files") {
      args.keepFiles = true;
    } else if (a === "--no-agents-md") {
      args.writeAgentsMd = false;
    } else if (a === "--agents-md") {
      args.writeAgentsMd = true;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      args._.push(a);
    }
  }
  return args;
}

function withAgentsMdPreference(lock, writeAgentsMd) {
  if (writeAgentsMd === undefined) return lock;
  return setWriteAgentsMd(lock, writeAgentsMd);
}

function printResults(results) {
  for (const result of results) {
    console.log(
      `  ${result.id}: skills=${result.skills} agents=${result.agents} mcp=${result.mcp}` +
        (result.pluginVersion ? ` (plugin v${result.pluginVersion})` : "") +
        (result.record?.resolved ? ` resolved=${result.record.resolved}` : ""),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const [cmd, ...rest] = args._;
  const root = args.project;

  switch (cmd) {
    case "init": {
      const doc = ensurePlugins(root);
      console.log(`Wrote ${PLUGINS_FILE} (${doc.plugins.length} plugins)`);
      break;
    }
    case "add": {
      const spec = rest[0];
      if (!spec) throw new Error("add requires owner/repo@plugin");
      const { marketplace, name } = parsePluginSpec(spec);
      const doc = addPlugin(ensurePlugins(root), {
        marketplace,
        name,
        ref: args.ref,
      });
      writePlugins(root, doc);
      const entry = doc.plugins.find(
        (plugin) => plugin.marketplace === marketplace && plugin.name === name,
      );
      if (!args.sync) {
        console.log(`Added ${entryId(entry)} @ ${args.ref} to ${PLUGINS_FILE}`);
        break;
      }
      const lock = withAgentsMdPreference(
        readLockfile(root) ?? emptyLockfile(),
        args.writeAgentsMd,
      );
      const result = applyEntry(root, entry, lock);
      commitLockAndAgents(root, upsertLockEntry(lock, result.record));
      console.log(`Locked ${entryId(entry)} @ ${args.ref}`);
      console.log("Applied:");
      printResults([result]);
      break;
    }
    case "remove": {
      const spec = rest[0];
      if (!spec) throw new Error("remove requires owner/repo@plugin");
      const doc = readPlugins(root);
      if (!doc) throw new Error(`No ${PLUGINS_FILE} — run init or add first`);
      const { marketplace, name } = parsePluginSpec(spec);
      const lock = withAgentsMdPreference(
        readLockfile(root) ?? emptyLockfile(),
        args.writeAgentsMd,
      );
      const record = lock.plugins.find(
        (plugin) => plugin.marketplace === marketplace && plugin.name === name,
      );
      const nextDoc = removePlugin(doc, spec);
      if (record && !args.keepFiles) removeInstalledFiles(root, record);
      writePlugins(root, nextDoc);
      commitLockAndAgents(root, removeLockEntry(lock, spec));
      console.log(`Removed ${entryId({ marketplace, name })}`);
      break;
    }
    case "sync":
    case "apply": {
      const doc = readPlugins(root);
      if (!doc) throw new Error(`No ${PLUGINS_FILE} — run init or add first`);
      if (doc.plugins.length === 0) {
        const lock = withAgentsMdPreference(
          readLockfile(root) ?? emptyLockfile(),
          args.writeAgentsMd,
        );
        applyAll(root, doc, lock);
        console.log("No plugins requested — nothing to sync");
        break;
      }
      console.log(`Syncing ${doc.plugins.length} plugin(s)…`);
      const lock = withAgentsMdPreference(
        readLockfile(root) ?? emptyLockfile(),
        args.writeAgentsMd,
      );
      const results = applyAll(root, doc, lock);
      console.log("Done:");
      printResults(results);
      break;
    }
    case "list": {
      const doc = readPlugins(root);
      if (!doc || doc.plugins.length === 0) {
        console.log("(no plugins)");
        break;
      }
      const lock = readLockfile(root);
      for (const plugin of doc.plugins) {
        const record = lock?.plugins.find((item) => entryId(item) === entryId(plugin));
        const resolved = record?.resolved ? `  resolved=${record.resolved}` : "";
        console.log(`${entryId(plugin)}  ref=${plugin.ref}${resolved}`);
      }
      break;
    }
    default:
      throw new Error(`Unknown command: ${cmd}\n\n${usage()}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
