# AGENTS.md

Instructions for AI coding agents working in this repository. For a human-facing
overview, see [README.md](README.md); for create / change / remove / release and how to
use these tools against other marketplace repositories, see [HOWTO.md](HOWTO.md). Read
this file before making any change under `plugins/` or `cli/`.

## What this repo is

Tooling for Claude Code / Cursor plugin marketplaces: agent plugins under `plugins/`, and
the sync CLI under `cli/`. Skills operate on any marketplace that follows the standard
`plugins/<name>/` layout; the CLI vendors skills, agents, and MCP into consumer projects.

## Hard rules

1. **Uniform plugin layout.** Every plugin has matching `.claude-plugin/plugin.json` and
   `.cursor-plugin/plugin.json` (`name`, `version`, `description`, `author`), a `skills/`
   directory, and a `README.md`.

2. **Validate before every commit that touches a plugin:**

   ```bash
   claude plugin validate --strict ./plugins/<name>
   ```

   Zero warnings, not just zero errors.

3. **Keep skills portable by default.** Stick to fields both Claude Code and Cursor read
   (`name`, `description`, `metadata`, `disable-model-invocation`, `paths`). Host-specific
   fields must degrade gracefully on the other host.

4. **A new plugin, or a registration change, updates
   `.claude-plugin/marketplace.json`.** A plugin on disk that is not listed there does not
   ship.

5. **All plugin content is English** — `SKILL.md` bodies, frontmatter, `README.md`, code
   comments.

6. **One focused commit per logical change.** Do not bundle unrelated plugins or mix CLI
   and plugin work in the same commit without a clear reason.

7. **CLI tests must pass** when `cli/` changes:

   ```bash
   cd cli && npm test
   ```

## Quick reference

| Task                  | Command                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| Validate one plugin   | `claude plugin validate --strict ./plugins/<name>`                              |
| Validate every plugin | `claude plugin validate --strict ./plugins/plugins-pack-maintainer`             |
| CLI tests             | `cd cli && npm test`                                                            |
| CLI help              | `cd cli && node src/cli.mjs --help` (published as `@pinkpuma/deck`, bin `deck`) |

## Definition of done for any change under `plugins/`

- [ ] Both manifests still match
- [ ] `claude plugin validate --strict` passes with no warnings
- [ ] `.claude-plugin/marketplace.json` reflects add/rename/remove
- [ ] HOWTO.md updated if structure or conventions changed

## Definition of done for any change under `cli/`

- [ ] `npm test` passes in `cli/`
- [ ] [cli/README.md](cli/README.md) matches the command surface
