import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { AgentTokens, Gauges, Timing } from '../types'

const PANE = 'stats-board'
const TITLE = 'Stats'
const MAIN = 'main'

// Change a tag when its value's fields change: old stored values are then read as the initial one.
const agents = atom({ plugin: 'stats-board', key: 'agents' } as const, [], { shape: 'agents-1' })
const gauges = atom({ plugin: 'stats-board', key: 'gauges' } as const, { limits: [] }, { shape: 'gauges-1' })
const timing = atom({ plugin: 'stats-board', key: 'timing' } as const, { busyMs: 0, turnWaitMs: 0 }, { shape: 'timing-1' })

const LIMIT_LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  : String(n)

const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const level = (percent: number) => (percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success')

const untilReset = (iso: string | undefined) => {
  if (iso === undefined) return ''
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes <= 0) return 'resets now'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  return `resets in ${d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}`
}

const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}

// Busy time so far: finished turns, plus the running turn less its waits.
const busyAt = (t: Timing, now: number) => {
  if (t.turnStartedAt === undefined) return t.busyMs
  const waiting = t.turnWaitMs + (t.waitingSince === undefined ? 0 : now - t.waitingSince)
  return t.busyMs + Math.max(0, now - t.turnStartedAt - waiting)
}

function toGauges(context: SessionContextUsage, limits: SessionRateLimit[]): Gauges {
  return {
    ...(context.percent !== undefined && { contextPercent: context.percent }),
    ...(context.tokens !== undefined && { contextTokens: context.tokens }),
    contextWindow: context.window,
    limits: limits.map(({ kind, percentUsed, resetsAt }) => ({
      kind,
      percentUsed,
      ...(resetsAt !== undefined && { resetsAt }),
    })),
  }
}

async function agentLabel($: EngineInterface, agentId: string) {
  const info = (await $.agent.list()).find(agent => agent.id === agentId)
  if (info === undefined) return `agent ${agentId.slice(0, 6)}`
  return info.name ?? `${info.type}: ${info.description}`
}

async function openBoard($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

// Waits on the person can overlap (parallel tool calls each asking): count the union.
let openWaits = 0

async function waitStarts($: EngineInterface) {
  openWaits += 1
  if (openWaits > 1) return
  const now = await $.clock.now()
  await update($, timing, t => (t.turnStartedAt === undefined ? t : { ...t, waitingSince: now }))
}

async function waitEnds($: EngineInterface) {
  openWaits = Math.max(0, openWaits - 1)
  if (openWaits > 0) return
  const now = await $.clock.now()
  await update($, timing, ({ waitingSince, ...t }) =>
    waitingSince === undefined ? t : { ...t, turnWaitMs: t.turnWaitMs + (now - waitingSince) })
}

export const register: Register = on => {
  // tool_use_ids of calls in flight, and of those waiting on the person (a question, an asked permission).
  const running = new Set<string>()
  const asked = new Set<string>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'stats-board', description: 'Show the stats board pane' })
    const usage = await $.session.usage()
    await update($, gauges, () => toGauges(usage.context, usage.rateLimits))
    await update($, timing, t => ({ ...t, sessionStartedAt: usage.startedAt }))
    // The clocks and reset countdowns tick between measurements.
    $.clock.every(5_000, () => $.ui.invalidate('ui.render'))
    void openBoard($)
    return started
  })

  on('command.run', { command: 'stats-board' }, async $ => {
    const opened = await openBoard($)
    return { text: opened.isPlaced ? 'Stats board opened.' : `Stats board waits: ${opened.reason}` }
  })

  on('session.measure', async ($, e, next) => {
    await update($, gauges, () => toGauges(e.context, e.rateLimits))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      openWaits = 0
      await update($, timing, ({ waitingSince: _, ...t }) => ({ ...t, turnStartedAt: now, turnWaitMs: 0 }))
    }
    return next(e)
  })

  // An `ask` verdict on a running call opens its permission dialog: a wait until the call returns.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && id !== undefined && running.has(id) && !asked.has(id)) {
      asked.add(id)
      await waitStarts($)
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // A question waits on the person for the whole call.
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    running.add(id)
    if (e.tool === 'AskUserQuestion') {
      asked.add(id)
      await waitStarts($)
    }
    try {
      return await next(e)
    } finally {
      running.delete(id)
      if (asked.delete(id)) await waitEnds($)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      openWaits = 0
      await update($, timing, t => ({
        busyMs: busyAt(t, now),
        turnWaitMs: 0,
        ...(t.sessionStartedAt !== undefined && { sessionStartedAt: t.sessionStartedAt }),
      }))
    }
    const usage = e.usage
    if (usage === undefined) return done

    const key = e.agentId ?? MAIN
    const label = e.agentId === undefined ? 'Main' : await agentLabel($, e.agentId)
    await update($, agents, list => {
      const known = list.find(row => row.key === key)
      const row: AgentTokens = {
        key,
        label,
        input: (known?.input ?? 0) + usage.input_tokens,
        cacheWrite: (known?.cacheWrite ?? 0) + usage.cache_creation_input_tokens,
        cacheRead: (known?.cacheRead ?? 0) + usage.cache_read_input_tokens,
        output: (known?.output ?? 0) + usage.output_tokens,
        turns: (known?.turns ?? 0) + 1,
      }
      return known === undefined ? [...list, row] : list.map(one => (one.key === key ? row : one))
    })
    return done
  })

  // /clear starts the session's count over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, agents, () => [])
      await update($, timing, () => ({ sessionStartedAt: now, busyMs: 0, turnWaitMs: 0 }))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(28, e.props.bodyColumns)
    const g = await read($, gauges)
    const rows = await read($, agents)
    const t = await read($, timing)
    const now = await $.clock.now()
    const lengthMs = t.sessionStartedAt === undefined ? undefined : now - t.sessionStartedAt
    const busyMs = busyAt(t, now)

    const barWidth = Math.max(6, Math.min(24, width - 18))
    const gauge = (label: string, percent: number | undefined, note: string) => (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text>{fit(label, 8)}</Text>
          {percent === undefined
            ? <Text dimColor>{'░'.repeat(barWidth)}   —</Text>
            : <Text color={level(percent)}>{bar(percent, barWidth)} {`${Math.round(percent)}%`.padStart(4)}</Text>}
        </Box>
        {note !== '' && <Text dimColor>{'        '}{note}</Text>}
      </Box>
    )

    const contextNote = g.contextTokens !== undefined && g.contextWindow !== undefined
      ? `${compact(g.contextTokens)} of ${compact(g.contextWindow)} tokens`
      : g.contextWindow !== undefined ? `window ${compact(g.contextWindow)}` : ''

    const limits = ['five_hour', 'seven_day']
      .map(kind => g.limits.find(limit => limit.kind === kind))
      .concat(g.limits.filter(limit => !(limit.kind in LIMIT_LABELS)))

    const numWidth = 7
    const nameWidth = Math.max(8, width - numWidth * 3)
    const tokenRow = (key: string, name: string, input: number, cached: number, output: number, bold = false) => (
      <Box key={key} flexDirection="row">
        <Text bold={bold}>{fit(name, nameWidth)}</Text>
        <Text bold={bold}>{compact(input).padStart(numWidth)}</Text>
        <Text bold={bold} color="suggestion">{compact(cached).padStart(numWidth)}</Text>
        <Text bold={bold}>{compact(output).padStart(numWidth)}</Text>
      </Box>
    )
    const sum = (pick: (row: AgentTokens) => number) => rows.reduce((total, row) => total + pick(row), 0)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Session</Text>
          <Box flexDirection="row">
            <Text>{fit('Length', 8)}</Text>
            <Text>{lengthMs === undefined ? '—' : duration(lengthMs)}</Text>
          </Box>
          <Box flexDirection="row">
            <Text>{fit('Busy', 8)}</Text>
            <Text color={t.turnStartedAt !== undefined && t.waitingSince === undefined ? 'claude' : undefined}>
              {duration(busyMs)}
            </Text>
            {lengthMs !== undefined && lengthMs > 0 &&
              <Text dimColor> {`(${Math.round((busyMs / lengthMs) * 100)}% of the session)`}</Text>}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text bold>Context window</Text>
          {gauge('Used', g.contextPercent, contextNote)}
        </Box>

        <Box flexDirection="column">
          <Text bold>Plan usage limits</Text>
          {g.limits.length === 0
            ? <Text dimColor>No reading yet (shows after the first reply on a subscription).</Text>
            : limits.map((limit, i) =>
                limit === undefined
                  ? <Text key={`missing-${i}`} dimColor>{i === 0 ? '5-hour' : 'Weekly'}  no reading</Text>
                  : <Box key={limit.kind}>{gauge(LIMIT_LABELS[limit.kind] ?? limit.kind, limit.percentUsed, untilReset(limit.resetsAt))}</Box>)}
        </Box>

        <Box flexDirection="column">
          <Text bold>Tokens</Text>
          <Box flexDirection="row">
            <Text dimColor>{fit('agent', nameWidth)}</Text>
            <Text dimColor>{'input'.padStart(numWidth)}</Text>
            <Text dimColor>{'cached'.padStart(numWidth)}</Text>
            <Text dimColor>{'output'.padStart(numWidth)}</Text>
          </Box>
          {rows.length === 0 && <Text dimColor>No turns finished yet.</Text>}
          {rows.map(row => tokenRow(row.key, row.label, row.input + row.cacheWrite, row.cacheRead, row.output))}
          {rows.length > 1 &&
            tokenRow('total', 'Total', sum(r => r.input + r.cacheWrite), sum(r => r.cacheRead), sum(r => r.output), true)}
          <Text dimColor>input includes cache writes; cached = cache reads</Text>
        </Box>
      </Box>
    )
  })
}
