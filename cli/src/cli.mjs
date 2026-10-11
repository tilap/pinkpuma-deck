#!/usr/bin/env node
import path from "node:path";
import { doctor } from "./doctor.mjs";
import { installAll, installOne, uninstallOne } from "./install.mjs";
import { isOutdated, outdated } from "./outdated.mjs";
import { emptyLockfile, readLockfile, setWriteAgentsMd } from "./lockfile.mjs";
import { LOCAL_PLUGINS_FILE, LOCK_FILE, PLUGINS_FILE } from "./paths.mjs";
import {
  addLocalPlugin,
  addPlugin,
  deleteLocalPlugins,
  emptyLocalPlugins,
  ensurePlugins,
  parseLinkSpec,
  readLocalPlugins,
  readPlugins,
  readRequestedPlugins,
  removeLocalPlugin,
  removePlugin,
  writeLocalPlugins,
  writePlugins,
} from "./plugins.mjs";
import { scaffoldMarketplace } from "./scaffold.mjs";
import { defaultId, normalizeRequest, parseAddSpec } from "./sources/spec.mjs";

function usage() {
  return `deck (@pinkpuma/deck) — install AI plugins and skills into a project, for Claude Code and Cursor

Usage:
  deck init
  deck add <source> [--ref <ref>] [--plugin <name>] [--skill <name>]… [--path <dir>] [--id <id>] [--sha256 <hex>] [--no-sync]
  deck remove <id> [--keep-files]
  deck install [--frozen]          (alias: sync)
  deck update [<id>…]
  deck list
  deck outdated
  deck doctor
  deck link <checkout>[@<plugin>] [--id <id>] [--skill <name>]… [--path <dir>]
  deck unlink <id> [--keep-files]
  deck scaffold <name> --owner <name> [--dir <parent>]

Sources:
  owner/repo@plugin        a plugin from a GitHub marketplace
  owner/repo               a single-plugin repository, or a repository of skills
  git+<url>[#ref]          any git host (also git@host:owner/repo.git)
  npm:<package>[@version]  an npm package
  https://….zip|.tar.gz    an archive

Hosts (ai-plugin.json "hosts"): claude = native (default, via the claude CLI) | copy | off
                                cursor = copy (default) | off

Common flags: --project <dir> (-C), --force (replace files deck did not write),
              --no-agents-md / --agents-md

Files:
  ${PLUGINS_FILE}        what you ask for (commit it)
  ${LOCK_FILE}   what it resolved to: commits, versions, digests (commit it)
  ${LOCAL_PLUGINS_FILE}  links to working trees (local only)
  .deck/                 normalized plugins and local state (local only)
`;
}

function parseArgs(argv) {
  const args = {
    _: [],
    project: process.cwd(),
    dir: process.cwd(),
    sync: true,
    keepFiles: false,
    frozen: false,
    force: false,
    skills: [],
    writeAgentsMd: undefined,
  };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--project":
      case "-C":
        args.project = path.resolve(value(++i, a));
        break;
      case "--dir":
        args.dir = path.resolve(value(++i, a));
        break;
      case "--owner":
        args.owner = argv[++i] ?? "";
        break;
      case "--ref":
      case "--plugin":
      case "--path":
      case "--id":
      case "--sha256":
        args[a.slice(2)] = value(++i, a);
        break;
      case "--skill":
        args.skills.push(value(++i, a));
        break;
      case "--no-sync":
        args.sync = false;
        break;
      case "--keep-files":
        args.keepFiles = true;
        break;
      case "--frozen":
        args.frozen = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--no-agents-md":
        args.writeAgentsMd = false;
        break;
      case "--agents-md":
        args.writeAgentsMd = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        args._.push(a);
    }
  }
  return args;
}

/** `remove owner/repo@plugin` (deck <= 0.6) still works: the id is the plugin name. */
function idFromArg(arg) {
  const legacy = arg.match(/^[\w.-]+\/[\w.-]+@([^@/]+)$/);
  return legacy ? legacy[1] : arg;
}

function loadLock(root, writeAgentsMd) {
  const lock = readLockfile(root) ?? emptyLockfile();
  return writeAgentsMd === undefined ? lock : setWriteAgentsMd(lock, writeAgentsMd);
}

function describe(entry) {
  const r = entry.resolved;
  const where =
    r.type === "git" ? r.sha.slice(0, 12) : r.type === "npm" ? `${r.package}@${r.version}` : r.type === "archive" ? r.sha256.slice(0, 12) : r.sha?.slice(0, 12);
  const c = entry.components;
  const parts = [
    `skills=${c.skills.length}`,
    `agents=${c.agents.length}`,
    c.commands.length ? `commands=${c.commands.length}` : null,
    c.rules.length ? `rules=${c.rules.length}` : null,
    c.hooks ? "hooks" : null,
    c.mcp.length ? `mcp=${c.mcp.length}` : null,
  ].filter(Boolean);
  return `${entry.id}  ${parts.join(" ")}  ${r.type}:${where}`;
}

function printResult({ entry, warnings = [], linked }) {
  console.log(`  ${describe(entry)}${linked ? "  (linked)" : ""}`);
  for (const warning of warnings) console.log(`    ! ${warning}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const [cmd, ...rest] = args._;
  const root = args.project;
  const options = { force: args.force };

  switch (cmd) {
    case "init": {
      const doc = ensurePlugins(root);
      console.log(`Wrote ${PLUGINS_FILE} (${doc.plugins.length} plugins)`);
      break;
    }

    case "add": {
      const request = parseAddSpec(rest[0], args);
      const doc = addPlugin(ensurePlugins(root), request);
      writePlugins(root, doc);
      if (!args.sync) {
        console.log(`Added ${request.id} to ${PLUGINS_FILE}`);
        break;
      }
      const result = await installOne(root, doc, request, loadLock(root, args.writeAgentsMd), options);
      console.log(`Added ${request.id}:`);
      printResult(result);
      break;
    }

    case "remove": {
      if (!rest[0]) throw new Error("remove requires a plugin id");
      const id = idFromArg(rest[0]);
      const doc = readPlugins(root);
      if (!doc) throw new Error(`No ${PLUGINS_FILE} — run init or add first`);
      writePlugins(root, removePlugin(doc, id));
      uninstallOne(root, id, loadLock(root, args.writeAgentsMd), { keepFiles: args.keepFiles });
      console.log(`Removed ${id}`);
      break;
    }

    case "install":
    case "sync":
    case "apply":
    case "update": {
      const doc = readRequestedPlugins(root);
      if (!doc) throw new Error(`No ${PLUGINS_FILE} — run init, add, or link first`);
      const update = cmd === "update" ? (rest.length > 0 ? rest.map(idFromArg) : true) : undefined;
      const lock = loadLock(root, args.writeAgentsMd);
      if (doc.plugins.length === 0) {
        await installAll(root, doc, lock, { frozen: args.frozen, ...options });
        console.log("No plugins requested — nothing to install");
        break;
      }
      console.log(`${cmd === "update" ? "Updating" : "Installing"} ${doc.plugins.length} plugin(s)…`);
      const { results, removed } = await installAll(root, doc, lock, {
        frozen: args.frozen,
        update,
        ...options,
      });
      for (const id of removed) console.log(`  - ${id} (no longer requested)`);
      for (const result of results) printResult(result);
      break;
    }

    case "list": {
      const doc = readRequestedPlugins(root);
      if (!doc || doc.plugins.length === 0) {
        console.log("(no plugins)");
        break;
      }
      const lock = readLockfile(root);
      for (const request of doc.plugins) {
        const entry = lock?.plugins.find((p) => p.id === request.id);
        const what = [request.source, request.plugin && `plugin=${request.plugin}`, request.ref && `ref=${request.ref}`]
          .filter(Boolean)
          .join("  ");
        console.log(`${request.id}  ${what}${request.linked ? "  (linked)" : ""}`);
        if (entry) console.log(`  locked: ${describe(entry)}`);
        else if (!request.linked) console.log("  not locked yet — run deck install");
      }
      break;
    }

    case "outdated": {
      const rows = outdated(root);
      if (rows.length === 0) {
        console.log("(nothing locked)");
        break;
      }
      const table = [["id", "type", "current", "wanted", "latest", ""]].concat(
        rows.map((r) => [r.id, r.type, r.current, r.wanted ?? "-", r.latest ?? "-", r.note ?? ""]),
      );
      const widths = table[0].map((_, i) => Math.max(...table.map((row) => String(row[i]).length)));
      for (const row of table) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd());
      if (rows.some(isOutdated)) process.exitCode = 1;
      break;
    }

    case "doctor": {
      const findings = doctor(root);
      const mark = { error: "✖", warn: "!", ok: "✔" };
      for (const f of findings) console.log(`${mark[f.level]} ${f.id ? `${f.id}: ` : ""}${f.message}`);
      if (findings.some((f) => f.level === "error")) process.exitCode = 1;
      break;
    }

    case "link": {
      if (!rest[0]) throw new Error("link requires <checkout>[@<plugin>]");
      const { checkout, name } = parseLinkSpec(rest[0]);
      const from = path.resolve(checkout);
      const request = normalizeRequest({
        id: args.id || name || defaultId({ source: `local:${from}` }),
        source: `local:${from}`,
        ...(name ? { plugin: name } : {}),
        ...(args.skills.length ? { skills: args.skills } : {}),
        ...(args.path ? { path: args.path } : {}),
      });
      const local = addLocalPlugin(readLocalPlugins(root) ?? emptyLocalPlugins(), request);
      writeLocalPlugins(root, local);
      if (!args.sync) {
        console.log(`Linked ${request.id} from ${from} (${LOCAL_PLUGINS_FILE})`);
        break;
      }
      const doc = readRequestedPlugins(root);
      const result = await installOne(root, doc, { ...request, linked: true }, loadLock(root, args.writeAgentsMd), options);
      console.log(`Linked ${request.id} from ${from}:`);
      printResult({ ...result, linked: true });
      break;
    }

    case "unlink": {
      if (!rest[0]) throw new Error("unlink requires a plugin id");
      const id = idFromArg(rest[0]);
      const local = readLocalPlugins(root);
      if (!local) throw new Error(`No ${LOCAL_PLUGINS_FILE}`);
      const nextLocal = removeLocalPlugin(local, id);
      if (nextLocal.plugins.length === 0) deleteLocalPlugins(root);
      else writeLocalPlugins(root, nextLocal);
      const lock = loadLock(root, args.writeAgentsMd);
      const committed = readPlugins(root)?.plugins.find((p) => p.id === id);
      if (args.keepFiles) {
        console.log(`Unlinked ${id} (kept installed files)`);
        break;
      }
      if (committed) {
        const result = await installOne(root, readRequestedPlugins(root), committed, lock, options);
        console.log(`Unlinked ${id}; restored the committed request:`);
        printResult(result);
        break;
      }
      uninstallOne(root, id, lock);
      console.log(`Unlinked ${id}`);
      break;
    }

    case "scaffold": {
      const name = rest[0];
      if (!name) throw new Error("scaffold requires <name>");
      if (args.owner === undefined) throw new Error("scaffold requires --owner <name>");
      const { root: created } = scaffoldMarketplace({ name, owner: args.owner, parentDir: args.dir });
      console.log(`Created marketplace at ${created}`);
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

