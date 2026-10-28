#!/usr/bin/env node
// Waiting-room snake. Pauses itself the moment any Claude Code session needs you.
// Arrows/WASD move · p pause · r restart · q quit
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'minigame')
const STATE_FILE = path.join(DIR, 'state')
const BEST_FILE = path.join(DIR, 'highscore.json')

const out = process.stdout
const ESC = '\x1b['
const fg = (n) => `${ESC}38;5;${n}m`
const bg = (n) => `${ESC}48;5;${n}m`
const RESET = `${ESC}0m`
const BOLD = `${ESC}1m`

const C = {
  empty: 234, empty2: 235, head: 118, body: [76, 70, 64, 34, 28], food: 203,
  frame: 240, title: 156, dim: 244,
}
const OVERLAY = {
  start:  { bg: 236, fg: 255, lines: ['S N A K E', '', 'arrows / WASD', 'p pause  r restart', 'q quit', '', 'any key to start'] },
  manual: { bg: 238, fg: 255, lines: ['PAUSED', '', 'p to resume'] },
  over:   { bg: 52,  fg: 255, lines: [] },
  needs:  { bg: 90,  flash: 163, fg: 231, lines: ['! ! !', '', 'CLAUDE', 'NEEDS YOU', '', 'any key resumes'] },
  done:   { bg: 22,  flash: 34,  fg: 231, lines: ['CLAUDE', 'IS DONE', '', 'any key resumes'] },
  ready:  { bg: 24,  fg: 231, lines: ['READY', '', 'press any key'] },
}

if (!process.stdin.isTTY) {
  console.error('cc-play needs an interactive terminal.')
  process.exit(1)
}

// ---- game state --------------------------------------------------------------

let cols = 0, rows = 0, bw = 0, bh = 0
let snake = [], dir = { x: 1, y: 0 }, turns = [], food = null
let score = 0, best = 0, newBest = false
let mode = 'start'        // start | playing | over
let paused = null         // null | 'manual' | 'claude'
let alert = null          // null | 'needs' | 'done' | 'ready'
let alertAt = 0
let timer = null

try { best = JSON.parse(fs.readFileSync(BEST_FILE, 'utf8')).best || 0 } catch {}

function saveBest() {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(BEST_FILE, JSON.stringify({ best, at: new Date().toISOString() })) } catch {}
}

function measure() {
  cols = out.columns || 30
  rows = out.rows || 15
  bw = Math.max(0, cols - 2)
  bh = Math.max(0, (rows - 3) * 2)
}

const tooSmall = () => bw < 10 || bh < 8

function reset() {
  const cx = Math.floor(bw / 2), cy = Math.floor(bh / 2)
  snake = [0, 1, 2, 3].map((i) => ({ x: cx - i, y: cy }))
  dir = { x: 1, y: 0 }
  turns = []
  score = 0
  newBest = false
  placeFood()
}

function placeFood() {
  const taken = new Set(snake.map((p) => p.y * bw + p.x))
  const free = []
  for (let i = 0; i < bw * bh; i++) if (!taken.has(i)) free.push(i)
  if (!free.length) { food = null; return gameOver() }
  const i = free[Math.floor(Math.random() * free.length)]
  food = { x: i % bw, y: Math.floor(i / bw) }
}

function gameOver() {
  mode = 'over'
  if (score > best) { best = score; newBest = true; saveBest() }
}

function step() {
  if (mode !== 'playing' || paused) return
  if (turns.length) dir = turns.shift()
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
  const hitsWall = head.x < 0 || head.y < 0 || head.x >= bw || head.y >= bh
  const eating = food && head.x === food.x && head.y === food.y
  const body = eating ? snake : snake.slice(0, -1)
  if (hitsWall || body.some((p) => p.x === head.x && p.y === head.y)) return gameOver()
  snake.unshift(head)
  if (eating) { score++; placeFood() } else snake.pop()
}

const speed = () => Math.max(55, 115 - score * 3)

function loop() {
  step()
  render()
  timer = setTimeout(loop, speed())
}

// ---- Claude state ------------------------------------------------------------

let lastMtime = 0
let seenUntil = Date.now()
let resumedAt = Date.now()
let sessions = {}

function pendingAlert() {
  const live = Object.values(sessions).filter((s) => s.ts > resumedAt)
  if (live.some((s) => s.state === 'needs')) return 'needs'
  if (live.some((s) => s.state === 'done')) return 'done'
  return null
}

function pollClaude() {
  let stat
  try { stat = fs.statSync(STATE_FILE) } catch { return }
  if (stat.mtimeMs === lastMtime) return
  lastMtime = stat.mtimeMs
  try { sessions = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).sessions || {} } catch { return }
  const fresh = Object.values(sessions).filter((s) => s.ts > seenUntil).sort((a, b) => a.ts - b.ts)
  if (!fresh.length) return
  seenUntil = Math.max(...fresh.map((s) => s.ts))
  const wantsYou = fresh.some((s) => s.state === 'needs' || s.state === 'done')
  if (wantsYou) {
    alert = pendingAlert() || 'needs'
    alertAt = Date.now()
    if (mode === 'playing') paused = 'claude'
    out.write('\x07')
  } else if (alert === 'needs' || alert === 'done') {
    alert = pendingAlert() || 'ready'
  }
  render()
}

// ---- input -------------------------------------------------------------------

const DIRS = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
}
const KEYMAP = {
  '\x1b[A': 'up', '\x1bOA': 'up', w: 'up', W: 'up', k: 'up',
  '\x1b[B': 'down', '\x1bOB': 'down', s: 'down', S: 'down', j: 'down',
  '\x1b[C': 'right', '\x1bOC': 'right', d: 'right', D: 'right', l: 'right',
  '\x1b[D': 'left', '\x1bOD': 'left', a: 'left', A: 'left', h: 'left',
}

function keys(chunk) {
  const list = []
  const re = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/g
  let m
  while ((m = re.exec(chunk))) list.push(m[0])
  return list
}

function turn(name) {
  const d = DIRS[name]
  const last = turns.length ? turns[turns.length - 1] : dir
  if ((d.x === -last.x && d.y === -last.y) || (d.x === last.x && d.y === last.y)) return
  if (turns.length < 3) turns.push(d)
}

function onKey(k) {
  if (k === '\x03' || k === 'q' || k === 'Q') return quit()
  if (alert) {
    if (Date.now() - alertAt < 600) return   // a key already on its way doesn't dismiss it
    alert = null
    resumedAt = Date.now()
    if (paused === 'claude') paused = null
    return render()
  }
  if (k === 'r' || k === 'R') { reset(); mode = 'playing'; paused = null; return render() }
  if (mode === 'start') { mode = 'playing'; if (KEYMAP[k]) turn(KEYMAP[k]); return render() }
  if (mode === 'over') { if (KEYMAP[k] || k === ' ' || k === '\r') { reset(); mode = 'playing' } return render() }
  if (k === 'p' || k === 'P' || k === ' ') { paused = paused ? null : 'manual'; return render() }
  if (paused === 'manual') return
  if (KEYMAP[k]) turn(KEYMAP[k])
}

// ---- drawing -----------------------------------------------------------------

function wrap(text, width) {
  if (text.length <= width) return [text]
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > width) { if (line) lines.push(line); line = word } else line = (line + ' ' + word).trim()
  }
  if (line) lines.push(line)
  return lines
}

function overlayFor() {
  if (alert) return OVERLAY[alert]
  if (mode === 'start') return OVERLAY.start
  if (mode === 'over') {
    return { ...OVERLAY.over, lines: ['GAME OVER', '', `score ${score}`, newBest ? 'NEW BEST!' : `best ${best}`, '', 'r / arrows: again', 'q: quit'] }
  }
  if (paused === 'manual') return OVERLAY.manual
  return null
}

function claudeBadge() {
  const states = Object.values(sessions).filter((s) => Date.now() - s.ts < 6 * 3600e3).map((s) => s.state)
  if (states.includes('needs')) return fg(206) + '● needs you'
  if (states.includes('working')) return fg(81) + '● working'
  if (states.includes('done')) return fg(114) + '● done'
  return fg(C.dim) + '○ claude'
}

function header() {
  const left = ` ${BOLD}${fg(C.title)}SNAKE${RESET} ${fg(255)}${score}${fg(C.dim)} ★${best}`
  const leftLen = ` SNAKE ${score} ★${best}`.length
  const badge = claudeBadge()
  const badgeLen = badge.replace(/\x1b\[[0-9;]*m/g, '').length
  const gap = cols - leftLen - badgeLen - 1
  return gap > 0 ? left + ' '.repeat(gap) + badge + ' ' + RESET : left + ' '.repeat(Math.max(0, cols - leftLen)) + RESET
}

function cellColor(x, y, bodyIndex) {
  if (food && food.x === x && food.y === y) return C.food
  const i = bodyIndex.get(y * bw + x)
  if (i === 0) return C.head
  if (i !== undefined) return C.body[Math.min(C.body.length - 1, Math.floor((i / Math.max(1, snake.length)) * C.body.length))]
  return ((x >> 1) + (y >> 1)) % 2 ? C.empty2 : C.empty
}

function render() {
  if (tooSmall()) {
    out.write(`${ESC}H${ESC}2J${RESET}Pane too small\r\n(${cols}x${rows}, need 12x7)`)
    return
  }
  const frame = []
  frame.push(header())
  frame.push(fg(C.frame) + '┌' + '─'.repeat(bw) + '┐' + RESET)

  const textRows = bh / 2
  const ov = overlayFor()
  let ovLines = null
  if (ov) {
    const width = bw - 2
    const wrapped = ov.lines.flatMap((l) => wrap(l, width))
    const top = Math.max(0, Math.floor((textRows - wrapped.length) / 2))
    ovLines = new Map(wrapped.map((l, i) => [top + i, l]))
  }
  const flashing = ov && ov.flash && Date.now() - alertAt < 1800 && Math.floor((Date.now() - alertAt) / 300) % 2 === 0
  const bodyIndex = new Map(snake.map((p, i) => [p.y * bw + p.x, i]))

  for (let r = 0; r < textRows; r++) {
    let line = fg(C.frame) + '│'
    if (ov) {
      const text = ovLines.get(r) || ''
      const pad = Math.max(0, Math.floor((bw - text.length) / 2))
      line += bg(flashing ? ov.flash : ov.bg) + fg(ov.fg) + BOLD + ' '.repeat(pad) + text + ' '.repeat(Math.max(0, bw - pad - text.length)) + RESET
    } else {
      let lastF = -1, lastB = -1
      for (let x = 0; x < bw; x++) {
        const t = cellColor(x, r * 2, bodyIndex)
        const b = cellColor(x, r * 2 + 1, bodyIndex)
        if (t !== lastF) { line += fg(t); lastF = t }
        if (b !== lastB) { line += bg(b); lastB = b }
        line += '▀'
      }
      line += RESET
    }
    frame.push(line + fg(C.frame) + '│' + RESET)
  }
  const hint = ' ←↑↓→ p r q '
  const bottom = bw > hint.length + 2 ? '─'.repeat(bw - hint.length - 1) + fg(C.dim) + hint + fg(C.frame) + '─' : '─'.repeat(bw)
  frame.push(fg(C.frame) + '└' + bottom + '┘' + RESET)
  // Synchronized update: the terminal shows the frame in one go, no flicker.
  out.write(`${ESC}?2026h${ESC}H` + frame.join('\r\n') + `${ESC}?2026l`)
}

// ---- lifecycle ---------------------------------------------------------------

function quit() {
  clearTimeout(timer)
  out.write(`${RESET}${ESC}?25h${ESC}?1049l`)
  try { process.stdin.setRawMode(false) } catch {}
  process.exit(0)
}

process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.on('uncaughtException', (err) => {
  out.write(`${RESET}${ESC}?25h${ESC}?1049l`)
  console.error(err)
  process.exit(1)
})

out.on('resize', () => {
  const oldW = bw, oldH = bh
  measure()
  out.write(`${ESC}2J`)
  if (snake.some((p) => p.x >= bw || p.y >= bh) || !oldW || !oldH) { reset(); if (mode === 'playing') paused = 'manual' }
  else if (food && (food.x >= bw || food.y >= bh)) placeFood()
  render()
})

if (process.platform === 'win32') try { process.title = 'Snake' } catch {}
out.write(`${ESC}?1049h${ESC}?25l${ESC}2J${ESC}]0;Snake\x07`)
process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { for (const k of keys(chunk)) onKey(k) })

measure()
reset()
setInterval(pollClaude, 200)
setInterval(() => { if (alert || mode !== 'playing' || paused) render() }, 300)
loop()
