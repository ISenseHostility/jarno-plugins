# jarno-plugins

Claude Code mods (function-hook plugins), published as one marketplace.

| Plugin | What it does |
| --- | --- |
| `input-notify` | A desktop notification (Windows tray balloon, else the terminal's own notification) when Claude needs your input: a question, a permission prompt, or the end of a turn that ran 20 s or more. In an IntelliJ terminal the title is `Claude - <project>`. |
| `stats-board` | A docked stats pane: session length and busy time, context window used, plan usage limits (5-hour and weekly) and tokens per agent split into input, cached and output. `/stats-board` opens it. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install input-notify --marketplace ISenseHostility/jarno-plugins
/plugin install stats-board --marketplace ISenseHostility/jarno-plugins
```

From a shell:

```
claude plugin install input-notify --marketplace ISenseHostility/jarno-plugins
claude plugin install stats-board --marketplace ISenseHostility/jarno-plugins
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ISenseHostility/jarno-plugins`, then Add plugin.

## Versions

Each plugin's version is in its `.claude-plugin/plugin.json`, bumped one major step per release (`1.0.0`, `2.0.0`, ...), and each release is a git tag `<plugin>--v<version>` (`input-notify--v1.0.0`).

To release a plugin:

1. Raise `version` in its `plugin.json` to the next major (`2.0.0`).
2. Commit, then run `claude plugin tag <plugin folder>`.
3. Push with the tags: `git push --follow-tags`.

`export.ps1` zips each plugin as `exports/<plugin>-v<major>.zip` (`powershell -File export.ps1`, or name the plugins to export).
