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

4. **Never run `npm publish` by hand.** Releases go through GitHub Actions only
   (see [Release procedure](#release-procedure)).

## Quick reference

| Task      | Command                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| CLI tests | `cd cli && npm test`                                                            |
| CLI help  | `cd cli && node src/cli.mjs --help` (published as `@pinkpuma/deck`, bin `deck`) |

## Definition of done for any change under `cli/`

- [ ] `npm test` passes in `cli/`
- [ ] [cli/README.md](cli/README.md) matches the command surface

## Release procedure

Publishing `@pinkpuma/deck` is done by CI, never from a laptop or an agent session.
[`publish-deck.yml`](.github/workflows/publish-deck.yml) runs when a `deck-v*` tag is
pushed and publishes to npm through Trusted Publishing (OIDC, no token).

The workflow refuses to publish unless:

- the tagged commit is an ancestor of `origin/main`;
- the tag `deck-vX.Y.Z` matches `version` in `cli/package.json`;
- `npm test` passes in `cli/`.

Steps, in order:

1. Land the feature or fix commits on `main` (one focused commit per change).
2. Bump `version` in `cli/package.json` in its own commit named `Release deck X.Y.Z.`
   (semver: new feature → minor, fix → patch, breaking change → major). No lockfile to update.
3. Push `main`.
4. Tag that commit and push the tag:

   ```bash
   git tag -a deck-vX.Y.Z -m "deck X.Y.Z"
   git push origin deck-vX.Y.Z
   ```

5. Check the run in GitHub Actions and the result with `npm view @pinkpuma/deck version`.

Agent rules:

- Do not run `npm publish`, `npm login`, or create an npm token. If CI fails, fix the cause and
  release the next version. Do not publish around it.
- Do not push `main` or a tag unless the user asked for it. A tag is what triggers the publish,
  so pushing one is the user's call.
- Never move or delete a pushed `deck-v*` tag; npm versions cannot be reused.
