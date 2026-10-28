#!/usr/bin/env node
// Status line: the terminal pet, then model, project and context use.
// Reads Claude Code's status JSON on stdin. Any failure falls back to the idle pet.
//   node statusline.js --demo <mood>   draws one mood without reading stdin
'use strict'

const fs = require('fs')
const path = require('path')

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude')
const PET_DIR = path.join(CLAUDE_DIR, 'pet')

const COLORS = {
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90,
}
const paint = (name, text) => (COLORS[name] ? `\x1b[${COLORS[name]}m${text}\x1b[0m` : text)
const dim = (text) => `\x1b[2m${text}\x1b[0m`

const DEFAULT_MOODS = {
  idle: { frames: ['(•‿•)', '(-‿-)'], bubble: '', color: 'white' },
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function readStdin(ms = 800) {
  return new Promise((resolve) => {
    let data = ''
    const done = () => { try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) } }
    const timer = setTimeout(done, ms)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => { clearTimeout(timer); done() })
    process.stdin.on('error', () => { clearTimeout(timer); done() })
  })
}

function projectRoot(dir) {
  if (!dir) return null
  let d = path.resolve(dir)
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    const up = path.dirname(d)
    if (up === d) return path.resolve(dir)
    d = up
  }
}

function lastTestFile(root) {
  if (!root) return null
  try {
    const file = path.join(root, '.claude', 'last-test-result')
    const ts = fs.statSync(file).mtimeMs
    const text = fs.readFileSync(file, 'utf8').trim()
    let status
    try { const j = JSON.parse(text); status = String(j.status || j.result || '') } catch { status = text.split(/\s+/)[0] }
    status = status.toLowerCase()
    if (/^(pass|passed|ok|green|success|0)$/.test(status)) return { result: 'pass', ts }
    if (/^(fail|failed|red|failure|error|1)$/.test(status)) return { result: 'fail', ts }
  } catch {}
  return null
}

// Context use: the status input's figure, else the transcript's last usage, else its size.
function contextPercent(input, transcript) {
  const cw = input.context_window || {}
  if (typeof cw.used_percentage === 'number') return cw.used_percentage
  if (!transcript) return null
  const modelId = String((input.model && input.model.id) || '')
  const windowSize = cw.context_window_size || (/\[1m\]|1m/i.test(modelId) ? 1_000_000 : 200_000)
  try {
    const size = fs.statSync(transcript).size
    const len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    const fd = fs.openSync(transcript, 'r')
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue
      try {
        const entry = JSON.parse(lines[i])
        const u = entry.message && entry.message.usage
        if (!u || entry.isSidechain) continue
        const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
        if (tokens > 0) return Math.round((tokens / windowSize) * 100)
      } catch {}
    }
    return Math.min(100, Math.round((size / 4 / windowSize) * 100))
  } catch { return null }
}

function pickMood(state, ctx, test, config, now) {
  const age = now - (state.ts || 0)
  const sleepMs = (config.sleepAfterMinutes ?? 5) * 60e3
  const r = state.risky
  if (r && (now - r.ts < (config.panicForSeconds ?? 20) * 1e3 || (!r.doneTs && now - r.ts < 180e3))) {
    if (!r.doneTs || now - r.doneTs < 5e3) return { mood: 'panicking' }
  }
  if (test && test.result === 'fail' && now - test.ts < (config.sadForMinutes ?? 30) * 60e3) return { mood: 'sad' }
  if (ctx !== null && ctx >= (config.stressAtPercent ?? 90)) return { mood: 'stressed' }
  if (ctx !== null && ctx >= (config.sweatAtPercent ?? 70)) return { mood: 'sweating' }
  if (state.event === 'notify') return { mood: 'waiting' }
  if (['pre', 'post', 'prompt'].includes(state.event) && age < sleepMs) return { mood: 'working' }
  const happyMs = (config.happyForSeconds ?? 120) * 1e3
  if (test && test.result === 'pass' && now - test.ts < happyMs) return { mood: 'happy', tests: true }
  if (state.event === 'stop' && age < happyMs) return { mood: 'happy' }
  if (state.ts && age > sleepMs) return { mood: 'asleep' }
  return { mood: 'idle' }
}

function drawPet(config, picked, now) {
  const moods = { ...DEFAULT_MOODS, ...(config.moods || {}) }
  const m = moods[picked.mood] || moods.idle
  const frames = Array.isArray(m.frames) && m.frames.length ? m.frames : DEFAULT_MOODS.idle.frames
  const face = frames[Math.floor(now / 1000) % frames.length]
  const bubble = (picked.tests && m.testsBubble) || m.bubble || ''
  let out = paint(m.color, face)
  if (bubble) out += ' ' + dim(`‹${bubble}›`)
  const profile = readJSON(path.join(PET_DIR, 'profile.json'), null)
  const tag = []
  if (config.showName !== false && config.name) tag.push(config.name)
  if (config.showHappiness !== false && profile && typeof profile.happiness === 'number') tag.push(`♥${profile.happiness}`)
  if (tag.length) out += ' ' + dim(tag.join(' '))
  return out
}

async function main() {
  const now = Date.now()
  const config = readJSON(path.join(PET_DIR, 'pet.json'), {})
  const demo = process.argv.indexOf('--demo')
  if (demo !== -1) {
    const mood = process.argv[demo + 1] || 'idle'
    const ctx = mood === 'stressed' ? 93 : mood === 'sweating' ? 76 : 23
    const pet = drawPet(config, { mood, tests: process.argv.includes('--tests') }, now)
    return `${pet}  ${dim('│')} Opus 5.5 ${dim('│')} jarno-plugins ${dim('│')} ctx ${ctx}%`
  }

  let input = {}
  let pet = paint('white', '(•‿•)')
  let ctx = null
  try {
    input = await readStdin()
    const session = String(input.session_id || '').replace(/[^\w-]/g, '')
    const state = session ? readJSON(path.join(PET_DIR, `${session}.json`), null) : null
    ctx = contextPercent(input, input.transcript_path || (state && state.transcript))
    if (state && typeof state === 'object') {
      const dir = (input.workspace && (input.workspace.project_dir || input.workspace.current_dir)) || input.cwd || state.cwd
      const fromFile = lastTestFile(projectRoot(dir))
      const fromState = state.lastTest && state.lastTest.ts ? state.lastTest : null
      const test = [fromFile, fromState].filter(Boolean).sort((a, b) => b.ts - a.ts)[0] || null
      pet = drawPet(config, pickMood(state, ctx, test, config, now), now)
    } else {
      pet = drawPet(config, { mood: 'idle' }, now)
    }
  } catch {}

  const parts = [pet]
  try {
    const model = input.model && (input.model.display_name || input.model.id)
    if (model) parts.push(model)
    const dir = (input.workspace && input.workspace.current_dir) || input.cwd
    if (dir) parts.push(path.basename(dir))
    if (ctx !== null) parts.push(`ctx ${Math.round(ctx)}%`)
  } catch {}
  return parts.join(` ${dim('│')} `).replace(` ${dim('│')} `, `  ${dim('│')} `)
}

main()
  .then((line) => process.stdout.write(line + '\n'))
  .catch(() => process.stdout.write('(•‿•)\n'))
  .finally(() => process.exit(0))
