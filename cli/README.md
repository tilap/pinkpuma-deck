# @pinkpuma/deck

Install and sync Claude Code / Cursor marketplace plugins into a consumer project.
`ai-plugin.json` is the request. `ai-plugin.local.json` is an optional gitignored link
to a checkout you are editing. `ai-plugin.lock.json` is the resolved install.

```bash
npm i -g @pinkpuma/deck
# or
npx @pinkpuma/deck --help

# from this package directory while developing
npm link
deck --help
```

## Commands

| Command                                            | Effect                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `init`                                             | Create an empty `ai-plugin.json`                                                                                                     |
| `add owner/repo@plugin [--ref <tag\|branch\|sha>]` | Add the request and sync (use `--no-sync` to record the request without copying)                                                     |
| `remove owner/repo@plugin`                         | Drop the request and delete installed files (`--keep-files` to leave the copies)                                                     |
| `link <checkout>@<plugin>`                         | Install a plugin from a local checkout, including uncommitted files. Does not edit `ai-plugin.json`                                  |
| `unlink owner/repo@plugin`                         | Drop that link and its installed files (`--keep-files` to leave the copies). If `ai-plugin.json` still requests it, restore that ref |
| `sync`                                             | Re-install every requested plugin (committed and linked), refresh copies, and rewrite the lock                                       |
| `list`                                             | Show requested plugins and, when synced, the resolved commit                                                                         |
| `scaffold <name> --owner <name> [--dir <parent>]`  | Create a new marketplace repo under `<dir>/<name>` (default dir: cwd)                                                                |

`--project <dir>` (or `-C`) scopes consumer commands (`init` / `add` / `remove` / `link` /
`unlink` / `sync` / `list`) to that project root (default: cwd).
`--no-agents-md` / `--agents-md` on `add`, `remove`, `link`, `unlink`, and `sync` set `writeAgentsMd` in
the lock (default `true`).

`scaffold` is author-side: it writes `.claude-plugin/marketplace.json`, empty `plugins/`,
`AGENTS.md`, `HOWTO.md`, `README.md`, and `.gitignore`. `--owner` is required and becomes
`owner.name` in the marketplace manifest.

## What gets copied

For each locked plugin, the CLI clones the GitHub marketplace at `ref`, resolves
`plugins/<name>/` (via `.claude-plugin/marketplace.json` when present), then vendors:

| Component                                                                       | Claude Code              | Cursor                   |
| ------------------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Skills (`skills/*/SKILL.md`)                                                    | `.claude/skills/<name>/` | `.cursor/skills/<name>/` |
| Agents (`agents/*.md`)                                                          | `.claude/agents/`        | `.cursor/agents/`        |
| Other plugin files (`CONVENTIONS.md`, `scripts/`, `templates/`, `README.md`, …) | `.claude/plugins/<id>/`  | `.cursor/plugins/<id>/`  |
| MCP (`mcp.json` / `.mcp.json` / manifest `mcpServers`)                          | `.mcp.json`              | `.cursor/mcp.json`       |

Relative links in an installed skill that point at those other plugin files are rewritten
to the per-plugin directory, so two plugins can both ship a `CONVENTIONS.md`.

Sync replaces those paths. Remove deletes every path recorded in the lock for that
plugin, including a file that was already there before the first install.

Optional `skills/<name>/DEFAULT_USAGE.md` is not copied into the skill directory. Sync
stores its body on the lock entry as `agentsSnippets` and, when `AGENTS.md` already
exists and `writeAgentsMd` is true, rewrites a marked `## Skills` block from those
snippets. Deck never creates `AGENTS.md`. Pass `--no-agents-md` (or set
`writeAgentsMd: false` in the lock) to skip that rewrite and remove a previous block.

`add` writes `ai-plugin.json` first, then copies and updates the lock. `--no-sync`
writes only the request. `sync` deletes plugins that are no longer requested by
`ai-plugin.json` or `ai-plugin.local.json`. `remove --keep-files` drops both entries
and leaves the copied files. `link` writes `ai-plugin.local.json` only.

MCP server keys are namespaced (`deck__owner_repo__plugin__server`) so sync does not
clobber unrelated servers. The lock records those keys so remove can drop them.

## ai-plugin.json

The request, committed with the project:

```json
{
  "plugins": [
    {
      "marketplace": "owner/marketplace-repo",
      "name": "plugin-name",
      "ref": "v0.1.0"
    }
  ]
}
```

`ref` is the tag, branch, or commit you asked for.

## Developing a plugin

`link` installs one plugin from a local marketplace checkout, including files that are
not committed yet. The checkout's `origin` must be the GitHub `owner/repo` used as the
marketplace id. A link is stored in `ai-plugin.local.json` (gitignored, same shape as
`ai-plugin.json` plus `from`). It does not change `ai-plugin.json`.

```bash
deck link /path/to/pinkpuma-toolbelt@nextjs-app-structure --project /path/to/app
# edit the skill, then pick up the working tree again:
deck sync --project /path/to/app
deck unlink tilap/pinkpuma-toolbelt@nextjs-app-structure --project /path/to/app
```

On `sync`, a linked plugin replaces a committed request with the same marketplace and
name. `unlink` removes that override. If `ai-plugin.json` still requests the plugin,
`unlink` installs that ref again.

`DECK_LOCAL_<owner>__<repo>` remains the switch for scripts and integration tests. `link`
is the command for day-to-day work on a plugin.

## ai-plugin.lock.json

The resolved install, local to the machine. `resolved` is the commit SHA `ref`
pointed at when sync ran. A linked plugin also records `source`, the absolute path
of the checkout. `paths` and `mcpKeys` are everything that sync wrote for
that plugin. `agentsSnippets` holds each skill's `DEFAULT_USAGE.md` body for the
`AGENTS.md` block. `writeAgentsMd` (default `true`) controls whether sync writes that
block. Set it to `false`, or pass `--no-agents-md`, to leave `AGENTS.md` alone and
strip a previous marked block.

When the project already has a `.gitignore`, writing the lock or a link appends
`ai-plugin.lock.json` and `ai-plugin.local.json` to it (deck does not create
`.gitignore`). Commit `ai-plugin.json`. Leave the lock and the local file uncommitted.
Optionally gitignore `.claude/skills`, `.cursor/skills`, agents,
plugin asset directories, and generated MCP keys — or commit those copies for offline
clones.

```json
{
  "lockfileVersion": 2,
  "writeAgentsMd": true,
  "plugins": [
    {
      "marketplace": "owner/marketplace-repo",
      "name": "plugin-name",
      "ref": "v0.1.0",
      "resolved": "0123456789abcdef0123456789abcdef01234567",
      "paths": [".claude/skills/plugin-name", ".cursor/skills/plugin-name"],
      "mcpKeys": {},
      "agentsSnippets": [
        {
          "skill": "plugin-name",
          "body": "- **Example.** If the `plugin-name` skill is available, …"
        }
      ]
    }
  ]
}
```

`lockfileVersion` is the **format** version of this file (not a plugin semver). The CLI
refuses unknown versions.

Cache clones live under `~/.cache/pinkpuma-deck/` (override with `DECK_CACHE`).

Scripts and integration tests can still install from a local checkout with
`DECK_LOCAL_<owner>__<repo>`. The current branch name and `HEAD` use the working tree,
including uncommitted files. Any other ref is checked out from a local clone. For
day-to-day editing, use `link` instead.

```bash
DECK_LOCAL_tilap__pinkpuma-toolbelt=/path/to/pinkpuma-toolbelt \
  deck add tilap/pinkpuma-toolbelt@git-workflow
```

## Auth

Uses the machine’s existing `git` access to GitHub (SSH agent, `gh`, credential helper).
No tokens are stored by this CLI.

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
