# AGENTS.md

Instructions for AI coding agents working in this repository. For a human-facing
overview, see [README.md](README.md); for create / change / remove / release steps, see
[HOWTO.md](HOWTO.md). Read this file before changing anything under `plugins/`.

## What this repo is

A marketplace of Claude Code / Cursor plugins named **{{NAME}}** (owner: {{OWNER}}).
Each plugin lives in `plugins/<name>/` and is listed in `.claude-plugin/marketplace.json`.
Every plugin follows the same layout — see [HOWTO.md](HOWTO.md) before creating or
restructuring one.

## Hard rules

1. **Uniform plugin layout.** Every plugin has `.claude-plugin/plugin.json` and
   `.cursor-plugin/plugin.json` with matching `name`, `version`, `description`, and
   `author`, a `skills/` directory, and a `README.md`. Don't invent a one-off structure
   without updating HOWTO.md.

2. **Validate before every commit that touches a plugin:**

   ```bash
   claude plugin validate --strict ./plugins/<name>
   ```

   Zero warnings, not just zero errors.

3. **A new plugin, or a registration change, updates
   `.claude-plugin/marketplace.json`.** A plugin on disk that isn't listed there does not
   ship. Also add a row to the root README Plugins table.

4. **All plugin content is English** — `SKILL.md` and agent bodies, frontmatter
   descriptions, `README.md`, `DEFAULT_USAGE.md`, code comments.

5. **One focused commit per logical change.** A new plugin, or a change confined to one
   plugin, gets its own commit.

## Adding a skill

1. Create `plugins/<plugin>/skills/<skill>/SKILL.md` with portable frontmatter and body.
2. Optionally add `DEFAULT_USAGE.md` beside `SKILL.md` (see below).
3. Mention the skill in the plugin's `README.md`.
4. Validate the plugin.

## Writing DEFAULT_USAGE.md

`DEFAULT_USAGE.md` is optional. When present, `@pinkpuma/deck` does **not** copy it into
the installed skill. On sync it injects the body into a marked `## Skills` block in the
**consumer project's** `AGENTS.md` — a file agents read for the whole project, not for
one skill in isolation.

Write each file as **one short bullet** that still works in that global context:

- Name the **domain** explicitly (e.g. git, documentation, npm) — never rely on the
  skill directory name alone.
- State a clear **trigger** (when the agent should use the skill).
- Use the condition form: If the `<skill-name>` skill is available, …
- Keep it to one bullet; no multi-paragraph prose.

Example:

```markdown
- **Git commits.** If the `commit` skill is available, use it when drafting commit
  messages from the current diff.
```

Bad (too vague once pasted into a consumer AGENTS.md):

```markdown
- If the skill is available, use it when relevant.
```

## Definition of done for any change under `plugins/`

- [ ] Dual manifests still match (`name`, `version`, `description`, `author`)
- [ ] `claude plugin validate --strict` passes with no warnings for every plugin touched
- [ ] `.claude-plugin/marketplace.json` and root README reflect any add/rename/remove
- [ ] HOWTO.md updated if the change alters repo structure or conventions
- [ ] Any new `DEFAULT_USAGE.md` is explicit enough for a global consumer AGENTS.md
