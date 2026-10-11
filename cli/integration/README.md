# Toolbelt scenario

End-to-end run of `@pinkpuma/deck` against an empty project and a local checkout of `tilap/pinkpuma-toolbelt`.

`ai-plugin.json` is the request (`{ id, source, plugin, ref }`). `ai-plugin.local.json` is a gitignored link to a working tree. `ai-plugin.lock.json` is the committed lock (format 3): resolved commit, integrity, components, snippets. `.deck/` holds the normalized plugins and the local state.

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

1. **`init`** — `deck init` writes an empty `ai-plugin.json`. No lock, no `.gitignore`.
2. **`init-again`** — the request stays empty.
3. **`list-empty`** — output contains `(no plugins)`.
4. **`unknown-command`** — `deck nope` is rejected, request unchanged.
5. **`add-invalid-spec`** — `deck add not-a-spec` is rejected (`Cannot read`).
6. **`seed-local-files`** — skill `my-local`, `code-reviewer` agents marked `USER OWNED`, MCP servers `user-notes` and `user-cursor`, `.gitignore` (`node_modules/`), `AGENTS.md`.
7. **`add-git-workflow`** — skills copied, `CONVENTIONS.md` links resolve, `DEFAULT_USAGE.md` is absent from the skill directory, Skills block in `AGENTS.md`. The request has `id`, `source: github:tilap/pinkpuma-toolbelt`, `plugin`, no `ref`. Lock format 3 with a commit, an integrity, the four skills, and the four snippets. `.gitignore` gains `.deck/` and the local file, not the lock.
8. **`add-dev-agents-refused`** — the user's `code-reviewer` agents block the install (`was not written by deck`). Nothing is written: request unchanged, `USER OWNED` kept.
9. **`add-dev-agents`** — with `--force`, skill and agents copied. The existing `code-reviewer` agent is replaced by the plugin's file.
10. **`list-installed`** — `git-workflow` and `dev-agents`, both locked, not `handoff`, no link.
11. **`add-handoff-no-sync`** — `handoff` is only in the request.
12. **`sync-after-no-sync`** — `handoff` and `resume` are copied, the lock has a commit.
13. **`add-project-docs`** — skill copied, `docs_index.py` link resolves, snippet in `AGENTS.md`.
14. **`add-npm-publish`** — skills copied, `CONVENTIONS.md` and `publish-npm.yml` are distinct from git-workflow's.
15. **`add-slash-spec`** — `deck add tilap/pinkpuma-toolbelt/spec-workflow` (slash form) writes the same request as `@spec-workflow`.
16. **`remove-slash-spec`** — files and the `to-tickets` snippet are removed, the `commit` snippet stays.
17. **`readd-git-workflow-sha`** — one entry, `ref` is the toolbelt checkout `HEAD`, and the lock pins that commit.
18. **`sync-idempotent`** — the file count under `.claude` and `.cursor` does not change. (A working tree is copied without what `.gitignore` excludes, so a later install from the locked commit matches.)
19. **`sync-no-agents-md`** — `writeAgentsMd` becomes false, the Skills block is removed, the project heading stays.
20. **`sync-agents-md`** — the block comes back.
21. **`remove-dev-agents`** — plugin files deleted, including `code-reviewer`. `my-local` stays.
22. **`remove-handoff-keep-files`** — dropped from the request and the lock, copies left on disk.
23. **`sync-prunes-edited-request`** — `project-docs` removed by hand from `ai-plugin.json`, then `sync` deletes its files. The `handoff` copies stay (deck no longer tracks them).
24. **`remove-unknown`** — `No plugin with id`, request unchanged.
25. **`link-nextjs`** — installs from the checkout without editing `ai-plugin.json`. The local file has `source: local:<checkout>`; `list` shows `(linked)`.
26. **`link-override-git-workflow`** — the link replaces the committed request locally. The lock keeps the committed pin; `list` shows `overrides github:…#<sha>`.
27. **`unlink-restores-committed`** — the committed request is installed again. The nextjs link stays.
28. **`link-spec-no-sync`** — the link is recorded, nothing is copied.
29. **`sync-linked-spec`** — the link is materialized, including its snippet, and stays out of the lock.
30. **`unlink-spec-keep-files`** — the link goes away, the files stay.
31. **`sync-prunes-unlinked-spec`** — the next sync deletes those files, because the plugin is no longer requested.
32. **`unlink-nextjs`** — link-only plugin: files, local file, and snippet removed.
33. **`link-mcp`** — local checkout `example/mcp-kit` with a `notes` server. MCP keys are `deck__notes__notes` and the user's servers stay.
34. **`sync-dirty-mcp`** — an uncommitted skill edit is picked up by sync.
35. **`unlink-mcp`** — skill and namespaced key removed, user servers kept.
36. **`link-invalid`** — `deck link nosep` is rejected (`is not a directory`), no local file.
37. **`link-no-origin`** — a folder of skills with no `origin` and no commit links (id from the folder name), then unlinks cleanly.
38. **`unlink-unknown`** — `No ai-plugin.local.json`.
39. **`scaffold`** — `deck scaffold sample-market --owner "Integration Tests"` writes an empty marketplace.
40. **`scaffold-invalid-name`** — name rejected.
41. **`scaffold-missing-owner`** — `--owner` is required.
42. **`scaffold-non-empty`** — a second scaffold in the same place is rejected.
43. **`add-unknown-plugin`** — rejected with the list of available plugins. Nothing is written: not the request, not the lock, not `.deck/plugins/no-such-plugin`.
44. **`doctor-healthy`** — `deck doctor` exits 0.
45. **`frozen-reproduces`** — `ai-plugin.json` and `ai-plugin.lock.json` copied to an empty folder; `deck install --frozen` exits 0, rewrites a byte-identical lock, and installs the same skills.

## Reports

Each run writes a timestamped pair and refreshes `latest`:

- `results/<runId>.json` and `results/latest.json` — machine-readable (`resultFormat: 1`)
- `results/<runId>.md` and `results/latest.md` — the same content, readable

The JSON holds prerequisites, each step (`commands` with stdout, stderr, exit code), each check (`expected`, `actual`, `ok`), the summary (`summary.failed` lists `step.check` ids), and `endState` (request, local file, lock, and the target file list).
