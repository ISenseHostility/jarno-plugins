<p align="center">
  <img src="assets/logo.svg" width="112" alt="jarno-plugins logo">
</p>

<h1 align="center">jarno-plugins</h1>

<p align="center">Claude Code plugins: two mods for long sessions, and agents for design, playtesting, game balance, translations and devlogs.</p>

<p align="center">
  <a href="https://code.claude.com/docs/en/plugins"><img src="https://img.shields.io/badge/Claude_Code-plugin_marketplace-D97757" alt="Claude Code plugin marketplace"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ISenseHostility/jarno-plugins?color=blue" alt="MIT license"></a>
  <a href="https://github.com/ISenseHostility/jarno-plugins/commits/main"><img src="https://img.shields.io/github/last-commit/ISenseHostility/jarno-plugins" alt="Last commit"></a>
</p>

---

## Plugins

| | Plugin | Kind | Version | What it does |
| --- | --- | --- | --- | --- |
| 🔔 | [input-notify](#-input-notify) | mod | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Finput-notify%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="input-notify version"> | Desktop notification when Claude needs you |
| 📊 | [stats-board](#-stats-board) | mod | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Fstats-board%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="stats-board version"> | Docked pane: session, context, plan limits, tokens |
| 🦆 | [rubber-duck](#-rubber-duck) | agent | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Frubber-duck%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="rubber-duck version"> | Questions your design before you build it |
| 🎮 | [playtest-bot](#-playtest-bot) | agent | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Fplaytest-bot%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="playtest-bot version"> | Plays your browser game and reports the bugs |
| ⚖️ | [balance-sim](#️-balance-sim) | agent | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Fbalance-sim%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="balance-sim version"> | Simulates matches to find over- and underpowered units |
| 🌐 | [i18n-filler](#-i18n-filler) | agent | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Fi18n-filler%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="i18n-filler version"> | Fills in missing translations, flags the doubtful ones |
| 📓 | [devlog-writer](#-devlog-writer) | agent | <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FISenseHostility%2Fjarno-plugins%2Fmain%2Fdevlog-writer%2F.claude-plugin%2Fplugin.json&query=%24.version&prefix=v&label=version&color=D97757" alt="devlog-writer version"> | Writes the session up as an HTML devlog page |

**Mods** hook into Claude Code itself. **Agents** are subagents: ask for one by name (*"use the playtest-bot agent"*) or pick it in `/agents`. None of the agents fix or change what they report on.

## Mods

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

## Agents

### 🦆 rubber-duck

A design sparring partner. Talk a feature or an architecture decision through with it before you build; it asks, you think.

- Reads the relevant code first, so its questions are about your project.
- One or two questions at a time, on what could go wrong: edge cases, failure modes, scaling, data ownership, state, concurrency, changing requirements.
- Follows up on vague answers and points out where what you say and what the code does disagree.
- Never writes or suggests code, and answers a request for a solution with a question. It can only read (`Read`, `Grep`, `Glob`).
- When the design holds up, it sums up the decisions and the open risks, then stops.

> *"Use the rubber-duck agent to poke holes in my plan for …"*

### 🎮 playtest-bot

A QA playtester for browser games. Run it after gameplay or UI changes.

- Starts the game with the project's dev command and plays it through Playwright: a normal round first, then everything that breaks games (spam clicks, resizing down to phone sizes, refresh and back mid-game, odd key combos, overlapping actions, idling).
- Watches the browser console throughout and screenshots anything that looks wrong.
- Writes `playtest/report.md` (screenshots in `playtest/screenshots/`): per bug what happened, steps to reproduce, expected vs actual, console errors and a severity (crash, broken, visual, minor).
- Needs Node and Playwright in the project; it drives Playwright through scripts, not a browser tool.

### ⚖️ balance-sim

A game balance analyst. Run it after changing stats or adding units or towers.

- Finds the stat definitions, then finds or writes a headless simulation that reuses the real game logic.
- Runs at least 1,000 varied matches and tracks win rate, damage, cost efficiency and how often each unit shows up in winning setups.
- Writes `balance/report.md`: a stats table, the top 3 over- and underperformers with their numbers, dominant strategies, and stat tweaks marked as suggestions.
- Leaves the stat files alone.

### 🌐 i18n-filler

A translator for Flutter ARB and JSON locale files. Run it after adding user-facing strings.

- Finds the keys the source language (usually English) has and the other languages lack or leave empty.
- Looks up where each string is used before translating it, matches the existing tone, keeps `{placeholders}` and ICU plural and select syntax intact, and copies `@key` metadata in ARB files.
- Ends with a list of the translations it's unsure about (wordplay, slang, legal text, strings with too little context) and why.
- Never touches existing translations or the source file.

### 📓 devlog-writer

Writes up a work session so you can pick the project back up weeks later. Run it at the end of a session.

- Works out what changed, what was decided and why, and what's unfinished, from the session and git (`status`, `diff` and the `log` since the last entry).
- Writes `devlog/YYYY-MM-DD-<slug>.html`: summary, what changed, decisions (with the rejected alternatives), unfinished work and next steps, and the key files touched.
- Keeps `devlog/index.html` current, newest first.
- Each page is one self-contained HTML file in your app's own look (CSS variables, Tailwind config, Flutter `ThemeData`, brand colours), or a clean light and dark default.
- Only adds pages: older entries and project code stay untouched.
- Treats what it reads from the repo as data, not instructions; runs only read-only git commands and writes only inside `devlog/`.
- Describes changes in prose and never copies raw diffs or anything secret-looking into a page; repo text is HTML-escaped and every page blocks scripts with a Content-Security-Policy.

> A subagent doesn't see your conversation, only what Claude hands it. Ask from the main session, e.g. *"use the devlog-writer agent, and pass it what we did and decided this session"*, so the write-up covers more than git shows. Without such a summary it asks for one instead of guessing.

## Install

Install the ones you want. In a Claude Code terminal session:

```text
/plugin install input-notify --marketplace ISenseHostility/jarno-plugins
/plugin install stats-board --marketplace ISenseHostility/jarno-plugins
/plugin install rubber-duck --marketplace ISenseHostility/jarno-plugins
/plugin install playtest-bot --marketplace ISenseHostility/jarno-plugins
/plugin install balance-sim --marketplace ISenseHostility/jarno-plugins
/plugin install i18n-filler --marketplace ISenseHostility/jarno-plugins
/plugin install devlog-writer --marketplace ISenseHostility/jarno-plugins
```

Or from a shell:

```sh
claude plugin install input-notify --marketplace ISenseHostility/jarno-plugins
claude plugin install stats-board --marketplace ISenseHostility/jarno-plugins
claude plugin install rubber-duck --marketplace ISenseHostility/jarno-plugins
claude plugin install playtest-bot --marketplace ISenseHostility/jarno-plugins
claude plugin install balance-sim --marketplace ISenseHostility/jarno-plugins
claude plugin install i18n-filler --marketplace ISenseHostility/jarno-plugins
claude plugin install devlog-writer --marketplace ISenseHostility/jarno-plugins
```

In the desktop app: **+** next to the prompt box → **Plugins** → **Add marketplace** `ISenseHostility/jarno-plugins` → **Add plugin**.

## Development

A mod is a hooks module (`hooks/register.ts[x]`) with tests in `tests/`; an agent is one file, `agents/<name>.md`.

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
