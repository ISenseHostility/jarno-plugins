<p align="center">
  <img src="assets/logo.svg" width="112" alt="jarno-plugins logo">
</p>

<h1 align="center">jarno-plugins</h1>

<p align="center">Small Claude Code plugins that make long sessions easier to live with.</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/plugins"><img src="https://img.shields.io/badge/Claude_Code-plugin_marketplace-D97757" alt="Claude Code plugin marketplace"></a>
  <a href="input-notify"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Finput-notify%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=input-notify&color=D97757" alt="input-notify version"></a>
  <a href="stats-board"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Fstats-board%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=stats-board&color=D97757" alt="stats-board version"></a>
  <a href="rubber-duck"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Frubber-duck%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=rubber-duck&color=D97757" alt="rubber-duck version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ISenseHostility/jarno-plugins?color=blue" alt="MIT license"></a>
  <a href="https://github.com/ISenseHostility/jarno-plugins/commits/main"><img src="https://img.shields.io/github/last-commit/ISenseHostility/jarno-plugins" alt="Last commit"></a>
</p>

---

## Plugins

### 🔔 input-notify

A desktop notification whenever Claude is waiting on you, so you can look away while it works.

<img src="assets/notification.svg" width="380" alt="A Windows notification titled Claude - lyricle with Claude's question">

- **When:** Claude asks a question, needs a permission or other input, or finishes a turn that ran 20 seconds or more.
- **Where:** a Windows tray notification; on other systems, the terminal's own notification.
- **Titles:** `Claude - <project>` in an IntelliJ terminal (the `.idea` project's name), otherwise `Claude Code needs you`.
- Two triggers within 5 seconds show once.

### 📊 stats-board

A pane docked beside the conversation with the numbers you'd otherwise have to ask for.

<img src="assets/stats-board.svg" width="460" alt="The stats board pane with sample data">

- **Session:** how long it has been open, and how much of that Claude spent working (time waiting on you is left out).
- **Context window:** how full it is.
- **Plan usage limits:** the 5-hour and weekly windows, with when each resets. Shown on a Claude subscription.
- **Tokens per agent:** input, cached and output, for the main conversation and each subagent.
- Opens by itself in a fullscreen terminal from 144 columns; `/stats-board` opens it at any width. `/clear` starts the counts over.

> Claude Code's own git changes panel sits in the same spot. Close it with `/diff` (it stays closed) to give the board the room.

### 🦆 rubber-duck

A design sparring partner, as a subagent. Talk a feature or an architecture decision through with it before you build; it asks, you think.

- Reads the relevant code first, so its questions are about your project.
- One or two questions at a time, on what could go wrong: edge cases, failure modes, scaling, data ownership, state, concurrency, changing requirements.
- Follows up on vague answers and points out where what you say and what the code does disagree.
- Never writes or suggests code, and answers a request for a solution with a question. It can only read (`Read`, `Grep`, `Glob`).
- When the design holds up, it sums up the decisions and the open risks, then stops.

Ask for it by name: *"Use the rubber-duck agent to poke holes in my plan for …"*, or pick it in `/agents`.

## Install

In a Claude Code terminal session:

```text
/plugin install input-notify --marketplace ISenseHostility/jarno-plugins
/plugin install stats-board --marketplace ISenseHostility/jarno-plugins
/plugin install rubber-duck --marketplace ISenseHostility/jarno-plugins
```

Or from a shell:

```sh
claude plugin install input-notify --marketplace ISenseHostility/jarno-plugins
claude plugin install stats-board --marketplace ISenseHostility/jarno-plugins
claude plugin install rubber-duck --marketplace ISenseHostility/jarno-plugins
```

In the desktop app: **+** next to the prompt box → **Plugins** → **Add marketplace** `ISenseHostility/jarno-plugins` → **Add plugin**.

## Development

The hooks plugins (`hooks/register.ts[x]`) have tests in `tests/`; `rubber-duck` is one agent file (`agents/rubber-duck.md`).

```sh
claude plugin validate <plugin>   # what the engine will load and refuse
claude plugin test <plugin>       # run the tests
```

### Releases

Versions step one major at a time (`1.0.0`, `2.0.0`, …) and each release is a tag `<plugin>--v<version>`.

1. Raise `version` in `<plugin>/.claude-plugin/plugin.json`.
2. Commit, then `claude plugin tag <plugin>`.
3. `git push --follow-tags`.

`powershell -File export.ps1` zips each plugin, license included, to `exports/<plugin>-v<major>.zip`.

## License

[MIT](LICENSE) © 2026 ISenseHostility
