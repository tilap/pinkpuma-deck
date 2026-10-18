# @pinkpuma/deck

Install AI plugins and skills into a project, for Claude Code and Cursor, and reinstall
exactly the same thing later — on another machine, in CI, or for an agent runner.

| npm                 | deck                                                                | Commit |
| ------------------- | ------------------------------------------------------------------- | ------ |
| `package.json`      | `ai-plugin.json` — what you ask for                                 | yes    |
| `package-lock.json` | `ai-plugin.lock.json` — commits, versions, digests, contents        | yes    |
| `node_modules/`     | `.ai/installed/plugins/<id>/` — each plugin, normalized             | no     |
| —                   | `.ai/installed/state.json` — what deck wrote on this machine        | no     |
| —                   | `.ai/profiles/<name>/` — agent profiles (see [Profiles](#profiles)) | yes    |
| —                   | `ai-plugin.local.json` — links to working trees                     | no     |

```bash
npm i -g @pinkpuma/deck
# or
npx @pinkpuma/deck --help
```

## Commands

```
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
```

| Command       | Effect                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`        | Wire deck into the project: see [Set up a project](#set-up-a-project)                                                                                                                                                |
| `add`         | Resolve, install, and lock. The request is written only if that succeeds. Creates `ai-plugin.json` if needed                                                                                                         |
| `remove`      | Drop the request, its normalized tree, its installed files, and its lock entry                                                                                                                                       |
| `install`     | Make the project match the base and the active profile, pinned by the locks. `--frozen` for CI                                                                                                                       |
| `update`      | Resolve refs again (all, or the ids given) and rewrite the lock                                                                                                                                                      |
| `status`      | Active profile, every request (`[base]`, `[profile x]`, `[link]`) and its lock pin, and every mismatch between request, lock, `.ai/installed/`, hosts, and `.gitignore`. Never touches the network. Exit 1 on errors |
| `outdated`    | Lock pins vs what each ref or range points to now, and newer release tags. Exit 1 when behind                                                                                                                        |
| `link`        | Install a local folder (a git checkout, uncommitted files included, or any folder of skills). Not locked                                                                                                             |
| `unlink`      | Drop the link; reinstall the committed request if there is one                                                                                                                                                       |
| `profile`     | Agent profiles: see [Profiles](#profiles)                                                                                                                                                                            |
| `materialize` | Build the base and one profile into a folder, for a tool that launches agents: see [Materialize](#materialize)                                                                                                       |

Every command takes `-C <dir>` (`--project`), `--force` (let copy mode replace a file deck
did not write), and `--help`. An option a command does not take is refused.

Advanced options: `add --id <id> --path <dir in source> --sha256 <hex> --no-install`,
`remove --keep-files` and `unlink --keep-files`, `link --id <id> --path <dir> --no-install`.

## Set up a project

```bash
deck init                  # once per project; safe to run again
deck init --commit-copies  # same, but commit the copies in .claude/ and .cursor/
```

| File             | `deck init`                                         | Afterwards                                                      |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `ai-plugin.json` | Created when missing                                | `deck add` / `remove`                                           |
| `.gitignore`     | Created when missing; deck's managed block written  | `deck install` rewrites the block                               |
| `AGENTS.md`      | Created when missing                                | `deck install` rewrites its `## Skills` block                   |
| `CLAUDE.md`      | Created when missing, or given an `@AGENTS.md` line | `deck profile use` / `off` add or drop `@.ai/current/prompt.md` |

`CLAUDE.md` imports `AGENTS.md`, so Claude Code reads what Cursor reads: write project
instructions once, in `AGENTS.md`.

deck's block in `.gitignore` sits between two markers and is rewritten whole; lines
outside it are never touched:

```
# >>> @pinkpuma/deck (managed: rewritten by deck install)
.ai/installed/
.ai/current
ai-plugin.local.json
.cursor/rules/deck-profile.mdc
/.cursor/skills/commit
…
# <<< @pinkpuma/deck
```

Besides the local files, it lists every path copy mode writes in `.claude/` and `.cursor/`
for every plugin the base **or any profile** pins, read from the committed locks, for every
host that is not `off`: like `node_modules`, they come back with `deck install`, so the
repository holds only the intent (`ai-plugin.json`, locks, profiles). The block does not
depend on the active profile or on which CLIs a machine has: `deck profile use` never
changes `.gitignore`, and adding to or removing from a profile that is not active updates it. `deck init --commit-copies` sets
`"gitignoreCopies": false` in `ai-plugin.json`: the copies stay out of the block and get
committed, so a fresh clone works in Cursor before `deck install`. Shared files deck edits
(`.mcp.json`, `.cursor/mcp.json`, `AGENTS.md`, `CLAUDE.md`) are never ignored.

`deck install` never creates `.gitignore`; `deck status` warns when the block is missing.

## Profiles

A profile is an agent role — builder, tester, reviewer — with its own prompt and plugins,
on top of the base every profile gets:

```
ai-plugin.json, ai-plugin.lock.json                 the base (committed)
.ai/profiles/builder/prompt.md                      the builder's prompt (committed)
.ai/profiles/builder/ai-plugin.json, …lock.json     the builder's plugins (committed)
.ai/current → profiles/builder                      the active profile (local)
.ai/installed/                                      installed plugins and state (local)
```

```bash
deck profile new builder                         # .ai/profiles/builder/ with prompt.md and an empty request
deck add anthropics/skills --skill pdf --profile builder
deck profile use builder                         # base + builder installed; then a new Claude session / reload Cursor
deck profile use tester                          # builder's plugins leave, tester's arrive, the base is untouched
deck profile off
deck profile list                                # * marks the active one
```

`deck add --profile x` on a profile that is not active resolves and locks the plugin in
`.ai/profiles/x/` without installing it. A plugin id belongs to the base or to a profile, not both.

The prompt follows `.ai/current`: `profile use` adds `@.ai/current/prompt.md` to
`CLAUDE.md` once, and writes `.cursor/rules/deck-profile.mdc` (`alwaysApply`) from the
profile's `prompt.md`. `profile off` removes both. `.ai/current` and the Cursor rule are
in deck's `.gitignore` block.

## Materialize

`deck materialize` builds what an agent needs to run, without installing anything in the
project: the base and one profile (or the base alone), as pinned by their locks, each
plugin in `<out>/<id>/` with its Claude Code and Cursor manifests.

```bash
deck materialize --profile builder --out /tmp/agents/builder --json
```

```json
{
  "profile": "builder",
  "prompt": "/path/to/project/.ai/profiles/builder/prompt.md",
  "out": "/tmp/agents/builder",
  "plugins": [
    { "id": "git-workflow", "path": "/tmp/agents/builder/git-workflow", "integrity": "sha256-…", "components": { "skills": ["commit", "…"], "…": [] } }
  ]
}
```

- Always frozen: a request a lock does not pin, or content that differs from its
  integrity, is refused.
- `--profile` names the profile; `.ai/current` is not read, so several profiles can be
  built side by side. Local links are ignored: the output is what is committed.
- Writes only in `--out`: nothing in `.claude/`, `.cursor/`, the locks, `.ai/installed/`,
  `.gitignore`, or `AGENTS.md`. A plugin already in `--out` with the locked integrity is
  kept; a folder of a plugin no longer requested is removed.

Load the result with `claude --plugin-dir <out>` (Claude loads every plugin in the folder)
or one `cursor-agent --plugin-dir <out>/<id>` per plugin, and pass `prompt` as the
agent's instructions.

## Sources

| You type                            | Request                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `owner/repo@plugin`                 | `{ "source": "github:owner/repo", "plugin": "plugin" }`       |
| `owner/repo`                        | a single-plugin repository, or a repository of skills         |
| `owner/repo --skill a --skill b`    | only those skills                                             |
| `https://github.com/owner/repo`     | same as `owner/repo`                                          |
| `git+https://gitlab.com/t/r.git#v1` | `{ "source": "git:https://gitlab.com/t/r.git", "ref": "v1" }` |
| `git@host:team/repo.git`            | any git host over SSH                                         |
| `npm:@scope/pkg@^2`                 | `{ "source": "npm:@scope/pkg", "version": "^2" }`             |
| `https://…/kit.zip` (or `.tar.gz`)  | `{ "source": "archive:https://…/kit.zip" }`                   |
| `./plugins/name`                    | `{ "source": "path:plugins/name" }`                           |
| `./plugins@name`                    | `{ "source": "path:plugins", "plugin": "name" }`              |

The id defaults to the plugin name (or the repository name); `--id` overrides it.
Without `--ref`, deck takes the default branch and locks the commit it found.

`./path` is a directory inside the project. The request stores `path:<relative>` (no leading
`./`) and the lock stores that path plus the integrity of the normalized tree. `deck install`
re-reads the directory; `--frozen` refuses when the files no longer match the lock. A path
without `./` is a GitHub `owner/repo`. A folder outside the project is `deck link`.

Inside a fetched source, deck finds the plugin the way Claude Code and Cursor do:

- `.claude-plugin/marketplace.json` or `.cursor-plugin/marketplace.json`, with every
  Claude Code plugin source: relative path (and `metadata.pluginRoot` bare names),
  `github`, `url`, `git-subdir`, `npm`, and `archive`. A source object is fetched in turn
  and its own commit is locked as `nested`. `command` sources are refused.
- `strict` semantics: an entry without `plugin.json` is the manifest (e.g. the skill
  lists of `anthropics/skills`); a `strict: false` entry that declares components next
  to a `plugin.json` is a conflict.
- Custom component paths in `.claude-plugin/plugin.json` or `.cursor-plugin/plugin.json`
  (`skills`, `agents`, `commands`, `rules`, `hooks`, `mcpServers`).
- No marketplace: `plugins/<name>/`, a plugin at the root, a `skills/*/SKILL.md`
  repository, or a single `SKILL.md` at the root.

## What gets installed

Every plugin is first normalized under `.ai/installed/plugins/<id>/`: `skills/`, `agents/`,
`commands/`, `rules/`, `hooks/hooks.json`, `mcp.json`, its support files, and generated
`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and root `plugin.json`. That
tree loads as is with `claude --plugin-dir` and `cursor-agent --plugin-dir`.
`.ai/installed/.claude-plugin/marketplace.json` lists every installed plugin as a local
marketplace.

Then each host is activated. `ai-plugin.json` can set a mode per host:

```json
{ "plugins": [], "hosts": { "claude": "native", "cursor": "copy" } }
```

| Mode     | Claude Code                                                                         | Cursor                              |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `native` | default — `.ai/installed/` is a local marketplace; each plugin is installed from it | not supported, falls back to `copy` |
| `copy`   | vendor components into `.claude/`, `.mcp.json`                                      | default — vendor into `.cursor/`    |
| `off`    | nothing for that host                                                               | nothing for that host               |

**Native (Claude Code).** deck runs `claude plugin marketplace add <project>/.ai/installed --scope
local`, then `claude plugin install <id>@deck --scope local` for each plugin (and
`plugin uninstall` when it goes). An installed plugin needs no further call: Claude reads
its tree in place. Claude reads `.ai/installed/plugins/<id>/` in place,
so hooks, commands, agents, MCP servers, and `${CLAUDE_PLUGIN_ROOT}` work as the plugin
author intended, and skills are namespaced (`impeccable:impeccable`). The registration is
recorded in `.claude/settings.local.json` and in the user's plugin registry, so every
machine runs `deck install` once. Without the `claude` CLI on `PATH` (or
`DECK_CLAUDE_BIN`), deck falls back to copy mode and says so. The `deck` marketplace is
removed when no plugin is installed from it.

**Cursor.** `cursor-agent` ignores plugin paths returned by a `workspaceOpen` hook (checked
with cursor-agent 2026.10.01), so Cursor uses copy mode. Agent runners can still pass
`.ai/installed/plugins/<id>` to `cursor-agent --plugin-dir`.

Copy mode writes:

| Component                         | Claude Code              | Cursor                   |
| --------------------------------- | ------------------------ | ------------------------ |
| Skills                            | `.claude/skills/<name>/` | `.cursor/skills/<name>/` |
| Agents (nested folders kept)      | `.claude/agents/`        | `.cursor/agents/`        |
| Commands                          | `.claude/commands/<id>/` | `.cursor/commands/<id>/` |
| Rules                             | —                        | `.cursor/rules/<id>/`    |
| Support files                     | `.claude/plugins/<id>/`  | `.cursor/plugins/<id>/`  |
| MCP (keys `deck__<id>__<server>`) | `.mcp.json`              | `.cursor/mcp.json`       |

Relative links from a skill to a support file are rewritten to the per-plugin directory.
`${CLAUDE_PLUGIN_ROOT}`, `${CURSOR_PLUGIN_ROOT}`, and `${PLUGIN_ROOT}` are replaced with
that directory in skills and MCP servers. Hooks are not active in copy mode; deck and
`deck status` say so. Copy mode refuses to write a path another plugin owns, or one deck did not write
(`--force` replaces the latter).

Optional `skills/<name>/DEFAULT_USAGE.md` is not copied. Its body is stored in the lock
as `agentsSnippets` and, when `AGENTS.md` exists and `writeAgentsMd` is true, written to
a marked `## Skills` block. Deck never creates `AGENTS.md`.

## ai-plugin.json

Settings: `"hosts"` (see above), `"agentsMd": false` to leave `AGENTS.md` alone (the
lock mirrors it as `writeAgentsMd`), and `"gitignoreCopies": false` to commit the copies
(see [Set up a project](#set-up-a-project)).

```json
{
  "plugins": [
    { "id": "impeccable", "source": "github:pbakaus/impeccable", "plugin": "impeccable", "ref": "v4.5.2" },
    { "id": "doc-skills", "source": "github:anthropics/skills", "plugin": "document-skills" },
    { "id": "fmt", "source": "npm:@acme/formatter", "version": "^2" }
  ]
}
```


## ai-plugin.lock.json

Format 3, committed. One entry per id: the request, what it resolved to, the integrity of
the normalized tree, its components, and its `AGENTS.md` snippets. Nothing in it depends
on the machine.

```json
{
  "lockfileVersion": 3,
  "writeAgentsMd": true,
  "plugins": [
    {
      "id": "impeccable",
      "request": { "id": "impeccable", "source": "github:pbakaus/impeccable", "plugin": "impeccable" },
      "resolved": { "type": "git", "url": "https://github.com/pbakaus/impeccable.git", "sha": "c63b8dd7…" },
      "integrity": "sha256-…",
      "components": { "skills": ["impeccable"], "agents": ["…"], "commands": [], "rules": [], "hooks": true, "mcp": [] },
      "agentsSnippets": []
    }
  ]
}
```

`install` keeps each pin while the request is unchanged; `update` moves it. A plugin
whose pin, normalized tree, host modes, and installed files all match what is on disk is
skipped (`up to date`): no fetch, no copy, no `claude` call. Fetches are cached under
`~/.cache/pinkpuma-deck/` by commit, by exact npm version, and by archive digest, so a
pinned source is downloaded once per machine.
`install --frozen` refuses a request the lock does not pin, a lock entry nothing
requests, and a normalized tree whose integrity differs — use it in CI.

`.gitignore`: see [Set up a project](#set-up-a-project).

## Developing a plugin

`link` installs a local folder — a git checkout (uncommitted files included, `.gitignore`
respected) or any directory of skills — without touching `ai-plugin.json` or the lock. The link lives in `ai-plugin.local.json` and replaces a
committed request with the same id.

```bash
deck link /path/to/pinkpuma-toolbelt@nextjs-app-structure --project /path/to/app
# edit the skill, then pick up the working tree again:
deck install --project /path/to/app
deck unlink nextjs-app-structure --project /path/to/app
```

Caches live under `~/.cache/pinkpuma-deck/` (override with `DECK_CACHE`).
`DECK_LOCAL_<owner>__<repo>` points a GitHub source at a local checkout for scripts and
integration tests: the current branch and `HEAD` use the working tree, any other ref is
checked out from a local clone.

## Auth

Uses the machine’s existing `git` access (SSH agent, `gh`, credential helper) and npm
configuration. No tokens are stored by this CLI. npm packages are packed with
`--ignore-scripts`.

## Release

Fully automated: tag on `main` → GitHub Actions publishes to npm (no human approve).

1. Configure **Trusted Publisher** on npm for `@pinkpuma/deck`
   (Package → Settings → Trusted Publisher):
   - Organization/user: `tilap`
   - Repository: `pinkpuma-deck`
   - Workflow filename: `publish-deck.yml`
   - Allowed actions: **`npm publish`** (required for unattended releases)
2. Do **not** rely on `NPM_TOKEN` / bypass-2FA tokens — OIDC replaces them.
3. Bump `cli/package.json` `version`, push to `main`, tag `deck-vX.Y.Z`.
4. Actions runs `npm publish --access public --provenance`.

```bash
# after bumping package.json version on main:
git tag -a deck-vX.Y.Z -m "deck X.Y.Z"
git push origin deck-vX.Y.Z
```
