#!/usr/bin/env node
// Installs the hook mods into ~/.claude and merges their hooks and status line into
// ~/.claude/settings.json (backed up first). Safe to run again: existing hooks are kept,
// nothing is added twice, and your edited pet.json / rules.json are left alone.
//   node hook-mods/install.js          install or update
//   node hook-mods/install.js --force  also overwrite pet.json and rules.json
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const SRC = __dirname
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const force = process.argv.includes('--force')
const KEEP = new Set([path.join('pet', 'pet.json'), path.join('achievements', 'rules.json')])

function copyTree(rel) {
  const from = path.join(SRC, rel)
  for (const name of fs.readdirSync(from)) {
    const child = path.join(rel, name)
    if (fs.statSync(path.join(SRC, child)).isDirectory()) { copyTree(child); continue }
    const to = path.join(CLAUDE, child)
    if (KEEP.has(child) && fs.existsSync(to) && !force) { console.log(`  kept    ${child}`); continue }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(path.join(SRC, child), to)
    if (!name.includes('.')) fs.chmodSync(to, 0o755)
    console.log(`  copied  ${child}`)
  }
}

console.log(`Installing into ${CLAUDE}`)
for (const dir of ['hooks', 'pet', 'achievements', 'minigame']) copyTree(dir)

// cc-play on the PATH, through ~/.local/bin when it exists.
const bin = path.join(os.homedir(), '.local', 'bin')
if (fs.existsSync(bin)) {
  for (const f of ['cc-play', 'cc-play.cmd']) fs.copyFileSync(path.join(SRC, 'minigame', f), path.join(bin, f))
  console.log(`  copied  cc-play to ${bin}`)
} else {
  console.log(`  add ${path.join(CLAUDE, 'minigame')} to your PATH to run cc-play`)
}

const file = path.join(CLAUDE, 'settings.json')
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
if (fs.existsSync(file)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(CLAUDE, 'backups', `settings.json.before-hook-mods.${stamp}`)
  fs.mkdirSync(path.dirname(backup), { recursive: true })
  fs.copyFileSync(file, backup)
  console.log(`Backed up settings to ${backup}`)
}

const home = CLAUDE.split(path.sep).join('/')
const cmd = (rel) => ({ type: 'command', command: `node "${home}/${rel}"`, timeout: 5, async: true })
const PET = cmd('hooks/pet-hook.js'), ACH = cmd('hooks/achievements-hook.js'), GAME = cmd('minigame/hook.js')
const plan = [
  ['SessionStart', null, PET], ['SessionStart', null, ACH],
  ['UserPromptSubmit', null, PET], ['UserPromptSubmit', null, ACH], ['UserPromptSubmit', null, GAME],
  ['PreToolUse', null, PET],
  ['PostToolUse', null, PET], ['PostToolUse', 'Edit|Write|MultiEdit|NotebookEdit|Bash', ACH],
  ['PostToolUseFailure', null, PET], ['PostToolUseFailure', 'Bash', ACH],
  ['Notification', null, PET], ['Notification', null, GAME],
  ['Stop', null, PET], ['Stop', null, ACH], ['Stop', null, GAME],
  ['SessionEnd', null, ACH], ['PostCompact', null, ACH], ['TaskCompleted', null, ACH],
]
settings.hooks = settings.hooks || {}
let added = 0
for (const [event, matcher, hook] of plan) {
  const groups = settings.hooks[event] = settings.hooks[event] || []
  if (groups.some((g) => (g.hooks || []).some((h) => h.command === hook.command))) continue
  groups.push(matcher ? { matcher, hooks: [hook] } : { hooks: [hook] })
  added++
}
console.log(`Added ${added} hook${added === 1 ? '' : 's'}`)

const statusLine = { type: 'command', command: `node "${home}/hooks/statusline.js"`, padding: 0, refreshInterval: 1 }
if (settings.statusLine && settings.statusLine.command !== statusLine.command) {
  console.log(`Kept your own status line; to show the pet, set statusLine.command to: ${statusLine.command}`)
} else {
  settings.statusLine = statusLine
}
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
console.log('Done. Claude Code picks the hooks up by itself.')
