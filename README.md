# pinkpuma-deck

CLI to install and sync Claude Code / Cursor plugins and skills into a project.
[`@pinkpuma/deck`](cli/README.md) resolves what you ask for into a lockfile, the same way
npm does with `package.json` and `package-lock.json`.

Commit `ai-plugin.json` and `ai-plugin.lock.json`. `.ai/installed/` stays on the machine
and comes back with `deck install`.

## Simple project

One shared set of plugins for the whole repository.

```bash
deck init
deck add owner/marketplace-repo@plugin-name --ref v0.1.0
deck add anthropics/skills --skill pdf
```

`init` wires `.gitignore`, `AGENTS.md`, and `CLAUDE.md`. `add` writes the request to
`ai-plugin.json`, pins it in `ai-plugin.lock.json`, and installs it for Claude Code and
Cursor.

On another machine, or in CI:

```bash
deck install --frozen
```

While editing a plugin in a local checkout, install that working tree and leave the
committed request as it is:

```bash
deck link /path/to/marketplace@plugin-name
```

## Project with profiles

The base from the simple project stays. Each profile is an agent role — builder, tester,
reviewer — with its own prompt and its own plugins, installed on top of that base.

```bash
deck profile new builder
deck add anthropics/skills --skill pdf --profile builder
deck profile use builder
```

`profile use` installs the base plus that profile, points Claude at the profile prompt,
and writes the Cursor rule from the same file. Open a new Claude session, or reload
Cursor, to pick it up.

```bash
deck profile use tester   # tester's plugins replace builder's; the base stays
deck profile off          # base only
deck profile list         # * marks the active profile
```

`add --profile tester` on a profile that is not active still resolves and locks the
plugin under `.ai/profiles/tester/`. It is installed when that profile is used. Each
plugin id lives in the base or in one profile.

Commit each profile folder:

```
.ai/profiles/builder/prompt.md
.ai/profiles/builder/ai-plugin.json
.ai/profiles/builder/ai-plugin.lock.json
```

`.ai/current` (which profile is active on this machine) stays local.

## Reference

Commands, sources, hosts, and the lock format: [cli/README.md](cli/README.md).

Working on this repo: [AGENTS.md](AGENTS.md). Unit tests are `cd cli && npm test`. The
toolbelt scenario is [cli/integration/README.md](cli/integration/README.md). Releasing
the package is [cli/README.md](cli/README.md#release).
