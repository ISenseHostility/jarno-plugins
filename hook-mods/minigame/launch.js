#!/usr/bin/env node
// cc-play: opens the snake game in a pane beside the current terminal.
//   cc-play           split the current terminal (tmux, WezTerm, Windows Terminal)
//   cc-play --here    run it in this terminal
//   cc-play --window  open it in its own small Windows Terminal window
'use strict'

const { spawn, spawnSync } = require('child_process')
const path = require('path')

const GAME = path.join(__dirname, 'game.js')
const NODE = process.execPath
const args = process.argv.slice(2)
const env = process.env

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'ignore', windowsHide: true })
  return !r.error && r.status === 0
}

function detached(cmd, cmdArgs) {
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' })
    let failed = false
    child.on('error', () => { failed = true })
    child.unref()
    return new Promise((resolve) => setTimeout(() => resolve(!failed), 300))
  } catch { return Promise.resolve(false) }
}

const smallWindow = () => detached('wt.exe', ['-w', 'cc-play', '--size', '34,18', 'new-tab', '--title', 'Snake', NODE, GAME])

async function main() {
  if (args.includes('--here')) return require(GAME)
  if (args.includes('--window')) return (await smallWindow()) || fallback()

  if (env.TMUX) {
    if (run('tmux', ['split-window', '-h', '-l', '34', `"${NODE}" "${GAME}"`])) return
  }
  if (env.WEZTERM_PANE) {
    if (run('wezterm', ['cli', 'split-pane', '--right', '--cells', '34', '--', NODE, GAME])) return
  }
  if (env.WT_SESSION) {
    if (await detached('wt.exe', ['-w', '0', 'split-pane', '-V', '--size', '0.3', '--title', 'Snake', NODE, GAME])) return
  }
  if (env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' || env.TERM_PROGRAM === 'vscode') {
    const ide = env.TERM_PROGRAM === 'vscode' ? 'VS Code' : 'IntelliJ'
    console.log(`${ide}'s terminal can't be split from a command, so Snake opens in a small window.`)
    console.log(`To keep it inside ${ide}: split the terminal (right-click the tab > Split Right) and run: cc-play --here`)
  }
  if (process.platform === 'win32' && (await smallWindow())) return
  fallback()
}

async function fallback() {
  if (process.platform === 'win32' && (await detached('cmd.exe', ['/c', 'start', '"Snake"', NODE, GAME]))) return
  console.log('No splittable terminal found. Running here; quit with q.')
  require(GAME)
}

main()
