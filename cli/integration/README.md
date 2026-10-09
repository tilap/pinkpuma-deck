# Toolbelt scenario

End-to-end run of `@pinkpuma/deck` against an empty project and a local checkout of `tilap/pinkpuma-toolbelt`.

`ai-plugin.json` is the request. `ai-plugin.local.json` is a gitignored link to a checkout. `ai-plugin.lock.json` is the resolved install (format 2).

A skill that links to another file in its plugin (conventions, script, template) must resolve that file inside a directory owned by that plugin. A skill or MCP server that is already in the project, and that the plugin does not ship, stays. An agent file the plugin ships is replaced, then deleted on `remove`. `DEFAULT_USAGE.md` is not copied into the skill directory: its text feeds a marked block in `AGENTS.md` when that file already exists.

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
5. **`add-invalid-spec`** — `deck add not-a-spec` is rejected (`Invalid plugin spec`).
6. **`seed-local-files`** — skill `my-local`, `code-reviewer` agents marked `USER OWNED`, MCP servers `user-notes` and `user-cursor`, `.gitignore` (`node_modules/`), `AGENTS.md`.
7. **`add-git-workflow`** — skills copied, `CONVENTIONS.md` links resolve, `DEFAULT_USAGE.md` is absent from the skill directory, Skills block in `AGENTS.md`, lock format 2, `.gitignore` gains the lock and the local file.
8. **`add-dev-agents`** — skill and agents copied. The existing `code-reviewer` agent is replaced by the plugin's file.
9. **`list-installed`** — `git-workflow` and `dev-agents`, not `handoff`, no local link.
10. **`add-handoff-no-sync`** — `handoff` is only in the request.
11. **`sync-after-no-sync`** — `handoff` and `resume` are copied.
12. **`add-project-docs`** — skill copied, `docs_index.py` link resolves, snippet in `AGENTS.md`.
13. **`add-npm-publish`** — skills copied, `CONVENTIONS.md` and `publish-npm.yml` are distinct from git-workflow's.
14. **`add-slash-spec`** — `deck add tilap/pinkpuma-toolbelt/spec-workflow` (slash form).
15. **`remove-slash-spec`** — files and the `to-tickets` snippet are removed, the `commit` snippet stays.
16. **`readd-git-workflow-sha`** — one entry, `ref` is the toolbelt checkout `HEAD`.
17. **`sync-idempotent`** — the file count under `.claude` and `.cursor` does not change.
18. **`sync-no-agents-md`** — `writeAgentsMd` becomes false, the Skills block is removed, the project heading stays.
19. **`sync-agents-md`** — the block comes back.
20. **`remove-dev-agents`** — plugin files deleted, including `code-reviewer`. `my-local` stays.
21. **`remove-handoff-keep-files`** — dropped from the request and the lock, copies left on disk.
22. **`sync-prunes-edited-request`** — `project-docs` removed by hand from `ai-plugin.json`, then `sync` deletes its files. The `handoff` copies stay (they are no longer in the lock).
23. **`remove-unknown`** — `No plugin entry`, request unchanged.
24. **`link-nextjs`** — installs from the checkout without editing `ai-plugin.json`. `list` shows `local from=`.
25. **`link-override-git-workflow`** — the link replaces the committed ref. `list` shows `overrides ref=`.
26. **`unlink-restores-committed`** — the request's SHA is installed again. The nextjs link stays.
27. **`link-spec-no-sync`** — the link is recorded, nothing is copied.
28. **`sync-linked-spec`** — the link is materialized, including its snippet.
29. **`unlink-spec-keep-files`** — the link goes away, the files and the lock entry stay.
30. **`sync-prunes-unlinked-spec`** — the next sync deletes those files, because the plugin is no longer requested.
31. **`unlink-nextjs`** — link-only plugin: files, local file, and snippet removed.
32. **`link-mcp`** — local checkout `example/mcp-kit` with a `notes` server. MCP keys are prefixed `deck__…` and the user's servers stay.
33. **`sync-dirty-mcp`** — an uncommitted skill edit is picked up by sync.
34. **`unlink-mcp`** — skill and namespaced key removed, user servers kept.
35. **`link-invalid`** — `Invalid link`.
36. **`link-no-origin`** — a checkout with no `origin` remote is rejected.
37. **`unlink-unknown`** — `No ai-plugin.local.json`.
38. **`scaffold`** — `deck scaffold sample-market --owner "Integration Tests"` writes an empty marketplace.
39. **`scaffold-invalid-name`** — name rejected.
40. **`scaffold-missing-owner`** — `--owner` is required.
41. **`scaffold-non-empty`** — a second scaffold in the same place is rejected.
42. **`add-unknown-plugin`** — the copy is rejected. The request already contains `no-such-plugin` (it is written before the copy). The lock does not.

## Reports

Each run writes a timestamped pair and refreshes `latest`:

- `results/<runId>.json` and `results/latest.json` — machine-readable (`resultFormat: 1`)
- `results/<runId>.md` and `results/latest.md` — the same content, readable

The JSON holds prerequisites, each step (`commands` with stdout, stderr, exit code), each check (`expected`, `actual`, `ok`), the summary (`summary.failed` lists `step.check` ids), and `endState` (request, local file, lock, and the target file list).
