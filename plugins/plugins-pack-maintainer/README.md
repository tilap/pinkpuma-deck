# plugins-pack-maintainer

Release workflow for marketplace plugins — version bump, per-plugin changelog,
validation, and optional tag or migration note. Applies to any marketplace repository
that ships plugins under `plugins/<name>/`. See [`CONVENTIONS.md`](CONVENTIONS.md) for
the shared rules.

For when to run this (local install, create, change, remove, publish) and how to use it
against other marketplace repositories, see the root [HOWTO.md](../../HOWTO.md).

## Skills

| Skill                                            | Use when                                          |
| ------------------------------------------------ | ------------------------------------------------- |
| [plugin-release](skills/plugin-release/SKILL.md) | Releasing or versioning a plugin under `plugins/` |
