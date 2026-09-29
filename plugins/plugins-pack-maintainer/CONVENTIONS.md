# Marketplace plugin release conventions

Shared by every skill in this plugin. Read this once; each `SKILL.md` links back here
instead of repeating it.

These rules apply to any marketplace repository that ships plugins under `plugins/<name>/`
with dual Claude Code and Cursor manifests.

## Version source of truth

Both `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` carry a `version`
field. Always bump them **together** to the same value. Neither file is authoritative
alone — a mismatch is a release defect.

## Semver

Use [Semantic Versioning](https://semver.org/) for plugin versions:

- **patch** — fix, docs-only, or non-breaking skill tweak
- **minor** — new skill, agent, or additive behavior
- **major** — breaking change for installers or downstream consumers

When the change set is ambiguous (especially for a major bump), ask once before writing
anything.

## Changelog

[Keep a Changelog](https://keepachangelog.com/) format. Each plugin owns its own file at
`plugins/<name>/CHANGELOG.md`.

`CHANGELOG.md` always has an `## [Unreleased]` section that is actually used — entries
land there as they ship, and a release cuts a new dated version heading from it rather
than being written from scratch at release time:

```markdown
## [Unreleased]

## [<version>] - YYYY-MM-DD

### Added
### Changed
### Fixed
### Removed
```

Mark breaking changes under a clear `BREAKING CHANGE` heading or bullet in that release
section.

## Git tags

Annotated tags only, and only when the user asks to create one:

```text
<plugin-name>-v<semver>
```

Example: `example-plugin-v0.2.0`. Do not push tags unless asked.

## Migration notes

When a release is breaking and downstream users must change files or structure, write an
optional `MIGRATION-<semver>.md` next to that plugin’s `CHANGELOG.md`. Keep steps
concrete and ordered. Ask before creating the file.

This plugin authors release artifacts in the marketplace repository only — it never
mutates a downstream project to apply an upgrade.

## Validation

Before a release is considered ready:

```bash
claude plugin validate --strict ./plugins/<name>
```

Zero warnings, not just zero errors.

## Commits and tagging

Prefer the `git-workflow` plugin when it is available for commit messages and related
git conventions. Do not invent a parallel commit style here. Never commit, tag, or push
as part of preparing a release unless the user asks.
