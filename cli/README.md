# @pinkpuma/deck

Install and sync Claude Code / Cursor marketplace plugins into a consumer project.
`.agent/plugins.json` is the request. `.agent/plugins.lock.json` is the resolved install.

```bash
npm i -g @pinkpuma/deck
# or
npx @pinkpuma/deck --help

# from this package directory while developing
npm link
deck --help
```

## Commands

| Command                                            | Effect                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `init`                                             | Create an empty `.agent/plugins.json`                                            |
| `add owner/repo@plugin [--ref <tag\|branch\|sha>]` | Add the request and sync (use `--no-sync` to record the request without copying) |
| `remove owner/repo@plugin`                         | Drop the request and delete installed files (`--keep-files` to leave the copies) |
| `sync`                                             | Re-download every requested plugin, refresh copies, and rewrite the lock         |
| `list`                                             | Show requested plugins and, when synced, the resolved commit                     |

`--project <dir>` (or `-C`) scopes all commands to that project root (default: cwd).

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

`add` writes `.agent/plugins.json` first, then copies and updates the lock. `--no-sync`
writes only the request. `sync` deletes plugins that are no longer requested.
`remove --keep-files` drops both entries and leaves the copied files.

MCP server keys are namespaced (`deck__owner_repo__plugin__server`) so sync does not
clobber unrelated servers. The lock records those keys so remove can drop them.

## plugins.json

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

## plugins.lock.json

The resolved install, also committed. `resolved` is the commit SHA `ref` pointed at
when sync ran. `paths` and `mcpKeys` are everything that sync wrote for that plugin.

```json
{
  "lockfileVersion": 2,
  "plugins": [
    {
      "marketplace": "owner/marketplace-repo",
      "name": "plugin-name",
      "ref": "v0.1.0",
      "resolved": "0123456789abcdef0123456789abcdef01234567",
      "paths": [".claude/skills/plugin-name", ".cursor/skills/plugin-name"],
      "mcpKeys": {}
    }
  ]
}
```

`lockfileVersion` is the **format** version of this file (not a plugin semver). The CLI
refuses unknown versions.

Commit both files. Optionally gitignore `.claude/skills`, `.cursor/skills`, agents,
plugin asset directories, and generated MCP keys — or commit those copies for offline
clones. Cache clones live under `~/.cache/pinkpuma-deck/` (override with `DECK_CACHE`).

To install from a local checkout instead of GitHub, set `DECK_LOCAL_<owner>__<repo>`
to that checkout. The current branch name and `HEAD` use the working tree, including
uncommitted files. Any other ref is checked out from a local clone.

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
