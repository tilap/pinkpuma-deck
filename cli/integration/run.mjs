#!/usr/bin/env node
/**
 * Reproducible use-case run: exercise @pinkpuma/deck against an empty project
 * and a local tilap/pinkpuma-toolbelt checkout, then write a JSON + Markdown log.
 *
 * The target directory must be empty (default: ./sandbox). This script never
 * deletes it. Remove it yourself before a new run.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLBELT_REPO = "tilap/pinkpuma-toolbelt";
const RESULT_FORMAT = 1;

const HOST_SKILLS = [".claude/skills", ".cursor/skills"];
const HOST_AGENTS = [".claude/agents", ".cursor/agents"];
const REQUEST_FILE = "ai-plugin.json";
const LOCAL_FILE = "ai-plugin.local.json";
const LOCK_FILE = "ai-plugin.lock.json";
const SKILLS_START = "<!-- pinkpuma-deck:skills:start -->";
const SKILLS_END = "<!-- pinkpuma-deck:skills:end -->";
const MCP_KEY = "deck__example_mcp-kit__notes__notes";

function usage() {
  return `Usage: node run.mjs --deck <cli.mjs> --toolbelt <checkout> [--target <empty-dir>]

--deck       Path to @pinkpuma/deck cli/src/cli.mjs
--toolbelt   Path to a local tilap/pinkpuma-toolbelt checkout
--target     Empty project directory (default: ${path.join(HERE, "sandbox")})

The target must be missing or empty. Results are written to ${path.join(HERE, "results")}.
`;
}

function parseArgs(argv) {
  const args = {
    help: false,
    target: path.join(HERE, "sandbox"),
    deck: "",
    toolbelt: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--target" || arg === "--deck" || arg === "--toolbelt") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a path`);
      const key = arg.slice(2);
      args[key] = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  return args;
}

function nodeSatisfiesDeck() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 14);
}

function isEmptyDir(dir) {
  if (!fs.existsSync(dir)) return true;
  if (!fs.statSync(dir).isDirectory()) return false;
  return fs.readdirSync(dir).length === 0;
}

function deckPackagePath(cliPath) {
  return path.resolve(path.dirname(cliPath), "..", "package.json");
}

function deckVersion(cliPath) {
  const pkg = JSON.parse(fs.readFileSync(deckPackagePath(cliPath), "utf8"));
  return pkg.version;
}

function toolbeltHead(dir) {
  const result = spawnSync("git", ["-C", dir, "ls-remote", "origin", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git ls-remote failed").trim();
    throw new Error(detail);
  }
  const sha = result.stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Unexpected ls-remote output: ${result.stdout.trim()}`);
  }
  return sha;
}

function localHead(dir) {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git rev-parse failed").trim();
    throw new Error(detail);
  }
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Unexpected HEAD: ${sha}`);
  }
  return sha;
}

function gitIn(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || args.join(" ")).trim());
  }
}

function writeRel(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function has(target, rel) {
  return fs.existsSync(path.join(target, rel));
}

function readText(target, rel) {
  return fs.readFileSync(path.join(target, rel), "utf8");
}

function skillRels(name) {
  return HOST_SKILLS.map((root) => `${root}/${name}/SKILL.md`);
}

function agentRels(name) {
  return HOST_AGENTS.map((root) => `${root}/${name}.md`);
}

function presence(target, rels) {
  const missing = rels.filter((rel) => !has(target, rel));
  if (missing.length === 0) {
    return { ok: true, actual: `${rels.length} fichiers présents` };
  }
  return { ok: false, actual: `manque: ${missing.join(", ")}` };
}

function absence(target, rels) {
  const present = rels.filter((rel) => has(target, rel));
  if (present.length === 0) return { ok: true, actual: "absents" };
  return { ok: false, actual: `encore là: ${present.join(", ")}` };
}

function countTree(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countTree(abs);
    else count += 1;
  }
  return count;
}

function countInstalled(target) {
  return [".claude", ".cursor"].reduce(
    (sum, rel) => sum + countTree(path.join(target, rel)),
    0,
  );
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.push(path.relative(root, abs));
    }
  }
  walk(root);
  return files.sort();
}

function markdownLinkTargets(projectRoot, fromRel, suffixes) {
  if (!has(projectRoot, fromRel)) {
    return { ok: false, actual: `${fromRel} absent`, paths: [] };
  }
  const text = readText(projectRoot, fromRel);
  const hrefs = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  const paths = [];
  const parts = [];
  let ok = true;
  for (const suffix of suffixes) {
    const href = hrefs.find(
      (value) => value.endsWith(suffix) && !/^[a-z][a-z0-9+.-]*:/i.test(value),
    );
    if (!href) {
      ok = false;
      paths.push(null);
      parts.push(`${fromRel} sans lien ${suffix}`);
      continue;
    }
    const resolved = path.normalize(
      path.join(path.dirname(path.join(projectRoot, fromRel)), href),
    );
    const exists = fs.existsSync(resolved);
    if (!exists) ok = false;
    paths.push(exists ? resolved : null);
    parts.push(
      `${href} → ${path.relative(projectRoot, resolved)} (${exists ? "présent" : "absent"})`,
    );
  }
  return { ok, actual: parts.join("; "), paths };
}

function readJson(target, rel) {
  return JSON.parse(readText(target, rel));
}

function readRequest(target) {
  return readJson(target, REQUEST_FILE);
}

function readLock(target) {
  return readJson(target, LOCK_FILE);
}

function readLocal(target) {
  if (!has(target, LOCAL_FILE)) return null;
  return readJson(target, LOCAL_FILE);
}

function findPlugin(doc, name) {
  return doc?.plugins?.find((plugin) => plugin.name === name) ?? null;
}

function pluginNames(doc) {
  return (doc?.plugins ?? []).map((plugin) => plugin.name);
}

function pluginId(name) {
  return `${TOOLBELT_REPO}@${name}`;
}

function assetRel(host, pluginName, file) {
  const safe = pluginId(pluginName).replace(/[^a-zA-Z0-9._@+-]+/g, "__");
  return `${host}/plugins/${safe}/${file}`;
}

function lastCommand(api) {
  return api.commands.at(-1);
}

function commandNamed(api, name) {
  return [...api.commands].reverse().find((item) => item.argv[1] === name);
}

function commandText(command) {
  return `${command?.stdout ?? ""}\n${command?.stderr ?? ""}`;
}

function requestUnchanged(api) {
  return readText(api.target, REQUEST_FILE) === api.requestBefore;
}

function skillsBlock(target) {
  if (!has(target, "AGENTS.md")) return "";
  return readText(target, "AGENTS.md");
}

function buildSteps() {
  const workflowSkills = ["commit", "branch-name", "pr-description", "changelog"];
  const devAgents = ["code-reviewer", "debugger", "feature-builder", "test-runner"];
  const specSkills = ["to-brief", "to-spec", "to-tickets"];

  return [
    {
      id: "init",
      action: "deck init",
      run(api) {
        api.deck(["init"]);
      },
      checks: [
        {
          id: "empty-request",
          expected: "`ai-plugin.json` existe et `plugins` est un tableau vide.",
          test(api) {
            const doc = readRequest(api.target);
            const ok = Array.isArray(doc.plugins) && doc.plugins.length === 0;
            return {
              ok,
              actual: ok ? "requête vide" : JSON.stringify(doc),
            };
          },
        },
        {
          id: "no-lock-yet",
          expected: "`ai-plugin.lock.json` n'existe pas encore (init n'écrit que la requête).",
          test(api) {
            const present = has(api.target, LOCK_FILE);
            return { ok: !present, actual: present ? "lock déjà là" : "pas de lock" };
          },
        },
        {
          id: "no-gitignore-created",
          expected: "Deck ne crée pas de `.gitignore`.",
          test(api) {
            const present = has(api.target, ".gitignore");
            return { ok: !present, actual: present ? ".gitignore créé" : "pas de .gitignore" };
          },
        },
      ],
    },
    {
      id: "init-again",
      action: "deck init",
      run(api) {
        api.deck(["init"]);
      },
      checks: [
        {
          id: "stays-empty",
          expected: "La requête reste vide (0 plugin).",
          test(api) {
            const count = readRequest(api.target).plugins.length;
            return { ok: count === 0, actual: `${count} plugin(s)` };
          },
        },
      ],
    },
    {
      id: "list-empty",
      action: "deck list",
      run(api) {
        api.deck(["list"]);
      },
      checks: [
        {
          id: "no-plugins",
          expected: "La sortie contient `(no plugins)`.",
          test(api) {
            const output = lastCommand(api)?.stdout ?? "";
            return {
              ok: output.includes("(no plugins)"),
              actual: output.trim() || "(sortie vide)",
            };
          },
        },
      ],
    },
    {
      id: "unknown-command",
      action: "deck nope",
      run(api) {
        api.requestBefore = readText(api.target, REQUEST_FILE);
        api.deck(["nope"]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `Unknown command`, requête inchangée.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const same = requestUnchanged(api);
            const ok = command?.exitCode !== 0 && text.includes("Unknown command") && same;
            return { ok, actual: `exit=${command?.exitCode} requêteInchangée=${same} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "add-invalid-spec",
      action: "deck add not-a-spec",
      run(api) {
        api.requestBefore = readText(api.target, REQUEST_FILE);
        api.deck(["add", "not-a-spec"]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `Invalid plugin spec`, requête inchangée.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const same = requestUnchanged(api);
            const ok = command?.exitCode !== 0 && text.includes("Invalid plugin spec") && same;
            return { ok, actual: `exit=${command?.exitCode} requêteInchangée=${same} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "seed-local-files",
      action:
        "Poser my-local, un agent code-reviewer USER OWNED, des serveurs MCP utilisateur, un .gitignore et un AGENTS.md",
      run(api) {
        writeRel(api.target, ".claude/skills/my-local/SKILL.md", "# local skill\n");
        writeRel(api.target, ".cursor/skills/my-local/SKILL.md", "# local skill cursor\n");
        writeRel(api.target, ".claude/agents/code-reviewer.md", "# USER OWNED code-reviewer\n");
        writeRel(api.target, ".cursor/agents/code-reviewer.md", "# USER OWNED cursor reviewer\n");
        const claudeMcp = {
          mcpServers: { "user-notes": { command: "echo", args: ["keep-me"] } },
        };
        const cursorMcp = {
          mcpServers: { "user-cursor": { command: "echo", args: ["cursor-keep"] } },
        };
        writeRel(api.target, ".mcp.json", `${JSON.stringify(claudeMcp, null, 2)}\n`);
        writeRel(api.target, ".cursor/mcp.json", `${JSON.stringify(cursorMcp, null, 2)}\n`);
        writeRel(api.target, ".gitignore", "node_modules/\n");
        writeRel(api.target, "AGENTS.md", "# Project notes\n");
        api.mcpBytes = fs.readFileSync(path.join(api.target, ".mcp.json"));
        api.cursorMcpBytes = fs.readFileSync(path.join(api.target, ".cursor/mcp.json"));
      },
      checks: [
        {
          id: "fixtures-present",
          expected:
            "my-local et les agents USER OWNED sont là, les deux fichiers MCP déclarent le serveur utilisateur, .gitignore et AGENTS.md existent.",
          test(api) {
            const filesOk = presence(api.target, [
              ...skillRels("my-local"),
              ...agentRels("code-reviewer"),
              ".mcp.json",
              ".cursor/mcp.json",
              ".gitignore",
              "AGENTS.md",
            ]);
            const agentsOk = agentRels("code-reviewer").every((rel) =>
              readText(api.target, rel).includes("USER OWNED"),
            );
            const claude = readJson(api.target, ".mcp.json");
            const cursor = readJson(api.target, ".cursor/mcp.json");
            const mcpOk = Boolean(claude.mcpServers?.["user-notes"] && cursor.mcpServers?.["user-cursor"]);
            return {
              ok: filesOk.ok && agentsOk && mcpOk,
              actual: `${filesOk.actual}; userOwned=${agentsOk}; mcp=${mcpOk}`,
            };
          },
        },
      ],
    },
    {
      id: "add-git-workflow",
      action: `deck add ${TOOLBELT_REPO}@git-workflow`,
      run(api) {
        api.deck(["add", pluginId("git-workflow")]);
      },
      checks: [
        {
          id: "skills-copied",
          expected:
            "Les skills commit, branch-name, pr-description et changelog sont copiées dans .claude/skills et .cursor/skills.",
          test(api) {
            return presence(api.target, workflowSkills.flatMap(skillRels));
          },
        },
        {
          id: "local-skill-and-mcp-kept",
          expected: "my-local est toujours là et les deux fichiers MCP utilisateur sont inchangés.",
          test(api) {
            const skillOk = presence(api.target, skillRels("my-local"));
            const claudeOk = fs.readFileSync(path.join(api.target, ".mcp.json")).equals(api.mcpBytes);
            const cursorOk = fs
              .readFileSync(path.join(api.target, ".cursor/mcp.json"))
              .equals(api.cursorMcpBytes);
            return {
              ok: skillOk.ok && claudeOk && cursorOk,
              actual: `${skillOk.actual}; .mcp.json ${claudeOk ? "inchangé" : "modifié"}; .cursor/mcp.json ${cursorOk ? "inchangé" : "modifié"}`,
            };
          },
        },
        {
          id: "conventions-resolve",
          expected:
            "Depuis chaque copie du skill commit, le lien vers CONVENTIONS.md pointe vers un fichier présent.",
          test(api) {
            const claude = markdownLinkTargets(api.target, ".claude/skills/commit/SKILL.md", [
              "CONVENTIONS.md",
            ]);
            const cursor = markdownLinkTargets(api.target, ".cursor/skills/commit/SKILL.md", [
              "CONVENTIONS.md",
            ]);
            return { ok: claude.ok && cursor.ok, actual: `${claude.actual}; ${cursor.actual}` };
          },
        },
        {
          id: "default-usage-omitted",
          expected: "DEFAULT_USAGE.md n'est pas copié dans le dossier du skill commit.",
          test(api) {
            const rels = HOST_SKILLS.map((root) => `${root}/commit/DEFAULT_USAGE.md`);
            return absence(api.target, rels);
          },
        },
        {
          id: "agents-md-block",
          expected:
            "AGENTS.md garde le titre du projet et gagne un bloc Skills marqué qui cite le skill commit.",
          test(api) {
            const text = skillsBlock(api.target);
            const ok =
              text.startsWith("# Project notes\n") &&
              text.includes(SKILLS_START) &&
              text.includes(SKILLS_END) &&
              text.includes("If the `commit` skill is available");
            return { ok, actual: ok ? "bloc présent" : text.slice(0, 400) };
          },
        },
        {
          id: "request-and-lock",
          expected:
            "La requête a git-workflow @ main. Le lock est en version 2, writeAgentsMd est true, resolved est un SHA, et les quatre snippets sont enregistrés.",
          test(api) {
            const requested = findPlugin(readRequest(api.target), "git-workflow");
            const locked = findPlugin(readLock(api.target), "git-workflow");
            const lock = readLock(api.target);
            const snippets = (locked?.agentsSnippets ?? []).map((item) => item.skill).sort();
            const ok =
              requested?.ref === "main" &&
              lock.lockfileVersion === 2 &&
              lock.writeAgentsMd === true &&
              locked?.ref === "main" &&
              /^[0-9a-f]{40}$/.test(locked?.resolved ?? "") &&
              snippets.join(",") === workflowSkills.slice().sort().join(",");
            return {
              ok,
              actual: `ref=${requested?.ref} lockVersion=${lock.lockfileVersion} writeAgentsMd=${lock.writeAgentsMd} resolved=${locked?.resolved} snippets=${snippets.join(",")}`,
            };
          },
        },
        {
          id: "gitignore-appended",
          expected:
            "Le .gitignore existant liste ai-plugin.lock.json et ai-plugin.local.json, et garde node_modules.",
          test(api) {
            const text = readText(api.target, ".gitignore");
            const ok =
              text.includes("node_modules/") &&
              text.includes(LOCK_FILE) &&
              text.includes(LOCAL_FILE);
            return { ok, actual: text.trim() };
          },
        },
      ],
    },
    {
      id: "add-dev-agents",
      action: `deck add ${TOOLBELT_REPO}@dev-agents`,
      run(api) {
        api.deck(["add", pluginId("dev-agents")]);
      },
      checks: [
        {
          id: "skills-and-agents-copied",
          expected:
            "feature-plan et les agents code-reviewer, debugger, feature-builder et test-runner sont là. Les skills de git-workflow restent.",
          test(api) {
            return presence(api.target, [
              ...skillRels("feature-plan"),
              ...devAgents.flatMap(agentRels),
              ...workflowSkills.flatMap(skillRels),
            ]);
          },
        },
        {
          id: "user-agent-replaced",
          expected:
            "L'agent code-reviewer préexistant est remplacé par celui du plugin (plus de USER OWNED) des deux côtés.",
          test(api) {
            const parts = agentRels("code-reviewer").map((rel) => {
              const text = readText(api.target, rel);
              const replaced = text.includes("senior reviewer") && !text.includes("USER OWNED");
              return `${rel} ${replaced ? "remplacé" : "pas remplacé"}`;
            });
            const ok = parts.every((part) => part.endsWith("remplacé"));
            return { ok, actual: parts.join("; ") };
          },
        },
      ],
    },
    {
      id: "list-installed",
      action: "deck list",
      run(api) {
        api.deck(["list"]);
      },
      checks: [
        {
          id: "shows-both",
          expected: "La sortie liste git-workflow et dev-agents, pas handoff, et aucun lien local.",
          test(api) {
            const output = lastCommand(api)?.stdout ?? "";
            const ok =
              output.includes(pluginId("git-workflow")) &&
              output.includes(pluginId("dev-agents")) &&
              !output.includes(pluginId("handoff")) &&
              !output.includes("local from=");
            return { ok, actual: output.trim() || "(sortie vide)" };
          },
        },
      ],
    },
    {
      id: "add-handoff-no-sync",
      action: `deck add ${TOOLBELT_REPO}@handoff --no-sync`,
      run(api) {
        api.deck(["add", pluginId("handoff"), "--no-sync"]);
      },
      checks: [
        {
          id: "requested-not-copied",
          expected:
            "La requête contient handoff @ main, le lock ne le contient pas, et le skill n'est pas copié.",
          test(api) {
            const requested = findPlugin(readRequest(api.target), "handoff");
            const locked = findPlugin(readLock(api.target), "handoff");
            const copied = has(api.target, ".claude/skills/handoff/SKILL.md");
            const ok = requested?.ref === "main" && !locked && !copied;
            return {
              ok,
              actual: `ref=${requested?.ref ?? "absent"} dansLeLock=${Boolean(locked)} skillCopié=${copied}`,
            };
          },
        },
      ],
    },
    {
      id: "sync-after-no-sync",
      action: "deck sync",
      run(api) {
        api.deck(["sync"]);
      },
      checks: [
        {
          id: "handoff-materialized",
          expected: "Les skills handoff et resume sont présentes des deux côtés, et le lock a un SHA.",
          test(api) {
            const files = presence(api.target, ["handoff", "resume"].flatMap(skillRels));
            const locked = findPlugin(readLock(api.target), "handoff");
            const resolved = /^[0-9a-f]{40}$/.test(locked?.resolved ?? "");
            return {
              ok: files.ok && resolved,
              actual: `${files.actual}; resolved=${locked?.resolved ?? "absent"}`,
            };
          },
        },
      ],
    },
    {
      id: "add-project-docs",
      action: `deck add ${TOOLBELT_REPO}@project-docs`,
      run(api) {
        api.deck(["add", pluginId("project-docs")]);
      },
      checks: [
        {
          id: "skill-copied",
          expected: "Le skill project-docs est copié des deux côtés, sans DEFAULT_USAGE.md.",
          test(api) {
            const files = presence(api.target, skillRels("project-docs"));
            const omitted = absence(
              api.target,
              HOST_SKILLS.map((root) => `${root}/project-docs/DEFAULT_USAGE.md`),
            );
            return {
              ok: files.ok && omitted.ok,
              actual: `${files.actual}; default-usage ${omitted.actual}`,
            };
          },
        },
        {
          id: "checker-script-vendored",
          expected: "Le lien vers docs_index.py dans chaque copie du skill pointe vers un fichier présent.",
          test(api) {
            const claude = markdownLinkTargets(api.target, ".claude/skills/project-docs/SKILL.md", [
              "docs_index.py",
            ]);
            const cursor = markdownLinkTargets(api.target, ".cursor/skills/project-docs/SKILL.md", [
              "docs_index.py",
            ]);
            return { ok: claude.ok && cursor.ok, actual: `${claude.actual}; ${cursor.actual}` };
          },
        },
        {
          id: "agents-snippet",
          expected: "Le bloc Skills cite le skill project-docs.",
          test(api) {
            const text = skillsBlock(api.target);
            const ok = text.includes("If the `project-docs` skill is available");
            return { ok, actual: ok ? "snippet présent" : "snippet absent" };
          },
        },
      ],
    },
    {
      id: "add-npm-publish",
      action: `deck add ${TOOLBELT_REPO}@npm-publish`,
      run(api) {
        api.deck(["add", pluginId("npm-publish")]);
      },
      checks: [
        {
          id: "skills-copied",
          expected: "Les skills npm-publish-setup et npm-publish-audit sont copiées des deux côtés.",
          test(api) {
            return presence(api.target, ["npm-publish-setup", "npm-publish-audit"].flatMap(skillRels));
          },
        },
        {
          id: "template-and-conventions-resolve",
          expected:
            "Depuis chaque copie de npm-publish-setup, les liens vers CONVENTIONS.md et publish-npm.yml pointent vers des fichiers présents, distincts de ceux de git-workflow.",
          test(api) {
            const files = [
              [".claude/skills/npm-publish-setup/SKILL.md", ["CONVENTIONS.md", "publish-npm.yml"]],
              [".cursor/skills/npm-publish-setup/SKILL.md", ["CONVENTIONS.md", "publish-npm.yml"]],
            ].map(([rel, suffixes]) => markdownLinkTargets(api.target, rel, suffixes));
            const gitConventions = markdownLinkTargets(api.target, ".claude/skills/commit/SKILL.md", [
              "CONVENTIONS.md",
            ]);
            const distinct =
              gitConventions.paths[0] &&
              files[0].paths[0] &&
              gitConventions.paths[0] !== files[0].paths[0];
            return {
              ok: files.every((item) => item.ok) && distinct,
              actual: `${files.map((item) => item.actual).join("; ")}; distinct=${Boolean(distinct)}`,
            };
          },
        },
      ],
    },
    {
      id: "add-slash-spec",
      action: `deck add ${TOOLBELT_REPO}/spec-workflow`,
      run(api) {
        api.deck(["add", `${TOOLBELT_REPO}/spec-workflow`]);
      },
      checks: [
        {
          id: "parsed-and-copied",
          expected:
            "La forme owner/repo/plugin ajoute spec-workflow @ main et copie to-brief, to-spec et to-tickets.",
          test(api) {
            const requested = findPlugin(readRequest(api.target), "spec-workflow");
            const files = presence(api.target, specSkills.flatMap(skillRels));
            const ok =
              requested?.marketplace === TOOLBELT_REPO && requested?.ref === "main" && files.ok;
            return {
              ok,
              actual: `marketplace=${requested?.marketplace} ref=${requested?.ref} ${files.actual}`,
            };
          },
        },
        {
          id: "agents-snippet",
          expected: "Le bloc Skills cite le skill to-tickets.",
          test(api) {
            const text = skillsBlock(api.target);
            const ok = text.includes("If the `to-tickets` skill is available");
            return { ok, actual: ok ? "snippet présent" : "snippet absent" };
          },
        },
      ],
    },
    {
      id: "remove-slash-spec",
      action: `deck remove ${TOOLBELT_REPO}@spec-workflow`,
      run(api) {
        api.deck(["remove", pluginId("spec-workflow")]);
      },
      checks: [
        {
          id: "removed",
          expected:
            "spec-workflow n'est plus dans la requête ni le lock, ses skills sont supprimées, le snippet to-tickets disparaît, commit reste.",
          test(api) {
            const gone = absence(api.target, specSkills.flatMap(skillRels));
            const kept = presence(api.target, skillRels("commit"));
            const names = pluginNames(readRequest(api.target));
            const locked = pluginNames(readLock(api.target));
            const text = skillsBlock(api.target);
            const ok =
              gone.ok &&
              kept.ok &&
              !names.includes("spec-workflow") &&
              !locked.includes("spec-workflow") &&
              !text.includes("If the `to-tickets` skill is available") &&
              text.includes("If the `commit` skill is available");
            return {
              ok,
              actual: `skills ${gone.actual}; requête=${names.join(", ")}; lock=${locked.join(", ")}`,
            };
          },
        },
      ],
    },
    {
      id: "readd-git-workflow-sha",
      action: `deck add ${TOOLBELT_REPO}@git-workflow --ref <HEAD du checkout>`,
      run(api) {
        api.deck(["add", pluginId("git-workflow"), "--ref", api.sha]);
      },
      checks: [
        {
          id: "single-entry-at-sha",
          expected:
            "Une seule entrée git-workflow, son ref est le HEAD local, et le skill commit est toujours là.",
          test(api) {
            const requested = readRequest(api.target).plugins.filter(
              (plugin) => plugin.name === "git-workflow",
            );
            const locked = findPlugin(readLock(api.target), "git-workflow");
            const skillOk = has(api.target, ".claude/skills/commit/SKILL.md");
            const ok =
              requested.length === 1 &&
              requested[0].ref === api.sha &&
              locked?.ref === api.sha &&
              skillOk;
            return {
              ok,
              actual: `entrées=${requested.length} ref=${requested[0]?.ref ?? "absent"} lockRef=${locked?.ref} skill=${skillOk}`,
            };
          },
        },
      ],
    },
    {
      id: "sync-idempotent",
      action: "deck sync",
      run(api) {
        api.fileCountBefore = countInstalled(api.target);
        api.deck(["sync"]);
      },
      checks: [
        {
          id: "same-file-count",
          expected:
            "Le sync quitte avec le code 0 et ne change pas le nombre de fichiers sous .claude et .cursor.",
          test(api) {
            const command = lastCommand(api);
            const after = countInstalled(api.target);
            const ok = command?.exitCode === 0 && after === api.fileCountBefore;
            return {
              ok,
              actual: `exit=${command?.exitCode} fichiers ${api.fileCountBefore} → ${after}`,
            };
          },
        },
      ],
    },
    {
      id: "sync-no-agents-md",
      action: "deck sync --no-agents-md",
      run(api) {
        api.deck(["sync", "--no-agents-md"]);
      },
      checks: [
        {
          id: "block-removed",
          expected:
            "writeAgentsMd passe à false, les marqueurs du bloc Skills disparaissent, le titre du projet reste.",
          test(api) {
            const command = lastCommand(api);
            const text = skillsBlock(api.target);
            const flag = readLock(api.target).writeAgentsMd;
            const ok =
              command?.exitCode === 0 &&
              flag === false &&
              !text.includes(SKILLS_START) &&
              !text.includes(SKILLS_END) &&
              text.includes("# Project notes");
            return { ok, actual: `exit=${command?.exitCode} writeAgentsMd=${flag} agents=${JSON.stringify(text)}` };
          },
        },
      ],
    },
    {
      id: "sync-agents-md",
      action: "deck sync --agents-md",
      run(api) {
        api.deck(["sync", "--agents-md"]);
      },
      checks: [
        {
          id: "block-restored",
          expected:
            "writeAgentsMd repasse à true et le bloc Skills revient, avec le titre du projet et le snippet commit.",
          test(api) {
            const text = skillsBlock(api.target);
            const flag = readLock(api.target).writeAgentsMd;
            const ok =
              flag === true &&
              text.includes(SKILLS_START) &&
              text.includes("# Project notes") &&
              text.includes("If the `commit` skill is available");
            return { ok, actual: `writeAgentsMd=${flag} commit=${text.includes("commit")}` };
          },
        },
      ],
    },
    {
      id: "remove-dev-agents",
      action: `deck remove ${TOOLBELT_REPO}@dev-agents`,
      run(api) {
        api.deck(["remove", pluginId("dev-agents")]);
      },
      checks: [
        {
          id: "plugin-files-removed",
          expected:
            "feature-plan et les quatre agents sont supprimés, y compris code-reviewer qui avait été remplacé. my-local et commit restent. dev-agents n'est plus dans la requête.",
          test(api) {
            const gone = absence(api.target, [
              ...skillRels("feature-plan"),
              ...devAgents.flatMap(agentRels),
            ]);
            const kept = presence(api.target, ["commit", "my-local"].flatMap(skillRels));
            const requested = pluginNames(readRequest(api.target));
            const ok = gone.ok && kept.ok && !requested.includes("dev-agents");
            return {
              ok,
              actual: `suppression: ${gone.actual}; conservés: ${kept.actual}; requête=${requested.join(", ")}`,
            };
          },
        },
      ],
    },
    {
      id: "remove-handoff-keep-files",
      action: `deck remove ${TOOLBELT_REPO}@handoff --keep-files`,
      run(api) {
        api.deck(["remove", pluginId("handoff"), "--keep-files"]);
      },
      checks: [
        {
          id: "dropped-from-request-and-lock",
          expected: "handoff n'est plus dans la requête ni dans le lock.",
          test(api) {
            const requested = pluginNames(readRequest(api.target));
            const locked = pluginNames(readLock(api.target));
            const ok = !requested.includes("handoff") && !locked.includes("handoff");
            return { ok, actual: `requête=${requested.join(", ")}; lock=${locked.join(", ")}` };
          },
        },
        {
          id: "copies-remain",
          expected:
            "Les skills handoff et resume, et les README vendus des deux côtés, restent sur le disque.",
          test(api) {
            return presence(api.target, [
              ...["handoff", "resume"].flatMap(skillRels),
              assetRel(".claude", "handoff", "README.md"),
              assetRel(".cursor", "handoff", "README.md"),
            ]);
          },
        },
      ],
    },
    {
      id: "sync-prunes-edited-request",
      action: "Retirer project-docs de ai-plugin.json à la main, puis deck sync",
      run(api) {
        const requestPath = path.join(api.target, REQUEST_FILE);
        const doc = readRequest(api.target);
        doc.plugins = doc.plugins.filter((plugin) => plugin.name !== "project-docs");
        fs.writeFileSync(requestPath, `${JSON.stringify(doc, null, 2)}\n`);
        api.record({
          argv: ["edit", REQUEST_FILE, "drop", "project-docs"],
          exitCode: 0,
          stdout: "",
          stderr: "",
        });
        api.deck(["sync"]);
      },
      checks: [
        {
          id: "project-docs-removed",
          expected:
            "deck sync quitte avec le code 0, project-docs disparaît, git-workflow et npm-publish restent. Les copies de handoff (retirées avec --keep-files) restent, parce qu'elles ne sont plus dans le lock.",
          test(api) {
            const command = commandNamed(api, "sync");
            const gone = absence(api.target, [
              ...skillRels("project-docs"),
              assetRel(".claude", "project-docs", "scripts/docs_index.py"),
            ]);
            const kept = presence(api.target, [
              ...["commit", "npm-publish-setup", "handoff"].flatMap(skillRels),
            ]);
            const ok = command?.exitCode === 0 && gone.ok && kept.ok;
            return {
              ok,
              actual: `exit=${command?.exitCode}; suppression: ${gone.actual}; conservés: ${kept.actual}`,
            };
          },
        },
      ],
    },
    {
      id: "remove-unknown",
      action: `deck remove ${TOOLBELT_REPO}@does-not-exist`,
      run(api) {
        api.requestBefore = readText(api.target, REQUEST_FILE);
        api.deck(["remove", pluginId("does-not-exist")]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `No plugin entry`, requête inchangée.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const same = requestUnchanged(api);
            const ok = command?.exitCode !== 0 && text.includes("No plugin entry") && same;
            return { ok, actual: `exit=${command?.exitCode} requêteInchangée=${same} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "link-nextjs",
      action: "deck link <toolbelt>@nextjs-app-structure",
      run(api) {
        api.requestBefore = readText(api.target, REQUEST_FILE);
        api.deck(["link", `${api.toolbelt}@nextjs-app-structure`]);
        api.deck(["list"]);
      },
      checks: [
        {
          id: "installed-without-touching-request",
          expected:
            "Le skill est installé, DEFAULT_USAGE.md n'est pas copié, ai-plugin.json ne liste pas nextjs-app-structure, et le fichier local pointe vers le checkout.",
          test(api) {
            const files = presence(api.target, skillRels("nextjs-app-structure"));
            const omitted = absence(
              api.target,
              HOST_SKILLS.map((root) => `${root}/nextjs-app-structure/DEFAULT_USAGE.md`),
            );
            const requested = pluginNames(readRequest(api.target));
            const linked = findPlugin(readLocal(api.target), "nextjs-app-structure");
            const same = requestUnchanged(api);
            const ok =
              files.ok &&
              omitted.ok &&
              same &&
              !requested.includes("nextjs-app-structure") &&
              linked?.from === api.toolbelt &&
              linked?.marketplace === TOOLBELT_REPO;
            return {
              ok,
              actual: `${files.actual}; requêteInchangée=${same}; from=${linked?.from ?? "absent"}`,
            };
          },
        },
        {
          id: "list-shows-local",
          expected: "deck list affiche `local from=` avec le chemin du checkout.",
          test(api) {
            const output = commandNamed(api, "list")?.stdout ?? "";
            const ok = output.includes(`local from=${api.toolbelt}`);
            return { ok, actual: output.trim() || "(sortie vide)" };
          },
        },
        {
          id: "agents-snippet",
          expected: "Le bloc Skills cite nextjs-app-structure.",
          test(api) {
            const text = skillsBlock(api.target);
            const ok = text.includes("If the `nextjs-app-structure` skill is available");
            return { ok, actual: ok ? "snippet présent" : "snippet absent" };
          },
        },
      ],
    },
    {
      id: "link-override-git-workflow",
      action: "deck link <toolbelt>@git-workflow",
      run(api) {
        api.deck(["link", `${api.toolbelt}@git-workflow`]);
        api.deck(["list"]);
      },
      checks: [
        {
          id: "overrides-committed-ref",
          expected:
            "La requête garde le SHA. Le lien local et le lock pointent vers le checkout, et list affiche `overrides ref=<sha>`.",
          test(api) {
            const requested = findPlugin(readRequest(api.target), "git-workflow");
            const linked = findPlugin(readLocal(api.target), "git-workflow");
            const locked = findPlugin(readLock(api.target), "git-workflow");
            const output = commandNamed(api, "list")?.stdout ?? "";
            const ok =
              requested?.ref === api.sha &&
              linked?.from === api.toolbelt &&
              locked?.source === api.toolbelt &&
              locked?.resolved === api.sha &&
              output.includes(`overrides ref=${api.sha}`);
            return {
              ok,
              actual: `requestRef=${requested?.ref} source=${locked?.source} resolved=${locked?.resolved} listHasOverride=${output.includes("overrides ref=")}`,
            };
          },
        },
      ],
    },
    {
      id: "unlink-restores-committed",
      action: `deck unlink ${TOOLBELT_REPO}@git-workflow`,
      run(api) {
        api.deck(["unlink", pluginId("git-workflow")]);
      },
      checks: [
        {
          id: "restored-sha",
          expected:
            "Le lien git-workflow disparaît, nextjs reste lié, la requête garde le SHA, le lock n'a plus de source, et le skill commit reste.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const localNames = pluginNames(readLocal(api.target));
            const requested = findPlugin(readRequest(api.target), "git-workflow");
            const locked = findPlugin(readLock(api.target), "git-workflow");
            const skillOk = has(api.target, ".claude/skills/commit/SKILL.md");
            const ok =
              command?.exitCode === 0 &&
              text.includes(`restored ref=${api.sha}`) &&
              !localNames.includes("git-workflow") &&
              localNames.includes("nextjs-app-structure") &&
              requested?.ref === api.sha &&
              locked?.source == null &&
              locked?.ref === api.sha &&
              skillOk;
            return {
              ok,
              actual: `exit=${command?.exitCode} local=${localNames.join(", ")} lockRef=${locked?.ref} source=${locked?.source ?? "absente"} ${text.trim()}`,
            };
          },
        },
      ],
    },
    {
      id: "link-spec-no-sync",
      action: "deck link <toolbelt>@spec-workflow --no-sync",
      run(api) {
        api.deck(["link", `${api.toolbelt}@spec-workflow`, "--no-sync"]);
      },
      checks: [
        {
          id: "recorded-not-copied",
          expected:
            "spec-workflow est dans le fichier local, pas dans la requête, et to-spec n'est pas copié. Le snippet to-tickets n'est pas encore réécrit.",
          test(api) {
            const linked = findPlugin(readLocal(api.target), "spec-workflow");
            const requested = pluginNames(readRequest(api.target));
            const copied = has(api.target, ".claude/skills/to-spec/SKILL.md");
            const text = skillsBlock(api.target);
            const ok =
              linked?.from === api.toolbelt &&
              !requested.includes("spec-workflow") &&
              !copied &&
              !text.includes("If the `to-tickets` skill is available");
            return {
              ok,
              actual: `from=${linked?.from ?? "absent"} skillCopié=${copied} snippet=${text.includes("to-tickets")}`,
            };
          },
        },
      ],
    },
    {
      id: "sync-linked-spec",
      action: "deck sync",
      run(api) {
        api.deck(["sync"]);
      },
      checks: [
        {
          id: "materialized",
          expected:
            "to-brief, to-spec et to-tickets sont copiés, nextjs reste, le lock enregistre la source, et le snippet to-tickets revient.",
          test(api) {
            const files = presence(api.target, specSkills.flatMap(skillRels));
            const next = presence(api.target, skillRels("nextjs-app-structure"));
            const locked = findPlugin(readLock(api.target), "spec-workflow");
            const text = skillsBlock(api.target);
            const ok =
              files.ok &&
              next.ok &&
              locked?.source === api.toolbelt &&
              text.includes("If the `to-tickets` skill is available");
            return {
              ok,
              actual: `${files.actual}; source=${locked?.source ?? "absente"}`,
            };
          },
        },
      ],
    },
    {
      id: "unlink-spec-keep-files",
      action: `deck unlink ${TOOLBELT_REPO}@spec-workflow --keep-files`,
      run(api) {
        api.deck(["unlink", pluginId("spec-workflow"), "--keep-files"]);
      },
      checks: [
        {
          id: "link-dropped-files-kept",
          expected:
            "Le lien spec-workflow est retiré, nextjs reste lié, les skills restent, et l'entrée du lock reste (keep-files ne la retire pas).",
          test(api) {
            const command = lastCommand(api);
            const localNames = pluginNames(readLocal(api.target));
            const locked = findPlugin(readLock(api.target), "spec-workflow");
            const files = presence(api.target, specSkills.flatMap(skillRels));
            const ok =
              command?.exitCode === 0 &&
              commandText(command).includes("kept installed files") &&
              !localNames.includes("spec-workflow") &&
              localNames.includes("nextjs-app-structure") &&
              Boolean(locked) &&
              files.ok;
            return {
              ok,
              actual: `exit=${command?.exitCode} local=${localNames.join(", ")} lock=${Boolean(locked)} ${files.actual}`,
            };
          },
        },
      ],
    },
    {
      id: "sync-prunes-unlinked-spec",
      action: "deck sync",
      run(api) {
        api.deck(["sync"]);
      },
      checks: [
        {
          id: "spec-pruned",
          expected:
            "spec-workflow est retiré du disque et du lock. nextjs, commit et les orphelins handoff restent. Le snippet to-tickets disparaît.",
          test(api) {
            const gone = absence(api.target, specSkills.flatMap(skillRels));
            const kept = presence(api.target, [
              ...["commit", "handoff", "nextjs-app-structure"].flatMap(skillRels),
            ]);
            const locked = pluginNames(readLock(api.target));
            const text = skillsBlock(api.target);
            const ok =
              gone.ok &&
              kept.ok &&
              !locked.includes("spec-workflow") &&
              !text.includes("If the `to-tickets` skill is available") &&
              text.includes("If the `commit` skill is available");
            return {
              ok,
              actual: `suppression: ${gone.actual}; conservés: ${kept.actual}; lock=${locked.join(", ")}`,
            };
          },
        },
      ],
    },
    {
      id: "unlink-nextjs",
      action: `deck unlink ${TOOLBELT_REPO}@nextjs-app-structure`,
      run(api) {
        api.deck(["unlink", pluginId("nextjs-app-structure")]);
      },
      checks: [
        {
          id: "link-only-removed",
          expected:
            "Le skill nextjs est supprimé, ai-plugin.local.json disparaît, le snippet nextjs aussi, et le snippet commit reste.",
          test(api) {
            const command = lastCommand(api);
            const gone = absence(api.target, skillRels("nextjs-app-structure"));
            const localGone = !has(api.target, LOCAL_FILE);
            const text = skillsBlock(api.target);
            const ok =
              command?.exitCode === 0 &&
              gone.ok &&
              localGone &&
              !text.includes("If the `nextjs-app-structure` skill is available") &&
              text.includes("If the `commit` skill is available");
            return {
              ok,
              actual: `exit=${command?.exitCode} ${gone.actual}; local=${localGone ? "absent" : "présent"}`,
            };
          },
        },
      ],
    },
    {
      id: "link-mcp",
      action: "Créer un checkout GitHub local avec un serveur MCP, puis deck link <checkout>@notes",
      run(api) {
        const fixture = path.join(api.target, "fixtures", "mcp-kit");
        fs.mkdirSync(fixture, { recursive: true });
        gitIn(fixture, ["init", "-b", "main"]);
        gitIn(fixture, ["remote", "add", "origin", "https://github.com/example/mcp-kit.git"]);
        writeRel(
          fixture,
          ".claude-plugin/marketplace.json",
          `${JSON.stringify(
            {
              name: "mcp-kit",
              owner: { name: "Integration" },
              plugins: [{ name: "notes", source: "./plugins/notes" }],
            },
            null,
            2,
          )}\n`,
        );
        writeRel(
          fixture,
          "plugins/notes/.claude-plugin/plugin.json",
          `${JSON.stringify({ name: "notes", version: "0.0.1" })}\n`,
        );
        writeRel(
          fixture,
          "plugins/notes/mcp.json",
          `${JSON.stringify({ mcpServers: { notes: { command: "echo", args: ["notes"] } } }, null, 2)}\n`,
        );
        writeRel(fixture, "plugins/notes/skills/notes/SKILL.md", "# notes v1\n");
        gitIn(fixture, ["add", "."]);
        gitIn(fixture, [
          "-c",
          "user.email=deck@example.com",
          "-c",
          "user.name=deck",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-m",
          "init",
        ]);
        api.fixture = fixture;
        api.deck(["link", `${fixture}@notes`]);
      },
      checks: [
        {
          id: "namespaced-mcp",
          expected:
            "Le skill notes v1 est installé. Les deux fichiers MCP gardent le serveur utilisateur et gagnent la clé deck__example_mcp-kit__notes__notes. La requête ne contient pas notes.",
          test(api) {
            const skill = readText(api.target, ".claude/skills/notes/SKILL.md");
            const cursorSkill = readText(api.target, ".cursor/skills/notes/SKILL.md");
            const claude = readJson(api.target, ".mcp.json");
            const cursor = readJson(api.target, ".cursor/mcp.json");
            const requested = pluginNames(readRequest(api.target));
            const linked = findPlugin(readLocal(api.target), "notes");
            const ok =
              skill === "# notes v1\n" &&
              cursorSkill === "# notes v1\n" &&
              !requested.includes("notes") &&
              linked?.marketplace === "example/mcp-kit" &&
              linked?.from === api.fixture &&
              claude.mcpServers?.["user-notes"]?.args?.[0] === "keep-me" &&
              cursor.mcpServers?.["user-cursor"]?.args?.[0] === "cursor-keep" &&
              claude.mcpServers?.[MCP_KEY]?.args?.[0] === "notes" &&
              cursor.mcpServers?.[MCP_KEY]?.args?.[0] === "notes";
            return {
              ok,
              actual: `skill=${JSON.stringify(skill)} claudeKeys=${Object.keys(claude.mcpServers ?? {}).join(",")} cursorKeys=${Object.keys(cursor.mcpServers ?? {}).join(",")}`,
            };
          },
        },
      ],
    },
    {
      id: "sync-dirty-mcp",
      action: "Modifier le skill dans le checkout sans commit, puis deck sync",
      run(api) {
        writeRel(api.fixture, "plugins/notes/skills/notes/SKILL.md", "# notes v2 dirty\n");
        api.deck(["sync"]);
      },
      checks: [
        {
          id: "dirty-tree-installed",
          expected:
            "Les deux copies du skill notes contiennent la version non commitée. notes n'est toujours pas dans la requête.",
          test(api) {
            const claude = readText(api.target, ".claude/skills/notes/SKILL.md");
            const cursor = readText(api.target, ".cursor/skills/notes/SKILL.md");
            const requested = pluginNames(readRequest(api.target));
            const ok =
              claude === "# notes v2 dirty\n" &&
              cursor === "# notes v2 dirty\n" &&
              !requested.includes("notes");
            return { ok, actual: `claude=${JSON.stringify(claude)} dansLaRequête=${requested.includes("notes")}` };
          },
        },
      ],
    },
    {
      id: "unlink-mcp",
      action: "deck unlink example/mcp-kit@notes",
      run(api) {
        api.deck(["unlink", "example/mcp-kit@notes"]);
      },
      checks: [
        {
          id: "mcp-keys-removed",
          expected:
            "Le skill notes et la clé namespacée disparaissent. user-notes et user-cursor restent. Le fichier local est supprimé.",
          test(api) {
            const gone = absence(api.target, skillRels("notes"));
            const claude = readJson(api.target, ".mcp.json");
            const cursor = readJson(api.target, ".cursor/mcp.json");
            const localGone = !has(api.target, LOCAL_FILE);
            const ok =
              gone.ok &&
              localGone &&
              claude.mcpServers?.["user-notes"]?.args?.[0] === "keep-me" &&
              cursor.mcpServers?.["user-cursor"]?.args?.[0] === "cursor-keep" &&
              !claude.mcpServers?.[MCP_KEY] &&
              !cursor.mcpServers?.[MCP_KEY];
            return {
              ok,
              actual: `${gone.actual}; local=${localGone ? "absent" : "présent"}; claudeKeys=${Object.keys(claude.mcpServers ?? {}).join(",")}`,
            };
          },
        },
      ],
    },
    {
      id: "link-invalid",
      action: "deck link nosep",
      run(api) {
        api.deck(["link", "nosep"]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `Invalid link`, pas de fichier local.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const localGone = !has(api.target, LOCAL_FILE);
            const ok = command?.exitCode !== 0 && text.includes("Invalid link") && localGone;
            return { ok, actual: `exit=${command?.exitCode} local=${localGone ? "absent" : "présent"} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "link-no-origin",
      action: "deck link <checkout sans origin>@demo",
      run(api) {
        const dir = path.join(api.target, "fixtures", "no-origin");
        fs.mkdirSync(dir, { recursive: true });
        gitIn(dir, ["init", "-b", "main"]);
        api.deck(["link", `${dir}@demo`]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `origin`, pas de fichier local.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const localGone = !has(api.target, LOCAL_FILE);
            const ok = command?.exitCode !== 0 && text.includes("origin") && localGone;
            return { ok, actual: `exit=${command?.exitCode} local=${localGone ? "absent" : "présent"} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "unlink-unknown",
      action: `deck unlink ${TOOLBELT_REPO}@does-not-exist`,
      run(api) {
        api.deck(["unlink", pluginId("does-not-exist")]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `No ai-plugin.local.json`.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const ok = command?.exitCode !== 0 && text.includes(`No ${LOCAL_FILE}`);
            return { ok, actual: `exit=${command?.exitCode} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "scaffold",
      action: 'deck scaffold sample-market --owner "Integration Tests" --dir <cible>/authored',
      run(api) {
        api.authored = path.join(api.target, "authored");
        api.deck([
          "scaffold",
          "sample-market",
          "--owner",
          "Integration Tests",
          "--dir",
          api.authored,
        ]);
      },
      checks: [
        {
          id: "marketplace-tree",
          expected:
            "Le dépôt créé a marketplace.json (nom, owner, plugins vides), plugins/.gitkeep, README, HOWTO, AGENTS.md et .gitignore, sans variable de template.",
          test(api) {
            const root = path.join(api.authored, "sample-market");
            const market = readJson(root, ".claude-plugin/marketplace.json");
            const agents = readText(root, "AGENTS.md");
            const files = presence(root, [
              "plugins/.gitkeep",
              "README.md",
              "HOWTO.md",
              "AGENTS.md",
              ".gitignore",
            ]);
            const ignore = readText(root, ".gitignore");
            const ok =
              files.ok &&
              market.name === "sample-market" &&
              market.owner?.name === "Integration Tests" &&
              Array.isArray(market.plugins) &&
              market.plugins.length === 0 &&
              !agents.includes("{{NAME}}") &&
              !agents.includes("{{OWNER}}") &&
              agents.includes("Integration Tests") &&
              agents.includes("sample-market") &&
              ignore.includes("node_modules/");
            return {
              ok,
              actual: `${files.actual}; name=${market.name} owner=${market.owner?.name} plugins=${market.plugins?.length}`,
            };
          },
        },
      ],
    },
    {
      id: "scaffold-invalid-name",
      action: "deck scaffold Bad_Name --owner Integration Tests",
      run(api) {
        api.deck(["scaffold", "Bad_Name", "--owner", "Integration Tests", "--dir", api.authored]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `Invalid marketplace name`, aucun répertoire Bad_Name.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const created = has(api.authored, "Bad_Name");
            const ok = command?.exitCode !== 0 && text.includes("Invalid marketplace name") && !created;
            return { ok, actual: `exit=${command?.exitCode} créé=${created} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "scaffold-missing-owner",
      action: "deck scaffold another-market",
      run(api) {
        api.deck(["scaffold", "another-market", "--dir", api.authored]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `--owner`, aucun répertoire another-market.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const created = has(api.authored, "another-market");
            const ok = command?.exitCode !== 0 && text.includes("--owner") && !created;
            return { ok, actual: `exit=${command?.exitCode} créé=${created} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "scaffold-non-empty",
      action: "deck scaffold sample-market une seconde fois",
      run(api) {
        api.deck([
          "scaffold",
          "sample-market",
          "--owner",
          "Integration Tests",
          "--dir",
          api.authored,
        ]);
      },
      checks: [
        {
          id: "rejected",
          expected: "Code non nul, message `not empty`, le marketplace déjà créé est intact.",
          test(api) {
            const command = lastCommand(api);
            const text = commandText(command);
            const market = readJson(
              path.join(api.authored, "sample-market"),
              ".claude-plugin/marketplace.json",
            );
            const ok =
              command?.exitCode !== 0 &&
              text.includes("not empty") &&
              market.name === "sample-market";
            return { ok, actual: `exit=${command?.exitCode} name=${market.name} ${text.trim()}` };
          },
        },
      ],
    },
    {
      id: "add-unknown-plugin",
      action: `deck add ${TOOLBELT_REPO}@no-such-plugin`,
      run(api) {
        api.deck(["add", pluginId("no-such-plugin")]);
      },
      checks: [
        {
          id: "request-written-lock-not",
          expected:
            "Code non nul. La requête contient déjà no-such-plugin (écrite avant la copie) et le lock ne le contient pas.",
          test(api) {
            const command = lastCommand(api);
            const requested = pluginNames(readRequest(api.target));
            const locked = pluginNames(readLock(api.target));
            const ok =
              command?.exitCode !== 0 &&
              requested.includes("no-such-plugin") &&
              !locked.includes("no-such-plugin");
            return {
              ok,
              actual: `exit=${command?.exitCode} requête=${requested.join(", ")} lock=${locked.join(", ")} ${(command?.stderr || "").trim()}`,
            };
          },
        },
      ],
    },
  ];
}

function createApi(target, sha, options) {
  const commands = [];
  const localKey = `DECK_LOCAL_${TOOLBELT_REPO.replaceAll("/", "__")}`;
  const api = {
    target,
    sha,
    toolbelt: options.toolbelt,
    commands,
    deck(args) {
      const result = spawnSync(process.execPath, [options.deck, ...args, "--project", target], {
        encoding: "utf8",
        env: {
          ...process.env,
          [localKey]: options.toolbelt,
        },
      });
      const record = {
        argv: ["deck", ...args, "--project", target],
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
      commands.push(record);
      return record;
    },
    record(entry) {
      commands.push(entry);
    },
  };
  return api;
}

function runStep(step, api) {
  const started = Date.now();
  try {
    step.run(api);
  } catch (error) {
    api.record({
      argv: ["step-threw", step.id],
      exitCode: 1,
      stdout: "",
      stderr: error.stack || error.message,
    });
  }
  const checks = step.checks.map((check) => {
    try {
      const result = check.test(api);
      return {
        id: check.id,
        expected: check.expected,
        ok: Boolean(result.ok),
        actual: result.actual,
      };
    } catch (error) {
      return {
        id: check.id,
        expected: check.expected,
        ok: false,
        actual: error.message,
      };
    }
  });
  return {
    id: step.id,
    action: step.action,
    status: checks.every((check) => check.ok) ? "pass" : "fail",
    durationMs: Date.now() - started,
    commands: api.commands.splice(0, api.commands.length),
    checks,
  };
}

function skipStep(step, reason) {
  return {
    id: step.id,
    action: step.action,
    status: "skipped",
    durationMs: 0,
    commands: [],
    checks: step.checks.map((check) => ({
      id: check.id,
      expected: check.expected,
      ok: false,
      actual: reason,
    })),
  };
}

function summarize(steps) {
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const failed = [];
  for (const step of steps) {
    if (step.status === "skipped") {
      skipped += step.checks.length;
      continue;
    }
    for (const check of step.checks) {
      if (check.ok) pass += 1;
      else {
        fail += 1;
        failed.push(`${step.id}.${check.id}`);
      }
    }
  }
  return { pass, fail, skipped, failed };
}

function renderMarkdown(report) {
  const lines = [
    `# Run ${report.runId}`,
    "",
    `- Début : ${report.startedAt}`,
    `- Fin : ${report.finishedAt}`,
    `- Cible : \`${report.target}\``,
    `- Deck : ${report.deck.version} (\`${report.deck.cli}\`)`,
    `- Toolbelt : ${report.toolbelt.repo} checkout \`${report.toolbelt.localSha || "indisponible"}\`, origin/HEAD \`${report.toolbelt.sha || "indisponible"}\``,
    `- Node : ${report.node}`,
    `- Résultat : ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skipped} skipped`,
    "",
    "## Prérequis",
    "",
  ];
  for (const item of report.prerequisites) {
    lines.push(`- ${item.ok ? "PASS" : "FAIL"} \`${item.id}\` — ${item.actual}`);
  }
  lines.push("", "## Scénario", "");
  for (const step of report.steps) {
    lines.push(`### ${step.status.toUpperCase()} \`${step.id}\``, "", step.action, "");
    for (const command of step.commands) {
      lines.push("```");
      lines.push(command.argv.join(" "));
      lines.push(`exit ${command.exitCode}`);
      if (command.stdout.trim()) lines.push(command.stdout.trimEnd());
      if (command.stderr.trim()) lines.push(command.stderr.trimEnd());
      lines.push("```", "");
    }
    for (const check of step.checks) {
      const mark = step.status === "skipped" ? "SKIP" : check.ok ? "PASS" : "FAIL";
      lines.push(`- ${mark} \`${check.id}\``);
      lines.push(`  - attendu : ${check.expected}`);
      lines.push(`  - obtenu : ${check.actual}`);
    }
    lines.push("");
  }
  lines.push(
    "## État final",
    "",
    "### ai-plugin.json",
    "",
    "```json",
    JSON.stringify(report.endState.request, null, 2),
    "```",
    "",
    "### ai-plugin.local.json",
    "",
    "```json",
    JSON.stringify(report.endState.local, null, 2),
    "```",
    "",
    "### ai-plugin.lock.json",
    "",
    "```json",
    JSON.stringify(report.endState.lock, null, 2),
    "```",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function writeReport(report) {
  const resultsDir = path.join(HERE, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const base = path.join(resultsDir, report.runId);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  fs.writeFileSync(`${base}.json`, json);
  fs.writeFileSync(`${base}.md`, markdown);
  fs.writeFileSync(path.join(resultsDir, "latest.json"), json);
  fs.writeFileSync(path.join(resultsDir, "latest.md"), markdown);
  return { jsonPath: `${base}.json`, mdPath: `${base}.md` };
}

function readIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function endState(target) {
  return {
    request: readIfExists(path.join(target, REQUEST_FILE)),
    local: readIfExists(path.join(target, LOCAL_FILE)),
    lock: readIfExists(path.join(target, LOCK_FILE)),
    files: fs.existsSync(target) ? listFiles(target) : [],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const startedAt = new Date();
  const target = args.target;
  const prerequisites = [];

  const nodeOk = nodeSatisfiesDeck();
  prerequisites.push({
    id: "node",
    ok: nodeOk,
    expected: "Node.js >= 22.14",
    actual: process.version,
  });

  const deckCli = args.deck;
  const cliOk = Boolean(deckCli) && fs.existsSync(deckCli);
  prerequisites.push({
    id: "deck-cli",
    ok: cliOk,
    expected: "--deck pointe vers un fichier cli/src/cli.mjs existant.",
    actual: cliOk ? deckCli : (deckCli ? `introuvable: ${deckCli}` : "manquant (--deck)"),
  });

  const toolbelt = args.toolbelt;
  const toolbeltOk = Boolean(toolbelt) && fs.existsSync(path.join(toolbelt, ".git"));
  prerequisites.push({
    id: "toolbelt-checkout",
    ok: toolbeltOk,
    expected: "--toolbelt pointe vers un checkout git de tilap/pinkpuma-toolbelt.",
    actual: toolbeltOk ? toolbelt : (toolbelt ? `pas un checkout git: ${toolbelt}` : "manquant (--toolbelt)"),
  });

  const emptyOk = isEmptyDir(target);
  prerequisites.push({
    id: "empty-target",
    ok: emptyOk,
    expected: "Le répertoire cible est absent ou vide.",
    actual: emptyOk ? target : `non vide: ${target}`,
  });

  let remoteSha = "";
  let localSha = "";
  let version = "";
  if (cliOk) {
    const packagePath = deckPackagePath(deckCli);
    if (!fs.existsSync(packagePath)) {
      prerequisites.push({
        id: "deck-version",
        ok: false,
        expected: "package.json est à côté du dossier src/ du CLI.",
        actual: `introuvable: ${packagePath}`,
      });
    } else {
      try {
        version = deckVersion(deckCli);
      } catch (error) {
        version = "";
        prerequisites.push({
          id: "deck-version",
          ok: false,
          expected: "package.json du CLI est lisible.",
          actual: error.message,
        });
      }
    }
  }
  if (toolbeltOk) {
    try {
      remoteSha = toolbeltHead(toolbelt);
      prerequisites.push({
        id: "toolbelt-reachable",
        ok: true,
        expected: "git peut lire origin/HEAD du checkout tilap/pinkpuma-toolbelt.",
        actual: remoteSha,
      });
    } catch (error) {
      prerequisites.push({
        id: "toolbelt-reachable",
        ok: false,
        expected: "git peut lire origin/HEAD du checkout tilap/pinkpuma-toolbelt.",
        actual: error.message,
      });
    }
  }

  if (toolbeltOk) {
    try {
      localSha = localHead(toolbelt);
      prerequisites.push({
        id: "toolbelt-head",
        ok: true,
        expected: "Le checkout toolbelt a un HEAD local (utilisé comme --ref).",
        actual: localSha,
      });
    } catch (error) {
      prerequisites.push({
        id: "toolbelt-head",
        ok: false,
        expected: "Le checkout toolbelt a un HEAD local (utilisé comme --ref).",
        actual: error.message,
      });
    }
  }

  const blocked = prerequisites.some((item) => !item.ok);
  const steps = buildSteps();
  const api = createApi(target, localSha, { deck: deckCli, toolbelt });
  const executed = [];

  if (!blocked) {
    fs.mkdirSync(target, { recursive: true });
    for (const step of steps) executed.push(runStep(step, api));
  } else {
    const reason = "Non exécuté : un prérequis a échoué.";
    for (const step of steps) executed.push(skipStep(step, reason));
  }

  const finishedAt = new Date();
  const report = {
    resultFormat: RESULT_FORMAT,
    runId: startedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-"),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    target,
    deck: { version, cli: deckCli },
    toolbelt: { repo: TOOLBELT_REPO, sha: remoteSha, localSha, checkout: toolbelt },
    node: process.version,
    prerequisites,
    summary: summarize(executed),
    steps: executed,
    endState: endState(target),
  };

  const written = writeReport(report);
  console.log(
    `${written.mdPath}\npass=${report.summary.pass} fail=${report.summary.fail} skipped=${report.summary.skipped}`,
  );
  if (report.summary.fail > 0 || blocked) process.exitCode = 1;
}

main();
