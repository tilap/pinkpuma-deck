# Toolbelt scenario

End-to-end run of `@pinkpuma/deck` against an empty project and a local checkout of `tilap/pinkpuma-toolbelt`.

`ai-plugin.json` is the request (`{ id, source, plugin, ref }`). `ai-plugin.local.json` is a gitignored link to a working tree. `ai-plugin.lock.json` is the committed lock (format 3): resolved commit, integrity, components, snippets. `.ai/installed/` holds the normalized plugins and the local state.

A skill that links to another file in its plugin (conventions, script, template) must resolve that file inside a directory owned by that plugin. A skill or MCP server that is already in the project, and that the plugin does not ship, stays. A file the plugin ships over one deck did not write is refused unless `--force`; with it, the file is replaced, then deleted on `remove`. `DEFAULT_USAGE.md` is not copied into the skill directory: its text feeds a marked block in `AGENTS.md` when that file already exists.

The runner forces copy mode for Claude (`DECK_CLAUDE_BIN=/nonexistent/claude`) so the run neither depends on nor changes the machine's `claude` CLI, and keeps deck's cache inside the sandbox (`DECK_CACHE=<target>/.deck-cache`).

This scenario is not part of `npm test` and does not run in the publish workflow.

## Prerequisites

- Node.js >= 22.14.
- This repo, passed with `--deck` (`cli/src/cli.mjs`). The runner does not use the npm package. The version is read from `cli/package.json`.
- `git` able to read `origin` of the toolbelt checkout (`git ls-remote origin HEAD`).
- A checkout of `tilap/pinkpuma-toolbelt`, passed with `--toolbelt`. The runner sets `DECK_LOCAL_tilap__pinkpuma-toolbelt` to it. A `ref` equal to the current branch or `HEAD` installs the working tree. Any other ref, including the local `HEAD` commit, is checked out from that clone. `deck link` uses the checkout path, including uncommitted files.
- An empty target directory. Default: `sandbox/` next to this file (created if missing). If it already has files, the runner stops and writes nothing there.

## Run

From anywhere:

```bash
rm -rf cli/integration/sandbox
node cli/integration/run.mjs \
  --deck cli/src/cli.mjs \
  --toolbelt /path/to/pinkpuma-toolbelt
```

`rm -rf` is from the `pinkpuma-deck` root. Pass `--target /path/to/empty-dir` to use another empty directory.

The exit code is 1 when a prerequisite or a check fails. The report is written whenever the runner finishes the prerequisites. A non-empty target skips every step.

`sandbox/` and `results/` are gitignored. The sandbox stays after the run. Delete it before running again.

Pull requests that change `cli/` run this scenario in GitHub Actions (`.github/workflows/integration.yml`). The job checks out the private toolbelt repo with the Actions secret `TOOLBELT_READ_TOKEN` (contents: read on `tilap/pinkpuma-toolbelt`). The report is uploaded as the `integration-results` artifact.

## Scenario

Each action runs in order. The checks are in `run.mjs`.

1. **`status-empty`** — `deck status` in an empty folder exits 1 (`No ai-plugin.json. Run deck add <source>.`) and writes nothing.
2. **`unknown-command`** — `deck nope` is rejected.
3. **`add-invalid-spec`** — `deck add not-a-spec` is rejected (`Cannot read`), nothing written.
4. **`seed-local-files`** — skill `my-local`, `code-reviewer` agents marked `USER OWNED`, MCP servers `user-notes` and `user-cursor`, `.gitignore` (`node_modules/`), `AGENTS.md`.
4b. **`init`** — `deck init` creates `ai-plugin.json` and `CLAUDE.md` (`@AGENTS.md`), keeps the user's `AGENTS.md` and `.gitignore`, and appends deck's managed block. A second `init` changes nothing.
5. **`add-git-workflow`** — `deck add` creates `ai-plugin.json`. Skills copied, `CONVENTIONS.md` links resolve, `DEFAULT_USAGE.md` is absent from the skill directory, Skills block in `AGENTS.md`. The request has `id`, `source: github:tilap/pinkpuma-toolbelt`, `plugin`, no `ref`. Lock format 3 with a commit, an integrity, the four skills, and the four snippets. `.gitignore` gains `.ai/installed/` and the local file, not the lock.
6. **`add-dev-agents-refused`** — the user's `code-reviewer` agents block the install (`was not written by deck`). Nothing is written.
7. **`add-dev-agents`** — with `--force`, the plugin's `code-reviewer` replaces the user's.
8. **`list-installed`** — `deck status` lists `git-workflow` and `dev-agents`, both locked, not `handoff`, no link.
9. **`add-handoff-no-install`** — `--no-install`: `handoff` is only in the request.
10. **`install-after-no-install`** — `handoff` and `resume` are copied, the lock has a commit.
11. **`add-project-docs`** — skill copied, `docs_index.py` link resolves, snippet in `AGENTS.md`.
12. **`add-npm-publish`** — skills copied, `CONVENTIONS.md` and `publish-npm.yml` are distinct from git-workflow's.
13. **`add-spec`** — `spec-workflow` requested, `to-brief`, `to-spec`, `to-tickets` copied.
14. **`remove-spec`** — `deck remove spec-workflow`: files and the `to-tickets` snippet are removed, the `commit` snippet stays.
15. **`readd-git-workflow-sha`** — one entry, `ref` is the toolbelt checkout `HEAD`, and the lock pins that commit.
16. **`install-idempotent`** — the file count under `.claude` and `.cursor` does not change.
17. **`agents-md-off`** — `"agentsMd": false` in `ai-plugin.json`, then `deck install`: the lock mirrors it and the Skills block is removed.
18. **`agents-md-on`** — the setting removed: the block comes back.
19. **`remove-dev-agents`** — plugin files deleted, including `code-reviewer`. `my-local` stays.
20. **`remove-handoff-keep-files`** — dropped from the request and the lock, copies left on disk.
21. **`install-prunes-edited-request`** — `project-docs` removed by hand from `ai-plugin.json`, then `install` deletes its files. The `handoff` copies stay.
22. **`remove-unknown`** — `No plugin with id`, request unchanged.
23. **`link-nextjs`** — installs from the checkout without editing `ai-plugin.json`; `status` shows `[link]`.
24. **`link-override-git-workflow`** — the link replaces the committed request locally; `status` shows `overrides github:…#<sha>`.
25. **`unlink-restores-committed`** — the committed request is installed again. The nextjs link stays.
26. **`link-spec-no-install`** — the link is recorded, nothing is copied.
27. **`install-linked-spec`** — the link is materialized, including its snippet, and stays out of the lock.
28. **`unlink-spec-keep-files`** — the link goes away, the files stay.
29. **`install-prunes-unlinked-spec`** — the next install deletes those files.
30. **`unlink-nextjs`** — link-only plugin: files, local file, and snippet removed.
31. **`link-mcp`** — MCP keys are `deck__notes__notes` and the user's servers stay.
32. **`install-dirty-mcp`** — an uncommitted skill edit is picked up.
33. **`unlink-mcp`** — skill and namespaced key removed, user servers kept.
34. **`link-invalid`** — `deck link nosep` is rejected (`is not a directory`).
35. **`link-no-origin`** — a folder of skills with no `origin` and no commit links, then unlinks.
36. **`unlink-unknown`** — `No ai-plugin.local.json`.
37. **`add-unknown-plugin`** — rejected with the list of available plugins; nothing written.
38. **`status-healthy`** — `deck status` exits 0.
39. **`frozen-reproduces`** — the request and lock copied to an empty folder; `deck install --frozen` rewrites a byte-identical lock.
40. **`profile-new-and-lock`** — `deck profile new builder`, then `deck add … --profile builder`: locked in `.ai/profiles/builder/`, not installed.
41. **`profile-use`** — `deck profile use builder`: the profile's skill arrives, the base is up to date, `CLAUDE.md` imports the prompt, the Cursor rule exists.
42. **`profile-off`** — back to the base; link, rule, and import removed.
43. **`materialize-profile`** — `deck materialize --profile builder --out … --json` builds the base and the builder's plugin into the folder and leaves the project untouched.
44. **`old-commands-gone`** — `sync`, `list`, `doctor`, `scaffold` are unknown commands; `deck status --frozen` is refused.

## Reports

Each run writes a timestamped pair and refreshes `latest`:

- `results/<runId>.json` and `results/latest.json` — machine-readable (`resultFormat: 1`)
- `results/<runId>.md` and `results/latest.md` — the same content, readable

The JSON holds prerequisites, each step (`commands` with stdout, stderr, exit code), each check (`expected`, `actual`, `ok`), the summary (`summary.failed` lists `step.check` ids), and `endState` (request, local file, lock, and the target file list).
