# AGENTS.md

Instructions for AI coding agents working in this repository. For a human-facing
overview, see [README.md](README.md). Read this file before making any change under `cli/`.

## What this repo is

The sync CLI under `cli/`. It vendors skills, agents, and MCP from plugin marketplaces
into consumer projects.

## Hard rules

1. **All content is English** — docs, `README.md`, code comments.

2. **One focused commit per logical change.**

3. **CLI tests must pass** when `cli/` changes:

   ```bash
   cd cli && npm test
   ```

## Quick reference

| Task      | Command                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| CLI tests | `cd cli && npm test`                                                            |
| CLI help  | `cd cli && node src/cli.mjs --help` (published as `@pinkpuma/deck`, bin `deck`) |

## Definition of done for any change under `cli/`

- [ ] `npm test` passes in `cli/`
- [ ] [cli/README.md](cli/README.md) matches the command surface
