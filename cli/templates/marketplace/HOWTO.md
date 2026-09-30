# HOWTO

How this marketplace is organized and how to add or change a plugin.

## Repository structure

One repository, one marketplace, several plugins:

```
.
├── .claude-plugin/
│   └── marketplace.json          # lists every plugin, by path
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/plugin.json   # Claude Code manifest
│       ├── .cursor-plugin/plugin.json   # Cursor manifest — same metadata
│       ├── skills/
│       │   └── <skill-name>/
│       │       ├── SKILL.md
│       │       └── DEFAULT_USAGE.md     # optional — for consumer AGENTS.md via deck
│       ├── agents/                      # only when the plugin ships subagents
│       │   └── <agent-name>.md
│       └── README.md
├── AGENTS.md
├── HOWTO.md
└── README.md
```

Both manifests under a plugin point at the same `skills/` (and `agents/`) directory.

## Two levels: marketplace repo vs plugin

| Level                              | What it is                       | Versioned how                                                                                |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| Marketplace repository (this repo) | Git container that lists plugins | Ordinary commits and pushes — no product version of the whole repo                           |
| One plugin under `plugins/<name>/` | What users install               | `version` in both manifests + that plugin’s `CHANGELOG.md` + optional tag `<name>-v<semver>` |

You publish **plugins**, not a single version of the marketplace.

## Create a plugin

1. Branch: `feat/add-<name>-plugin`.
2. From the marketplace root:

   ```bash
   npx @pinkpuma/deck scaffold plugin <name> --description "Short purpose."
   ```

   This writes `plugins/<name>/` (dual manifests, starter skill + `DEFAULT_USAGE.md`,
   README), registers `.claude-plugin/marketplace.json`, and appends the root README
   Plugins table when present. Keep `name`, `version`, `description`, and `author`
   identical in both manifests afterward.
3. Replace the stub `SKILL.md` body with real steps; tighten `DEFAULT_USAGE.md` so it
   reads clearly in a consumer project's AGENTS.md.
4. `claude plugin validate --strict ./plugins/<name>` — zero warnings.
5. Install from the local marketplace and exercise the skills.
6. Commit. Cut the first release: bump both manifests, add `CHANGELOG.md`, validate again.
7. Push. Create the annotated tag `<name>-v<semver>` when consumers should pin that release.

## Change a plugin

1. Edit under `plugins/<name>/`.
2. `claude plugin validate --strict ./plugins/<name>`.
3. Commit. When shipping a consumable release: bump semver in both manifests, update
   changelog, validate, push, optional tag.

## Remove a plugin

1. Remove the entry from `.claude-plugin/marketplace.json` and the README table.
2. Delete `plugins/<name>/`.
3. Commit and push.

## Write a skill

Create `plugins/<plugin>/skills/<skill>/SKILL.md` with YAML frontmatter (`name`,
`description`) and an English body. Keep frontmatter portable across Claude Code and
Cursor.

Optional: add `DEFAULT_USAGE.md` next to `SKILL.md`. That file is **not** part of the
skill body consumers load with the skill. `@pinkpuma/deck` reads it on sync and injects
it into the **consumer project's** `AGENTS.md` as routing guidance. Write it so it makes
sense in a global project context — see [AGENTS.md](AGENTS.md).

## Develop against a local clone

```bash
cd /path/to/this-repo
claude plugin marketplace add ./
claude plugin install <plugin-name>@{{NAME}}
```

Cursor: point the plugin manager at `plugins/<name>/` inside the clone.
