---
name: plugin-release
description: >-
  Prepare a release for one marketplace plugin (bump version, update changelog,
  validate, optional tag). Use when releasing or versioning a plugin under plugins/.
disable-model-invocation: true
metadata:
  plugin: plugins-pack-maintainer
---

# Plugin release

Conventions: [../../CONVENTIONS.md](../../CONVENTIONS.md).

One job: prepare release artifacts for a single plugin in a marketplace repository.
This skill does not install plugins into other projects, sync lockfiles, or apply
upgrades downstream.

## Steps

1. **Identify the plugin** — from the working directory, `plugins/<name>/`, or an
   explicit user argument. Confirm the layout has `.claude-plugin/plugin.json`,
   `.cursor-plugin/plugin.json`, and a `skills/` directory. Stop and say so if it does
   not look like a marketplace plugin.

2. **Inventory changes** since the last annotated tag matching `<name>-v*` (or since
   the last dated section in that plugin’s `CHANGELOG.md` if there is no such tag). Use
   `git log` scoped to `plugins/<name>/`. Summarize what landed for the user.

3. **Propose a semver bump** from that change set (patch / minor / major per
   `CONVENTIONS.md`). Ask once if ambiguous — especially before a major bump. Do not
   write files until the bump is agreed when there is doubt.

4. **Update the changelog** at `plugins/<name>/CHANGELOG.md`:
   - Create the file in Keep a Changelog format with an empty `## [Unreleased]` if it
     does not exist.
   - Move pending notes into a new `## [<version>] - <YYYY-MM-DD>` section (or fill
     Unreleased from the inventory first, then cut the release section).
   - Leave a fresh empty `## [Unreleased]` above the new version section.
   - Record any breaking change under a clear `BREAKING CHANGE` heading or bullet.

5. **Bump `version`** in both manifests to the agreed value. They must stay identical.

6. **If breaking:** draft `plugins/<name>/MIGRATION-<version>.md` with concrete,
   ordered upgrade steps for downstream users. Ask before writing the file.

7. **Validate:**
   ```bash
   claude plugin validate --strict ./plugins/<name>
   ```
   Fix or report failures. Do not treat the release as ready while validation warns or
   errors.

8. **Show the plan** — list files touched and the proposed annotated tag
   (`<plugin-name>-v<semver>`). Do **not** commit, tag, or push unless the user asks.
   When they do, prefer the `git-workflow` plugin (if available) for commit messages
   rather than inventing a parallel style.

## Report, in this order

1. Agreed version and whether the bump is patch, minor, or major.
2. Changelog summary for this release (and whether a migration note was written).
3. Validation result.
4. The single next useful step — usually commit, then tag, then push when asked.
