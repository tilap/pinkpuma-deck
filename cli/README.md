# @pinkpuma/deck

Install AI plugins and skills into a project, for Claude Code and Cursor, and reinstall
exactly the same thing later — on another machine, in CI, or for an agent runner.

| npm                 | deck                                                         | Commit |
| ------------------- | ------------------------------------------------------------ | ------ |
| `package.json`      | `ai-plugin.json` — what you ask for                          | yes    |
| `package-lock.json` | `ai-plugin.lock.json` — commits, versions, digests, contents | yes    |
| `node_modules/`     | `.deck/plugins/<id>/` — each plugin, normalized              | no     |
| —                   | `.deck/state.json` — what deck wrote on this machine         | no     |
| —                   | `ai-plugin.local.json` — links to working trees              | no     |

```bash
npm i -g @pinkpuma/deck
# or
npx @pinkpuma/deck --help
```

## Commands

| Command                                                                                 | Effect                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `init`                                                                                  | Create an empty `ai-plugin.json`                                               |
| `add <source> [--ref] [--plugin] [--skill <name>]… [--path] [--id] [--sha256] [--no-sync]` | Resolve, install, and lock; the request is written only if that succeeds      |
| `remove <id> [--keep-files]`                                                            | Drop the request, its normalized tree, its installed files, and its lock entry |
| `install [--frozen]` (alias `sync`)                                                     | Make the project match `ai-plugin.json`, pinned by the lock                    |
| `update [<id>…]`                                                                        | Resolve refs again (all, or the ids given) and rewrite the lock                |
| `list`                                                                                  | Requests, their lock pin, and their components                                 |
| `outdated`                                                                              | Lock pins vs what each ref or range points to now, and newer release tags (exit 1 when behind) |
| `doctor`                                                                                | Check request ↔ lock ↔ `.deck/` ↔ host activation ↔ `.gitignore` (exit 1 on errors) |
| `link <checkout>[@<plugin>] [--id] [--skill]… [--path]`                                 | Install a working tree, uncommitted files included. Not locked                 |
| `unlink <id> [--keep-files]`                                                            | Drop the link; reinstall the committed request if there is one                 |
| `scaffold <name> --owner <name> [--dir <parent>]`                                       | Create a new marketplace repo under `<dir>/<name>`                             |

Common flags: `--project <dir>` (`-C`) scopes the command to a project root (default:
cwd). `--force` lets copy mode replace a file deck did not write. `--no-agents-md` /
`--agents-md` control the `AGENTS.md` skills block.

## Sources

| You type                          | Request                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `owner/repo@plugin`               | `{ "source": "github:owner/repo", "plugin": "plugin" }` |
| `owner/repo`                      | a single-plugin repository, or a repository of skills   |
| `owner/repo --skill a --skill b`  | only those skills                                       |
| `https://github.com/owner/repo`   | same as `owner/repo`                                    |
| `git+https://gitlab.com/t/r.git#v1` | `{ "source": "git:https://gitlab.com/t/r.git", "ref": "v1" }` |
| `git@host:team/repo.git`          | any git host over SSH                                   |
| `npm:@scope/pkg@^2`               | `{ "source": "npm:@scope/pkg", "version": "^2" }`       |
| `https://…/kit.zip` (or `.tar.gz`) | `{ "source": "archive:https://…/kit.zip" }`             |

The id defaults to the plugin name (or the repository name); `--id` overrides it.
Without `--ref`, deck takes the default branch and locks the commit it found.

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

Every plugin is first normalized under `.deck/plugins/<id>/`: `skills/`, `agents/`,
`commands/`, `rules/`, `hooks/hooks.json`, `mcp.json`, its support files, and generated
`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and root `plugin.json`. That
tree loads as is with `claude --plugin-dir` and `cursor-agent --plugin-dir`.
`.deck/.claude-plugin/marketplace.json` lists every installed plugin as a local
marketplace.

Then each host is activated. `ai-plugin.json` can set a mode per host:

```json
{ "plugins": [], "hosts": { "claude": "native", "cursor": "copy" } }
```

| Mode     | Claude Code                                                                 | Cursor                                   |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `native` | default — `.deck/` is a local marketplace; each plugin is installed from it | not supported, falls back to `copy`      |
| `copy`   | vendor components into `.claude/`, `.mcp.json`                              | default — vendor into `.cursor/`         |
| `off`    | nothing for that host                                                       | nothing for that host                    |

**Native (Claude Code).** deck runs `claude plugin marketplace add <project>/.deck --scope
local`, then `claude plugin install <id>@deck --scope local` for each plugin (and
`plugin uninstall` when it goes). An installed plugin needs no further call: Claude reads
its tree in place. Claude reads `.deck/plugins/<id>/` in place,
so hooks, commands, agents, MCP servers, and `${CLAUDE_PLUGIN_ROOT}` work as the plugin
author intended, and skills are namespaced (`impeccable:impeccable`). The registration is
recorded in `.claude/settings.local.json` and in the user's plugin registry, so every
machine runs `deck install` once. Without the `claude` CLI on `PATH` (or
`DECK_CLAUDE_BIN`), deck falls back to copy mode and says so. The `deck` marketplace is
removed when no plugin is installed from it.

**Cursor.** `cursor-agent` ignores plugin paths returned by a `workspaceOpen` hook (checked
with cursor-agent 2026.10.01), so Cursor uses copy mode. Agent runners can still pass
`.deck/plugins/<id>` to `cursor-agent --plugin-dir`.

Copy mode writes:

| Component                      | Claude Code                        | Cursor                             |
| ------------------------------ | ---------------------------------- | ---------------------------------- |
| Skills                         | `.claude/skills/<name>/`           | `.cursor/skills/<name>/`           |
| Agents (nested folders kept)   | `.claude/agents/`                  | `.cursor/agents/`                  |
| Commands                       | `.claude/commands/<id>/`           | `.cursor/commands/<id>/`           |
| Rules                          | —                                  | `.cursor/rules/<id>/`              |
| Support files                  | `.claude/plugins/<id>/`            | `.cursor/plugins/<id>/`            |
| MCP (keys `deck__<id>__<server>`) | `.mcp.json`                     | `.cursor/mcp.json`                 |

Relative links from a skill to a support file are rewritten to the per-plugin directory.
`${CLAUDE_PLUGIN_ROOT}`, `${CURSOR_PLUGIN_ROOT}`, and `${PLUGIN_ROOT}` are replaced with
that directory in skills and MCP servers. Hooks are not active in copy mode; deck and
`deck doctor` say so. Copy mode refuses to write a path another plugin owns, or one deck did not write
(`--force` replaces the latter).

Optional `skills/<name>/DEFAULT_USAGE.md` is not copied. Its body is stored in the lock
as `agentsSnippets` and, when `AGENTS.md` exists and `writeAgentsMd` is true, written to
a marked `## Skills` block. Deck never creates `AGENTS.md`.

## ai-plugin.json

```json
{
  "plugins": [
    { "id": "impeccable", "source": "github:pbakaus/impeccable", "plugin": "impeccable", "ref": "v4.5.2" },
    { "id": "doc-skills", "source": "github:anthropics/skills", "plugin": "document-skills" },
    { "id": "fmt", "source": "npm:@acme/formatter", "version": "^2" }
  ]
}
```

Entries written by deck 0.6 and earlier (`{ marketplace, name, ref }`) are read and
rewritten in this shape.

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

A format 2 lock (deck 0.6) is converted on the next `install`; the paths it recorded move
to `.deck/state.json` so the files an older deck wrote are replaced. When a `.gitignore`
exists, deck lists `.deck/` and `ai-plugin.local.json` in it and removes the
`ai-plugin.lock.json` line an older deck added.

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
