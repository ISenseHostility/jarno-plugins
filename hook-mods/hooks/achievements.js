#!/usr/bin/env node
// Terminal overview of achievements, XP, levels and streaks.
//   achievements            the full overview
//   achievements --no-color plain text
//   achievements --test-toast  show a sample unlock toast
'use strict'

const path = require('path')
const c = require('./lib/common')

if (process.argv.includes('--test-toast')) {
  c.toast('Achievement unlocked: 🎯 Test Toast', 'If you can read this, toasts work.')
  console.log('Sent a test toast.')
  process.exit(0)
}

const DIR = path.join(c.CLAUDE_DIR, 'achievements')
const DAY = 864e5
const color = !process.argv.includes('--no-color') && process.stdout.isTTY !== false
const sgr = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : String(text))
const bold = sgr('1'); const dim = sgr('2'); const gold = sgr('33'); const green = sgr('32')
const cyan = sgr('36'); const magenta = sgr('35')
const TIER_COLOR = { Bronze: sgr('38;5;173'), Silver: sgr('38;5;250'), Gold: sgr('38;5;220') }

const localDate = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const has = (set, ms) => set.has(localDate(ms))
function streakOf(dates, now) {
  const set = new Set(dates)
  let t = has(set, now) ? now : now - DAY
  let streak = 0
  while (has(set, t)) { streak++; t -= DAY }
  return streak
}
function levelFor(xp, levels) {
  const first = (levels && levels.firstLevelXp) || 100
  const growth = (levels && levels.growth) || 1.3
  let level = 1; let need = first; let left = xp
  while (left >= need) { left -= need; level++; need = Math.round(need * growth) }
  return { level, into: left, need }
}
const bar = (part, whole, width = 16) => {
  const filled = Math.round(Math.min(1, whole ? part / whole : 0) * width)
  return green('█'.repeat(filled)) + dim('░'.repeat(width - filled))
}
const ago = (ms) => {
  const m = Math.floor((Date.now() - ms) / 60e3)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

const rules = c.readJSON(path.join(DIR, 'rules.json'), { achievements: [] })
const stats = c.readJSON(path.join(DIR, 'stats.json'), null)
const now = Date.now()
const out = []
const line = (s = '') => out.push(s)

line()
line(bold(gold('  🏆  Claude Code achievements')))
if (!stats) {
  line(dim('  No stats yet. They start with your next Claude Code session.'))
  console.log(out.join('\n'))
  process.exit(0)
}

const sessionDays = Object.keys(stats.days || {}).filter((d) => stats.days[d].session)
const n = stats.counters || {}
const total = (rules.achievements || []).reduce((sum, a) => sum + (Array.isArray(a.tiers) ? a.tiers.length : 1), 0)
const got = Object.keys(stats.unlocked || {}).length
line(dim(`  ${got}/${total} unlocked · ${n.sessions || 0} sessions · ${n.greenRuns || 0} green / ${n.redRuns || 0} red test runs · clean streak ${n.cleanStreak || 0}`))

line()
line(bold('  Streaks'))
line(`    Overall      ${magenta(`🔥 ${streakOf(sessionDays, now)} day${streakOf(sessionDays, now) === 1 ? '' : 's'}`)}`)

line()
line(bold('  Projects'))
const projects = Object.entries(stats.projects || {}).sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
const nameWidth = Math.min(28, Math.max(8, ...projects.map(([p]) => p.length)))
for (const [name, p] of projects.slice(0, 15)) {
  const lv = levelFor(p.xp || 0, rules.levels)
  const streak = streakOf(p.days || [], now)
  line(`    ${c.clean(name).slice(0, nameWidth).padEnd(nameWidth)}  ${cyan(`Lv ${String(lv.level).padStart(2)}`)}  ${bar(lv.into, lv.need)} ${dim(`${p.xp || 0} XP`.padEnd(9))} ${streak ? magenta(`🔥${streak}`) : dim('–')}  ${dim(p.lastActive ? ago(p.lastActive) : '')}`)
}
if (projects.length > 15) line(dim(`    … and ${projects.length - 15} more`))

line()
line(bold('  Achievements'))
for (const a of rules.achievements || []) {
  const tiers = Array.isArray(a.tiers) ? a.tiers : [{ tier: null, at: a.at }]
  const marks = tiers.map((t) => {
    const key = t.tier ? `${a.id}:${t.tier}` : a.id
    const done = stats.unlocked[key]
    const label = t.tier ? t.tier : 'unlocked'
    if (!done) return dim(t.tier ? `○ ${label} ${t.at}` : '○ locked')
    return (t.tier ? TIER_COLOR[t.tier] || gold : gold)(`● ${label}`)
  }).join('  ')
  const any = tiers.some((t) => stats.unlocked[t.tier ? `${a.id}:${t.tier}` : a.id])
  const title = c.clean(`${a.icon || '🏆'} ${a.name}`)
  line(`    ${any ? bold(title) : dim(title)}  ${dim(a.description || '')}`)
  line(`       ${marks}`)
}

line()
line(bold('  Recent unlocks'))
const recent = (stats.recent || []).slice(0, 8)
if (!recent.length) line(dim('    none yet'))
for (const r of recent) {
  line(`    ${c.clean(r.icon)} ${bold(c.clean(r.name))}${r.tier ? ` ${(TIER_COLOR[r.tier] || gold)(r.tier)}` : ''}  ${dim(`${c.clean(r.project)} · ${ago(r.ts)}`)}`)
}
line()
console.log(out.join('\n'))
