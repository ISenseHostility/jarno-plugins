#!/usr/bin/env node
// Waiting-room minigame: records each session's Claude state in ~/.claude/minigame/state
// (needs = waiting on you, done = turn finished, working = you sent a prompt).
// The game polls that file. Prints nothing, always exits 0.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'minigame')
const FILE = path.join(DIR, 'state')
const STATES = { Notification: 'needs', Stop: 'done', UserPromptSubmit: 'working' }

function read(cb) {
  let data = ''
  const timer = setTimeout(() => cb(data), 1000)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => { data += c })
  process.stdin.on('end', () => { clearTimeout(timer); cb(data) })
  process.stdin.on('error', () => { clearTimeout(timer); cb(data) })
}

read((raw) => {
  try {
    const input = JSON.parse(raw || '{}')
    const state = STATES[input.hook_event_name]
    if (!state || !input.session_id || input.agent_id) return
    let all = {}
    try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')).sessions || {} } catch {}
    const prev = all[input.session_id]
    // The "waiting for your input" reminder after a finished turn is not news.
    if (state === 'needs' && input.notification_type === 'idle_prompt' && prev && prev.state === 'done') return
    const now = Date.now()
    all[input.session_id] = {
      state, ts: now,
      project: path.basename(input.cwd || ''),
      message: String(input.message || '').slice(0, 80),
    }
    for (const [id, s] of Object.entries(all)) if (now - s.ts > 12 * 3600e3) delete all[id]
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    const text = JSON.stringify({ updated: now, sessions: all })
    try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, FILE) } catch {
      try { fs.unlinkSync(tmp) } catch {}
      fs.writeFileSync(FILE, text)
    }
  } catch {} finally { process.exit(0) }
})
