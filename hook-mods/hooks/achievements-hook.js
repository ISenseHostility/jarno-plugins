#!/usr/bin/env node
// Achievements: logs session events to ~/.claude/achievements/events.jsonl, keeps
// running stats, and unlocks what rules.json describes (toast + one stderr line).
// Never writes to stdout, so nothing reaches Claude's context. Always exits 0.
'use strict'

const fs = require('fs')
const path = require('path')
const c = require('./lib/common')

const DIR = path.join(c.CLAUDE_DIR, 'achievements')
const STATS = path.join(DIR, 'stats.json')
const EVENTS = path.join(DIR, 'events.jsonl')
const RULES = path.join(DIR, 'rules.json')

const DAY = 864e5
const SESSION_GAP_MS = 30 * 60e3
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const localDate = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyStats(now) {
  return {
    version: 1, installedAt: now, counters: {}, days: {}, projects: {}, sessions: {},
    unlocked: {}, recent: [], seenTestFile: {},
  }
}

// `git tag v1.2` or `gh release create`, not listing or deleting tags.
function createsTag(command) {
  return String(command || '').split(/&&|\|\||;|\n/).some((part) => {
    const seg = part.trim()
    if (/^gh\s+release\s+create\b/.test(seg)) return true
    const m = /^git\s+tag\b(.*)$/.exec(seg)
    if (!m) return false
    const args = m[1].trim().split(/\s+/).filter(Boolean)
    if (args.some((a) => /^(-l|--list|-d|--delete|-v|--verify|-n\d*|--contains|--points-at|--merged|--no-merged|--sort.*)$/.test(a))) return false
    return args.some((a) => !a.startsWith('-'))
  })
}

// Normalized keys of the PORT.md lines that say "verified".
function verifiedModules(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'PORT.md'), 'utf8')
    return text.split('\n')
      .filter((l) => /\bverified\b/i.test(l) && !/^\s*#/.test(l))
      .map((l) => l.toLowerCase()
        .replace(/\b(verified|ported|porting|in progress|todo|to do|pending|done|tested|planned|not started|blocked|status)\b/g, '')
        .replace(/[^a-z0-9/._-]+/g, ''))
      .filter(Boolean)
  } catch { return null }
}

function levelFor(xp, levels) {
  const first = (levels && levels.firstLevelXp) || 100
  const growth = (levels && levels.growth) || 1.3
  let level = 1
  let need = first
  let left = xp
  while (left >= need) { left -= need; level++; need = Math.round(need * growth) }
  return { level, into: left, need }
}

function dayStreak(days, key, now) {
  let streak = 0
  let t = now
  if (!days[localDate(t)] || !days[localDate(t)][key]) t -= DAY // today may not have started yet
  while (days[localDate(t)] && days[localDate(t)][key]) { streak++; t -= DAY }
  return streak
}

function metrics(stats, now) {
  const n = stats.counters
  const dayList = Object.entries(stats.days)
  const weekAgo = localDate(now - 6 * DAY)
  const week = new Set()
  for (const [date, d] of dayList) if (date >= weekAgo) (d.projects || []).forEach((p) => week.add(p))
  return {
    ...n,
    installed: 1,
    sessionDays: dayList.filter(([, d]) => d.session).length,
    greenDays: dayList.filter(([, d]) => d.green).length,
    nightOwlDays: dayList.filter(([, d]) => d.night).length,
    projectsThisWeek: week.size,
    dayStreak: dayStreak(stats.days, 'session', now),
  }
}

function checkRules(stats, rules, project, now) {
  const values = metrics(stats, now)
  const unlocked = []
  for (const a of rules.achievements || []) {
    const tiers = Array.isArray(a.tiers) ? a.tiers : [{ tier: null, at: a.at }]
    for (const t of tiers) {
      const key = t.tier ? `${a.id}:${t.tier}` : a.id
      if (stats.unlocked[key] || typeof t.at !== 'number') continue
      if ((values[a.metric] || 0) < t.at) continue
      const entry = { key, id: a.id, name: a.name, tier: t.tier, icon: a.icon || '🏆', description: a.description || '', ts: now, project }
      stats.unlocked[key] = entry
      stats.recent.unshift(entry)
      unlocked.push(entry)
    }
  }
  stats.recent = stats.recent.slice(0, 30)
  return unlocked
}

function rotateLog() {
  try {
    if (fs.statSync(EVENTS).size > 5 * 1024 * 1024) fs.renameSync(EVENTS, path.join(DIR, `events-${localDate(Date.now())}.jsonl`))
  } catch {}
}

async function main() {
  if (c.isHeadless()) return
  const input = await c.readStdin()
  const hook = input.hook_event_name
  if (!hook || input.agent_id) return
  const now = Date.now()
  const date = localDate(now)
  const hour = new Date(now).getHours()
  const root = c.projectRoot(input.cwd)
  const project = c.projectName(input.cwd)
  const session = c.safeKey(input.session_id || 'unknown')
  const rules = c.readJSON(RULES, { achievements: [], xp: {} })
  const xpTable = rules.xp || {}
  const kinds = []

  const unlocked = c.withLock(STATS, () => {
    const stats = c.readJSON(STATS, null) || emptyStats(now)
    for (const k of ['counters', 'days', 'projects', 'sessions', 'unlocked', 'seenTestFile']) stats[k] = stats[k] || {}
    stats.recent = stats.recent || []
    const n = stats.counters
    const bump = (k, by = 1) => { n[k] = (n[k] || 0) + by }
    const proj = stats.projects[project] = stats.projects[project] || { xp: 0, days: [] }
    const addXp = (k) => { proj.xp += xpTable[k] || 0 }

    // Comeback, before this event counts as activity.
    if (proj.lastActive && now - proj.lastActive >= 30 * DAY) { bump('comebacks'); kinds.push('comeback') }
    proj.lastActive = now
    if (!proj.days.includes(date)) proj.days = [...proj.days, date].slice(-400)

    const day = stats.days[date] = stats.days[date] || { projects: [] }
    day.session = true
    if (!day.projects.includes(project)) day.projects.push(project)
    if (hour >= 2 && hour < 5) day.night = true

    const s = stats.sessions[session] = stats.sessions[session] || { project, start: now, lastTs: now, compactions: 0 }
    if (now - s.lastTs > SESSION_GAP_MS) s.start = now
    s.lastTs = now
    n.longestSessionMin = Math.max(n.longestSessionMin || 0, Math.floor((now - s.start) / 60e3))

    const checkPort = () => {
      if (!root) return
      const current = verifiedModules(root)
      if (!current) return
      if (Array.isArray(proj.port)) {
        const added = current.filter((k) => !proj.port.includes(k)).length
        if (added > 0) { bump('portedModules', added); kinds.push('port_verified') }
      }
      proj.port = current
    }
    const testRun = (result) => {
      if (result === 'pass') {
        bump('greenRuns'); day.green = true; addXp('testPass')
        if (s.hadFail && !s.phoenix) { s.phoenix = true; bump('phoenixes') }
        kinds.push('test_pass')
      } else {
        bump('redRuns'); s.hadFail = true; n.cleanStreak = 0; addXp('testFail')
        kinds.push('test_fail')
      }
    }

    switch (hook) {
      case 'SessionStart':
        if (input.source === 'compact') break
        bump('sessions'); addXp('sessionStart'); s.start = now
        kinds.push('session_start')
        checkPort()
        break
      case 'SessionEnd':
        if (!s.hadFail && !s.ended) n.cleanStreak = (n.cleanStreak || 0) + 1
        s.ended = true
        kinds.push('session_end')
        break
      case 'UserPromptSubmit':
        bump('prompts'); addXp('prompt'); kinds.push('prompt')
        break
      case 'PostCompact':
        s.compactions = (s.compactions || 0) + 1
        n.maxCompactions = Math.max(n.maxCompactions || 0, s.compactions)
        kinds.push('compaction')
        break
      case 'TaskCompleted':
        bump('tasksDone'); addXp('taskDone'); kinds.push('task_done')
        break
      case 'Stop': {
        bump('turnsDone'); addXp('turnDone'); kinds.push('turn_done')
        // A last-test-result written by something other than these hooks counts too.
        const external = c.readLastTestResult(input.cwd)
        if (external && !external.mine && external.ts > (stats.seenTestFile[project] || 0)) {
          stats.seenTestFile[project] = external.ts
          if (now - external.ts < DAY) testRun(external.result)
        }
        checkPort()
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const ti = input.tool_input || {}
        if (EDIT_TOOLS.has(input.tool_name) && hook === 'PostToolUse') {
          bump('filesEdited'); addXp('fileEdit'); kinds.push('file_edit')
          if (/(^|[\\/])PORT\.md$/i.test(String(ti.file_path || ti.notebook_path || ''))) checkPort()
        }
        if (input.tool_name === 'Bash') {
          const outcome = c.testOutcome(input)
          if (outcome) testRun(outcome)
          if (hook === 'PostToolUse' && createsTag(ti.command)) { bump('tagsCreated'); addXp('tagCreated'); kinds.push('tag_created') }
        }
        break
      }
      default:
        break
    }

    const got = checkRules(stats, rules, project, now)
    proj.xp += got.length * (xpTable.achievement || 0)

    // Keep the stats file small.
    for (const [id, old] of Object.entries(stats.sessions)) if (now - old.lastTs > 14 * DAY) delete stats.sessions[id]
    const keepFrom = localDate(now - 400 * DAY)
    for (const d of Object.keys(stats.days)) if (d < keepFrom) delete stats.days[d]

    c.writeJSON(STATS, stats)
    return got
  })

  if (kinds.length) {
    rotateLog()
    const iso = new Date(now).toISOString()
    const lines = kinds.map((kind) => JSON.stringify({ ts: now, iso, kind, project, session, hook })).join('\n')
    fs.mkdirSync(DIR, { recursive: true })
    fs.appendFileSync(EVENTS, lines + '\n')
  }
  for (const u of unlocked || []) {
    fs.appendFileSync(EVENTS, JSON.stringify({ ts: now, iso: new Date(now).toISOString(), kind: 'achievement', key: u.key, project, session }) + '\n')
  }

  if (unlocked && unlocked.length) {
    const label = (u) => `${u.icon} ${u.name}${u.tier ? ` (${u.tier})` : ''}`
    if (unlocked.length === 1) c.toast(`Achievement unlocked: ${label(unlocked[0])}`, unlocked[0].description)
    else c.toast(`${unlocked.length} achievements unlocked`, unlocked.map(label).join('\n'))
    process.stderr.write(`🏆 Achievement unlocked: ${unlocked.map(label).join(', ')}\n`)
  }
}

main().catch(() => {}).finally(() => process.exit(0))
