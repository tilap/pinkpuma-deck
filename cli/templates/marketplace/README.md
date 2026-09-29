# {{NAME}}

A marketplace of [Claude Code](https://code.claude.com) and [Cursor](https://cursor.com)
plugins by {{OWNER}}.

Every plugin ships as a single source shared by both tools — see
[HOWTO.md](HOWTO.md) for layout and how to add plugins.

## Plugins

| Plugin | Purpose |
| ------ | ------- |

_(Add a row here when you register a plugin in `.claude-plugin/marketplace.json`.)_

## Install

### Claude Code

Register this repository as a marketplace, then enable the plugins you want:

```bash
claude plugin marketplace add <owner>/{{NAME}}
claude plugin install <plugin-name>@{{NAME}}
```

Use `--scope project` and commit `.claude/settings.json` when a project should pin the
same plugins for every collaborator.

### Cursor

Each plugin ships a `.cursor-plugin/plugin.json` beside its Claude Code manifest. Add a
plugin from Cursor's plugin manager by pointing it at `plugins/<name>/`.

## Contributing

See [HOWTO.md](HOWTO.md) and [AGENTS.md](AGENTS.md).
