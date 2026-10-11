# HOWTO

How this repository is organized and how to work on its plugins and CLI.

## What this repo is

| Piece      | Role                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| `plugins/` | Agent skills for maintaining plugin marketplaces (release, changelog, tags) |
| `cli/`     | `npx`-able CLI to sync/install plugins into consumer projects               |

This marketplace ships **tooling**. Use its skills against any repository that follows the
standard marketplace layout (`plugins/<name>/` with dual manifests).

## Repository structure

```
.
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/plugin.json
│       ├── .cursor-plugin/plugin.json
│       ├── skills/
│       │   └── <skill-name>/SKILL.md
│       └── README.md
├── cli/                          # npm package — see cli/README.md
│   ├── package.json
│   └── src/
├── AGENTS.md
├── HOWTO.md
└── README.md
```

Both manifests under a plugin point at the same `skills/` directory.

## Two levels: marketplace repo vs plugin

| Level                              | What it is                       | Versioned how                                                                    |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Marketplace repository             | Git container that lists plugins | Ordinary commits and pushes                                                      |
| One plugin under `plugins/<name>/` | What users install               | Manifest `version` + per-plugin `CHANGELOG.md` + optional tag `<name>-v<semver>` |

Use the `plugin-release` skill (`plugins-pack-maintainer`) to cut a consumable release
for a plugin in this repo, or for a plugin in any other marketplace clone where the skill
is installed and the target path is in scope.

## Develop against a local clone

```bash
cd /path/to/this-repo
claude plugin marketplace add ./
claude plugin install plugins-pack-maintainer@pinkpuma-deck
```

Cursor: point the plugin manager at `plugins/plugins-pack-maintainer/` in the clone.
Do not copy skills into `~/.cursor/skills/` for development — one working tree is the
source of truth.

When editing `plugins-pack-maintainer` itself, keep it installed from this clone, test by
invoking `plugin-release`, then run `plugin-release` on `plugins-pack-maintainer` to ship
its own version.

## Create a plugin (in this repo)

1. Branch: `feat/add-<name>-plugin`.
2. Scaffold `plugins/<name>/` with dual manifests, `skills/`, and `README.md`.
3. Register in `.claude-plugin/marketplace.json` and the root README Plugins table.
4. `claude plugin validate --strict ./plugins/<name>`.
5. Install from the local marketplace and exercise the skills.
6. Commit; run `plugin-release` for the first version; push; tag if pinning.

## Change a plugin (in this repo)

1. Edit under `plugins/<name>/`; re-test with the local install.
2. Validate; commit.
3. When shipping: `plugin-release`, push, optional tag.

## Remove a plugin (in this repo)

1. Remove marketplace entry, README row, and `plugins/<name>/`.
2. Uninstall locally; commit and push. No `plugin-release` on a deleted plugin.

## Releasing a plugin in another marketplace

1. Install `plugins-pack-maintainer` from this marketplace (GitHub or local clone).
2. Open the target marketplace repository (any repo with `plugins/<name>/`).
3. Run `plugin-release` against that plugin path.
4. Prefer that repository’s own git conventions for commits when available.

## Write a skill

Portable frontmatter only by default (`name`, `description`, `metadata`,
`disable-model-invocation`, `paths`). Set `disable-model-invocation: true` on skills with
side effects. Keep `SKILL.md` bodies under ~500 lines; shared rules go in
`CONVENTIONS.md` at the plugin root.

## CLI

The `cli/` package is published as [`@pinkpuma/deck`](cli/README.md).

**Consumer projects** — install plugins and skills into an app:

```bash
npx @pinkpuma/deck init --project /path/to/app
npx @pinkpuma/deck add owner/repo@plugin-name --ref v0.1.0 --project /path/to/app
npx @pinkpuma/deck install --frozen --project /path/to/app

# while editing a plugin, install that working tree into an app:
npx @pinkpuma/deck link /path/to/marketplace@plugin-name --project /path/to/app
```

Each plugin is normalized under `.deck/plugins/<id>/`. Claude Code installs it natively
from `.deck/` as a local marketplace (hooks and commands included); Cursor gets copies in
`.cursor/` (skills, agents, commands, rules, support files, MCP in `.cursor/mcp.json`).
`deck doctor` checks the whole chain and `deck outdated` shows what `deck update` would
move. `ai-plugin.json` lists what to install and
`ai-plugin.lock.json` pins what it resolved to: commit both. `.deck/` and
`ai-plugin.local.json` (links to checkouts, which win over the same id) stay local; deck
lists them in an existing `.gitignore`. See [cli/README.md](cli/README.md).

**Author a new marketplace** — empty repo layout (no plugins yet):

```bash
npx @pinkpuma/deck scaffold my-marketplace --owner "Your Name"
npx @pinkpuma/deck scaffold my-marketplace --owner "Your Name" --dir /path/to/parent
```

Creates `<dir>/<name>/` with `.claude-plugin/marketplace.json`, empty `plugins/`,
`AGENTS.md`, `HOWTO.md`, `README.md`, and `.gitignore`. See [cli/README.md](cli/README.md).

When changing the CLI:

```bash
cd cli && npm test
```

`npm test` is the unit suite. The toolbelt scenario in [`cli/integration`](cli/integration/README.md) is separate and does not run on publish:

```bash
rm -rf cli/integration/sandbox
node cli/integration/run.mjs \
  --deck cli/src/cli.mjs \
  --toolbelt /path/to/pinkpuma-toolbelt
```

Pull requests that change `cli/` run that scenario. The workflow checks out the private toolbelt repo with the Actions secret `TOOLBELT_READ_TOKEN` (contents: read on `tilap/pinkpuma-toolbelt`).

Release: bump `cli/package.json` `version`, push to `main`, then tag `deck-vX.Y.Z`.
GitHub Actions publishes via npm Trusted Publishing (OIDC) — no token, no manual
approve. Configure Trusted Publisher with **`npm publish`** allowed for
`publish-deck.yml`. See [cli/README.md](cli/README.md#release).

## Verification

```bash
claude plugin validate --strict ./plugins/<name>
```

Zero warnings. Cursor has no equivalent CLI — keep both manifests identical and load the
plugin locally to smoke-test.

## Distribution

Prefer registering this repository from its GitHub source for everyday use. Use a local
`./` marketplace only when authoring this kit. Private repos need normal git/`gh` access
on the machine; Claude Code holds no separate credentials.

## Versioning

Cut plugin releases with `plugin-release`. See
[`plugins/plugins-pack-maintainer/CONVENTIONS.md`](plugins/plugins-pack-maintainer/CONVENTIONS.md).
Bump `@pinkpuma/deck` (`cli/package.json`) separately when shipping CLI changes.
