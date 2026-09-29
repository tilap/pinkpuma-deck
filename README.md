# pinkpuma-deck

Tooling for Claude Code / Cursor **plugin marketplaces**: release skills and a sync CLI.
Install these tools when you need to version, changelog, tag, or sync marketplace
plugins — in this repo or in any other marketplace that uses the same layout.

Every plugin ships as a single source shared by both tools — see [HOWTO.md](HOWTO.md).

## Plugins

| Plugin                                                     | Purpose                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| [plugins-pack-maintainer](plugins/plugins-pack-maintainer) | Version, changelog, and tag releases for marketplace plugins |

## CLI

Consumer-side install/sync — npm package [`@pinkpuma/deck`](cli/README.md).
`.agent/plugins.json` is what you ask for. `.agent/plugins.lock.json` is the resolved commit and the paths sync wrote. Commit `plugins.json`; the lock is local (deck appends it to `.gitignore` when one already exists).

```bash
npx @pinkpuma/deck init
npx @pinkpuma/deck add owner/marketplace-repo@plugin-name --ref v0.1.0
npx @pinkpuma/deck sync

# author a new marketplace repo
npx @pinkpuma/deck scaffold my-marketplace --owner "Your Name"
```

## Install (agent plugins)

### Claude Code

```bash
claude plugin marketplace add tilap/pinkpuma-deck
claude plugin install plugins-pack-maintainer@pinkpuma-deck
```

While authoring this repo, register the local clone instead:

```bash
cd /path/to/this-repo
claude plugin marketplace add ./
claude plugin install plugins-pack-maintainer@pinkpuma-deck
```

Use `--scope project` and commit `.claude/settings.json` when a project should pin the
tooling for every collaborator.

### Cursor

Add the plugin from Cursor’s plugin manager by pointing it at
`plugins/plugins-pack-maintainer/` (or link under `~/.cursor/plugins/local/`).

## Repository layout and contributing

See [HOWTO.md](HOWTO.md) and [AGENTS.md](AGENTS.md).
