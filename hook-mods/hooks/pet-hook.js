#!/usr/bin/env node
// Terminal pet: records the latest session event in ~/.claude/pet/<session>.json
// for statusline.js to draw. Prints nothing and always exits 0.
'use strict'

const fs = require('fs')
const path = require('path')
const c = require('./lib/common')

const PET_DIR = path.join(c.CLAUDE_DIR, 'pet')
const EVENTS = {
  SessionStart: 'start', UserPromptSubmit: 'prompt', PreToolUse: 'pre',
  PostToolUse: 'post', PostToolUseFailure: 'post', Notification: 'notify', Stop: 'stop',
}

function isRisky(command, config) {
  return (config.riskyPatterns || []).some((p) => {
    try { return new RegExp(p, 'i').test(command) } catch { return false }
  })
}

function pruneOld() {
  try {
    const cutoff = Date.now() - 7 * 864e5
    for (const f of fs.readdirSync(PET_DIR)) {
      if (!/^[\w-]+\.json$/.test(f) || f === 'pet.json' || f === 'profile.json') continue
      const file = path.join(PET_DIR, f)
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file)
    }
  } catch {}
}

async function main() {
  if (c.isHeadless()) return
  const input = await c.readStdin()
  const event = EVENTS[input.hook_event_name]
  const session = String(input.session_id || '').replace(/[^\w-]/g, '')
  if (!event || !session) return
  if (input.agent_id && event !== 'pre' && event !== 'post') return

  const config = c.readJSON(path.join(PET_DIR, 'pet.json'), {})
  const file = path.join(PET_DIR, `${session}.json`)
  const now = Date.now()

  c.withLock(file, () => {
    const state = c.readJSON(file, {})
    state.event = event
    state.ts = now
    state.cwd = input.cwd || state.cwd
    state.transcript = input.transcript_path || state.transcript
    if (event === 'pre') state.tool = input.tool_name
    if (event === 'start' || event === 'prompt') delete state.stopTs
    if (event === 'stop') state.stopTs = now

    // Hooks run async, so a fast tool's Post can land before its Pre: remember finished ids.
    const finished = Array.isArray(state.finished) ? state.finished : []
    const cmd = input.tool_input && input.tool_input.command
    if (event === 'pre' && input.tool_name === 'Bash' && typeof cmd === 'string' && isRisky(cmd, config)) {
      state.risky = { id: input.tool_use_id, ts: now, command: cmd.slice(0, 120) }
      if (finished.includes(input.tool_use_id)) state.risky.doneTs = now
    }
    if (event === 'post') {
      state.finished = [...finished, input.tool_use_id].slice(-20)
      if (state.risky && state.risky.id === input.tool_use_id) state.risky.doneTs = now
    }

    const outcome = event === 'post' ? c.testOutcome(input) : null
    if (outcome) {
      state.lastTest = { result: outcome, ts: now }
      c.writeLastTestResult(input.cwd, outcome, cmd)
      const profileFile = path.join(PET_DIR, 'profile.json')
      c.withLock(profileFile, () => {
        const profile = c.readJSON(profileFile, { happiness: 50, born: new Date().toISOString() })
        const delta = outcome === 'pass' ? (config.happinessPerPass ?? 3) : (config.happinessPerFail ?? -5)
        profile.happiness = Math.max(0, Math.min(100, Math.round((profile.happiness ?? 50) + delta)))
        profile[outcome === 'pass' ? 'passes' : 'fails'] = (profile[outcome === 'pass' ? 'passes' : 'fails'] || 0) + 1
        c.writeJSON(profileFile, profile)
      })
    }
    c.writeJSON(file, state)
  })
  if (event === 'start') pruneOld()
}

main().catch(() => {}).finally(() => process.exit(0))
