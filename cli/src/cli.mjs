#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { installAll, installOne, lockOnly, materializeTo, pinFor, refreshGitignore, uninstallOne } from "./install.mjs";
import { readLockfile, removeLockEntry, upsertLockEntry, writeLockfile } from "./lockfile.mjs";
import { isOutdated, outdated } from "./outdated.mjs";
import { LOCAL_PLUGINS_FILE, LOCK_FILE, PLUGINS_FILE } from "./paths.mjs";
import {
  addLocalPlugin,
  addPlugin,
  deleteLocalPlugins,
  emptyLocalPlugins,
  emptyPlugins,
  parseLinkSpec,
  readLocalPlugins,
  readPlugins,
  removeLocalPlugin,
  removePlugin,
  writeLocalPlugins,
  writePlugins,
} from "./plugins.mjs";
import { clearProfile, createProfile, useProfile } from "./profiles.mjs";
import { PROFILES_DIR, listProfiles, loadProject, profileDir } from "./project.mjs";
import { defaultId, normalizeRequest, parseAddSpec } from "./sources/spec.mjs";
import { initProject } from "./init.mjs";
import { status } from "./status.mjs";

const USAGE = `deck — install AI plugins and skills into a project, for Claude Code and Cursor

Usage:
  deck init [--commit-copies]
  deck add <source> [--skill <name>]… [--ref <ref>] [--profile <name>]
  deck remove <id> [--profile <name>]
  deck install [--frozen]
  deck update [<id>…] [--profile <name>]
  deck status
  deck outdated
  deck link <folder>[@<plugin>] [--skill <name>]…
  deck unlink <id>
  deck profile new|use|off|list [<name>]
  deck materialize --out <dir> [--profile <name>] [--json]

Sources (add):
  owner/repo@plugin          a plugin from a GitHub marketplace
  owner/repo                 a single-plugin repository, or a repository of skills
  git+<url>[#ref]@plugin     any git host (also git@host:owner/repo.git)
  npm:<package>[@version]    an npm package
  https://….zip | .tar.gz    an archive

Options for every command:
  -C, --project <dir>   project root (default: current directory)
  --force               replace files that deck did not write
  -h, --help

Advanced options:
  add       --id <id>  --path <dir in source>  --sha256 <hex>  --no-install
  remove    --keep-files     (unlink too)
  link      --id <id>  --path <dir>  --no-install

Files:
  ai-plugin.json, ai-plugin.lock.json                    the base: what every profile gets (commit)
  .ai/profiles/<name>/prompt.md, ai-plugin.json, lock    a profile, added on top when active (commit)
  .ai/current, .ai/installed/, ai-plugin.local.json      local only

Settings in ai-plugin.json:
  "hosts": { "claude": "native" | "copy" | "off", "cursor": "copy" | "off" }
  "agentsMd": false          do not write the Skills block in AGENTS.md
  "gitignoreCopies": false   commit the copies in .claude/ and .cursor/ (deck init --commit-copies)
`;

const VALUE_FLAGS = new Set(["ref", "profile", "id", "path", "sha256", "out"]);
const BOOL_FLAGS = new Set(["frozen", "force", "keep-files", "no-install", "json", "commit-copies", "help"]);
const GLOBAL_FLAGS = ["force", "help"];

/** Flags each command takes, besides the global ones. */
const COMMANDS = {
  init: ["commit-copies"],
  add: ["ref", "skill", "profile", "id", "path", "sha256", "no-install"],
  remove: ["profile", "keep-files"],
  install: ["frozen"],
  update: ["profile"],
  status: [],
  outdated: [],
  link: ["id", "skill", "path", "no-install"],
  unlink: ["keep-files"],
  profile: [],
  materialize: ["out", "profile", "json"],
};

function parseArgs(argv) {
  const args = { _: [], flags: new Map(), skills: [], project: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-C" || a === "--project") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a directory`);
      args.project = path.resolve(v);
      continue;
    }
    if (a === "-h") {
      args.flags.set("help", true);
      continue;
    }
    if (!a.startsWith("--")) {
      if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
      args._.push(a);
      continue;
    }
    const name = a.slice(2);
    if (name === "skill") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("--skill needs a value");
      args.skills.push(v);
      args.flags.set("skill", true);
    } else if (VALUE_FLAGS.has(name)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
      args.flags.set(name, v);
    } else if (BOOL_FLAGS.has(name)) {
      args.flags.set(name, true);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return args;
}

/** Refuse an option the command does not take, instead of ignoring it. */
function checkFlags(cmd, args) {
  const allowed = new Set([...(COMMANDS[cmd] ?? []), ...GLOBAL_FLAGS]);
  for (const name of args.flags.keys()) {
    if (!allowed.has(name)) throw new Error(`deck ${cmd} does not take --${name}`);
  }
}

function describe(entry) {
  const r = entry.resolved;
  const where =
    r.type === "git" || r.type === "local"
      ? String(r.sha).slice(0, 12)
      : r.type === "npm"
        ? `${r.package}@${r.version}`
        : String(r.sha256).slice(0, 12);
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

function printResult({ entry, warnings = [], linked, skipped }) {
  console.log(`  ${describe(entry)}${linked ? "  (linked)" : ""}${skipped ? "  (up to date)" : ""}`);
  for (const warning of warnings) console.log(`    ! ${warning}`);
}

/** The folder whose ai-plugin.json a command edits: the base, or a profile. */
function targetDir(root, profile) {
  if (!profile) return root;
  const dir = profileDir(root, profile);
  if (!fs.existsSync(path.join(dir, PLUGINS_FILE))) {
    throw new Error(`No profile "${profile}". Create it with: deck profile new ${profile}`);
  }
  return dir;
}

async function install(root, options = {}) {
  const project = loadProject(root);
  if (!project.exists) throw new Error(`No ${PLUGINS_FILE}. Run deck add <source>.`);
  const label = project.profile ? ` (profile ${project.profile})` : "";
  if (project.doc.plugins.length > 0) {
    console.log(`${options.update ? "Updating" : "Installing"} ${project.doc.plugins.length} plugin(s)${label}…`);
  }
  const { results, removed } = await installAll(root, project.doc, project.lock, {
    ...options,
    saveLock: project.saveLock,
  });
  for (const id of removed) console.log(`  - ${id} (no longer requested)`);
  for (const result of results) printResult(result);
  if (project.doc.plugins.length === 0) console.log(`Nothing requested${label}.`);
}

/** Pin requests of a profile that is not active, without installing them. */
async function lockProfile(root, profile, requests, { update = false } = {}) {
  const dir = profileDir(root, profile);
  let lock = readLockfile(dir) ?? { lockfileVersion: 3, writeAgentsMd: true, plugins: [] };
  for (const request of requests) {
    const entry = await lockOnly(request, pinFor(lock, request, update));
    lock = upsertLockEntry(lock, entry);
    console.log(`  ${describe(entry)}  (locked; profile ${profile} is not active)`);
  }
  writeLockfile(dir, lock);
  refreshGitignore(root);
}

async function cmdAdd(root, args, rest) {
  const profile = args.flags.get("profile");
  const request = parseAddSpec(rest[0], {
    ref: args.flags.get("ref"),
    path: args.flags.get("path"),
    id: args.flags.get("id"),
    sha256: args.flags.get("sha256"),
    skills: args.skills,
  });
  const dir = targetDir(root, profile);
  const doc = addPlugin(readPlugins(dir) ?? emptyPlugins(), request);
  const where = profile ? `profile ${profile}` : PLUGINS_FILE;

  if (args.flags.has("no-install")) {
    writePlugins(dir, doc);
    console.log(`Added ${request.id} to ${where} (not installed)`);
    return;
  }

  const project = loadProject(root);
  const owner = project.owner.get(request.id);
  const side = profile ?? "base";
  if (owner && owner !== side) {
    throw new Error(`"${request.id}" is already requested by ${owner === "base" ? PLUGINS_FILE : `profile ${owner}`}.`);
  }

  if (profile && profile !== project.profile) {
    // Like npm install: the request is written only once it resolved.
    await lockProfile(root, profile, [request]);
    writePlugins(dir, doc);
    console.log(`Added ${request.id} to ${where}. It is installed when the profile is active: deck profile use ${profile}`);
    return;
  }

  project.owner.set(request.id, side);
  const result = await installOne(root, project.doc, request, project.lock, {
    force: args.flags.has("force"),
    saveLock: project.saveLock,
  });
  writePlugins(dir, doc);
  console.log(`Added ${request.id} to ${where}:`);
  printResult(result);
}

async function cmdRemove(root, args, rest) {
  if (!rest[0]) throw new Error("remove needs a plugin id");
  const id = rest[0];
  const profile = args.flags.get("profile");
  const dir = targetDir(root, profile);
  const doc = readPlugins(dir);
  if (!doc) throw new Error(`No ${PLUGINS_FILE}${profile ? ` in profile ${profile}` : ""}`);
  const next = removePlugin(doc, id);
  const project = loadProject(root);

  if (profile && profile !== project.profile) {
    writePlugins(dir, next);
    const lock = readLockfile(dir);
    if (lock) writeLockfile(dir, removeLockEntry(lock, id));
    refreshGitignore(root);
    console.log(`Removed ${id} from profile ${profile}`);
    return;
  }
  writePlugins(dir, next);
  uninstallOne(root, id, project.lock, { keepFiles: args.flags.has("keep-files"), saveLock: project.saveLock });
  console.log(`Removed ${id}`);
}

async function cmdUpdate(root, args, rest) {
  const ids = rest;
  const profile = args.flags.get("profile");
  const active = loadProject(root).profile;
  if (profile && profile !== active) {
    const doc = readPlugins(targetDir(root, profile)) ?? emptyPlugins();
    const requests = doc.plugins.filter((p) => ids.length === 0 || ids.includes(p.id));
    console.log(`Updating ${requests.length} plugin(s) of profile ${profile}…`);
    await lockProfile(root, profile, requests, { update: true });
    return;
  }
  await install(root, { update: ids.length > 0 ? ids : true, force: args.flags.has("force") });
}

function cmdStatus(root) {
  const { profile, rows, findings } = status(root);
  const profiles = listProfiles(root);
  if (profile) console.log(`Profile: ${profile} (${PROFILES_DIR}/${profile})`);
  else if (profiles.length > 0) console.log(`Profile: none (${profiles.join(", ")} available: deck profile use <name>)`);
  if (rows.length === 0) console.log("(no plugins)");
  for (const row of rows) {
    const what = [row.source, row.ref && `#${row.ref}`].filter(Boolean).join("");
    const over = row.overrides
      ? `, overrides ${row.overrides.source}${row.overrides.ref ? `#${row.overrides.ref}` : ""}`
      : "";
    console.log(`${row.id}  [${row.from}${over}]  ${what}`);
    if (row.entry && !row.linked) console.log(`  locked: ${describe(row.entry)}`);
  }
  const mark = { error: "✖", warn: "!", ok: "✔" };
  for (const f of findings) console.log(`${mark[f.level]} ${f.id ? `${f.id}: ` : ""}${f.message}`);
  if (findings.some((f) => f.level === "error")) process.exitCode = 1;
}

function cmdOutdated(root) {
  const rows = outdated(root);
  if (rows.length === 0) {
    console.log("(nothing locked)");
    return;
  }
  const table = [["id", "type", "current", "wanted", "latest", ""]].concat(
    rows.map((r) => [r.id, r.type, r.current, r.wanted ?? "-", r.latest ?? "-", r.note ?? ""]),
  );
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => String(row[i]).length)));
  for (const row of table) console.log(row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd());
  if (rows.some(isOutdated)) process.exitCode = 1;
}

async function cmdLink(root, args, rest) {
  if (!rest[0]) throw new Error("link needs <folder>[@<plugin>]");
  const { checkout, name } = parseLinkSpec(rest[0]);
  const from = path.resolve(checkout);
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
    throw new Error(`Cannot link ${checkout}: ${from} is not a directory`);
  }
  const request = normalizeRequest({
    id: args.flags.get("id") || name || defaultId({ source: `local:${from}` }),
    source: `local:${from}`,
    ...(name ? { plugin: name } : {}),
    ...(args.skills.length ? { skills: args.skills } : {}),
    ...(args.flags.get("path") ? { path: args.flags.get("path") } : {}),
  });
  const local = addLocalPlugin(readLocalPlugins(root) ?? emptyLocalPlugins(), request);
  if (args.flags.has("no-install")) {
    writeLocalPlugins(root, local);
    console.log(`Linked ${request.id} from ${from} (${LOCAL_PLUGINS_FILE}, not installed)`);
    return;
  }
  const project = loadProject(root);
  const result = await installOne(root, project.doc, { ...request, linked: true }, project.lock, {
    force: args.flags.has("force"),
    saveLock: project.saveLock,
  });
  writeLocalPlugins(root, local);
  console.log(`Linked ${request.id} from ${from}:`);
  printResult({ ...result, linked: true });
}

async function cmdUnlink(root, args, rest) {
  if (!rest[0]) throw new Error("unlink needs a plugin id");
  const id = rest[0];
  const local = readLocalPlugins(root);
  if (!local) throw new Error(`No ${LOCAL_PLUGINS_FILE}`);
  const nextLocal = removeLocalPlugin(local, id);
  if (nextLocal.plugins.length === 0) deleteLocalPlugins(root);
  else writeLocalPlugins(root, nextLocal);
  if (args.flags.has("keep-files")) {
    console.log(`Unlinked ${id} (kept installed files)`);
    return;
  }
  const project = loadProject(root);
  const committed = project.doc.plugins.find((p) => p.id === id && !p.linked);
  if (committed) {
    const result = await installOne(root, project.doc, committed, project.lock, {
      force: args.flags.has("force"),
      saveLock: project.saveLock,
    });
    console.log(`Unlinked ${id}; restored the committed request:`);
    printResult(result);
    return;
  }
  uninstallOne(root, id, project.lock, { saveLock: project.saveLock });
  console.log(`Unlinked ${id}`);
}

async function cmdProfile(root, args, rest) {
  const [sub = "list", name] = rest;
  switch (sub) {
    case "new": {
      if (!name) throw new Error("deck profile new needs a name");
      createProfile(root, name);
      console.log(`Created ${PROFILES_DIR}/${name}. Edit its prompt.md, add plugins with: deck add <source> --profile ${name}`);
      return;
    }
    case "use": {
      if (!name) throw new Error("deck profile use needs a name");
      targetDir(root, name);
      useProfile(root, name);
      await install(root, { force: args.flags.has("force") });
      console.log(`Profile ${name} is active. Start a new Claude session (or /reload-plugins) and reload the Cursor window.`);
      return;
    }
    case "off": {
      clearProfile(root);
      await install(root, { force: args.flags.has("force") });
      console.log("No profile is active.");
      return;
    }
    case "list": {
      const active = loadProject(root).profile;
      const names = listProfiles(root);
      if (names.length === 0) console.log(`(no profiles — create one with: deck profile new <name>)`);
      for (const n of names) {
        const count = readPlugins(profileDir(root, n))?.plugins.length ?? 0;
        console.log(`${n === active ? "*" : " "} ${n}  (${count} plugin${count === 1 ? "" : "s"})`);
      }
      return;
    }
    default:
      throw new Error(`Unknown profile command "${sub}". Use: deck profile new|use|off|list`);
  }
}

async function cmdMaterialize(root, args) {
  const out = args.flags.get("out");
  if (!out) throw new Error("deck materialize needs --out <dir>");
  const profile = args.flags.get("profile");
  if (profile) targetDir(root, profile);
  const result = await materializeTo(root, { out, profile: profile ?? null });
  if (args.flags.has("json")) {
    const plugins = result.plugins.map(({ skipped, ...plugin }) => plugin);
    console.log(JSON.stringify({ ...result, plugins }, null, 2));
    return;
  }
  console.log(`Materialized ${result.plugins.length} plugin(s)${profile ? ` (base + profile ${profile})` : " (base)"} into ${result.out}`);
  for (const p of result.plugins) console.log(`  ${p.id}${p.skipped ? "  (up to date)" : ""}`);
  if (result.prompt) console.log(`Prompt: ${result.prompt}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  if (!cmd || args.flags.has("help")) {
    console.log(USAGE);
    process.exit(cmd || args.flags.has("help") ? 0 : 1);
  }
  if (!(cmd in COMMANDS)) throw new Error(`Unknown command: ${cmd}\n\n${USAGE}`);
  checkFlags(cmd, args);
  const root = args.project;

  switch (cmd) {
    case "init": {
      const done = initProject(root, { commitCopies: args.flags.has("commit-copies") });
      if (done.length === 0) console.log("Already set up.");
      for (const line of done) console.log(`  ${line}`);
      return;
    }
    case "add":
      return cmdAdd(root, args, rest);
    case "remove":
      return cmdRemove(root, args, rest);
    case "install":
      return install(root, { frozen: args.flags.has("frozen"), force: args.flags.has("force") });
    case "update":
      return cmdUpdate(root, args, rest);
    case "status":
      return cmdStatus(root);
    case "outdated":
      return cmdOutdated(root);
    case "link":
      return cmdLink(root, args, rest);
    case "unlink":
      return cmdUnlink(root, args, rest);
    case "profile":
      return cmdProfile(root, args, rest);
    case "materialize":
      return cmdMaterialize(root, args);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
