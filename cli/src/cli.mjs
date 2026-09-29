#!/usr/bin/env node
import path from "node:path";
import {
  addEntry,
  ensureLockfile,
  entryId,
  parsePluginSpec,
  readLockfile,
  removeEntry,
  writeLockfile,
} from "./lockfile.mjs";
import {
  applyAll,
  applyEntry,
  dropVendorManifest,
  pruneStaleEntries,
  uninstallEntry,
} from "./apply.mjs";
import { LOCK_FILE } from "./paths.mjs";

function usage() {
  return `deck (@pinkpuma/deck) — sync marketplace plugins into a project

Usage:
  deck init [--project <dir>]
  deck add <owner/repo@plugin> [--ref <ref>] [--project <dir>] [--no-sync]
  deck remove <owner/repo@plugin> [--project <dir>] [--keep-files]
  deck sync [--project <dir>]
  deck list [--project <dir>]

Lockfile: ${LOCK_FILE}
Copies skills/agents into .claude/ and .cursor/, plus per-plugin support files
under .claude/plugins and .cursor/plugins. Merges MCP into .mcp.json and .cursor/mcp.json.
Existing skill directories and agent files are left in place.
`;
}

function parseArgs(argv) {
  const args = { _: [], project: process.cwd(), sync: true, keepFiles: false, ref: "main" };
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

function printResults(results) {
  for (const r of results) {
    const skipped = r.skipped?.length ? ` skipped=${r.skipped.length}` : "";
    console.log(
      `  ${r.id}: skills=${r.skills} agents=${r.agents} mcp=${r.mcp}${skipped}` +
        (r.pluginVersion ? ` (plugin v${r.pluginVersion})` : ""),
    );
    for (const rel of r.skipped || []) {
      console.warn(`  left existing ${rel}`);
    }
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
      const lock = ensureLockfile(root);
      console.log(`Wrote ${LOCK_FILE} (${lock.plugins.length} plugins)`);
      break;
    }
    case "add": {
      const spec = rest[0];
      if (!spec) throw new Error("add requires owner/repo@plugin");
      const { marketplace, name } = parsePluginSpec(spec);
      let lock = ensureLockfile(root);
      lock = addEntry(lock, { marketplace, name, ref: args.ref });
      const entry = lock.plugins.find(
        (p) => p.marketplace === marketplace && p.name === name,
      );
      if (args.sync) {
        const result = applyEntry(root, entry);
        writeLockfile(root, lock);
        console.log(`Locked ${entryId(entry)} @ ${args.ref}`);
        console.log("Applied:");
        printResults([result]);
      } else {
        writeLockfile(root, lock);
        console.log(`Locked ${entryId(entry)} @ ${args.ref}`);
      }
      break;
    }
    case "remove": {
      const spec = rest[0];
      if (!spec) throw new Error("remove requires owner/repo@plugin");
      const lock = readLockfile(root);
      if (!lock) throw new Error(`No ${LOCK_FILE} — run init first`);
      const { marketplace, name } = parsePluginSpec(spec);
      const entry = lock.plugins.find(
        (p) => p.marketplace === marketplace && p.name === name,
      );
      const next = removeEntry(lock, spec);
      writeLockfile(root, next);
      if (entry && args.keepFiles) {
        dropVendorManifest(root, entry);
      } else if (entry) {
        uninstallEntry(root, entry);
      }
      console.log(`Removed ${entryId({ marketplace, name })} from lock`);
      break;
    }
    case "sync":
    case "apply": {
      const lock = readLockfile(root);
      if (!lock) throw new Error(`No ${LOCK_FILE} — run init or add first`);
      if (lock.plugins.length === 0) {
        pruneStaleEntries(root, lock);
        console.log("Lockfile empty — nothing to sync");
        break;
      }
      console.log(`Syncing ${lock.plugins.length} plugin(s)…`);
      const results = applyAll(root, lock);
      console.log("Done:");
      printResults(results);
      break;
    }
    case "list": {
      const lock = readLockfile(root);
      if (!lock || lock.plugins.length === 0) {
        console.log("(no plugins locked)");
        break;
      }
      for (const p of lock.plugins) {
        console.log(`${entryId(p)}  ref=${p.ref}`);
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
