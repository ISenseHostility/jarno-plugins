import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'stats-board',
  component: 'Pane',
  requestId: 'stats-board',
  props: {
    title: 'Stats',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 250_000, cache_creation_input_tokens: 800, model: 'claude-opus-5-5' }

test('the board shows context, limits and tokens per agent', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'stats-board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('agent.list', () => ({
    value: [{ id: 'sub1', description: 'Find the pane code', type: 'Explore', status: 'completed' }],
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await before.find({ type: 'Text', text: /No turns finished/ }))?.text).toBe('No turns finished yet.')
  await before.unmount()

  await $.session.measure({
    context: { window: 200_000, tokens: 124_000, percent: 62 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 31, resetsAt: new Date(Date.now() + 135 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 92.5 },
    ],
    changed: ['context', 'rateLimits'],
  })
  const turn = { answer: 'ok', durationMs: 1000, isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...turn, turnId: 't1', usage: USAGE })
  await $.turn.complete({ ...turn, turnId: 't2', usage: USAGE })
  await $.turn.complete({ ...turn, turnId: 't3', agentId: 'sub1', usage: USAGE })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const all = texts.join('\n')

    expect(all).toContain('62%')
    expect(all).toContain('124k of 200k tokens')
    expect(all).toContain('5-hour')
    expect(all).toContain('31%')
    expect(all).toMatch(/resets in 2h 1[45]m/)
    expect(all).toContain('93%')
    expect(all).toContain('Main')
    expect(all).toContain('Explore: Find the pane')
    // Main ran two turns: 2 × (1200 + 800) input, 2 × 250k cached, 2 × 3400 output.
    expect(texts).toContain('   4.0k')
    expect(texts).toContain('   500k')
    expect(texts).toContain('   6.8k')
    expect(all).toContain('Total')
    await ui.unmount()
  }
})

test('busy time leaves out the time a question waits on the person', async ($, on) => {
  const clock = mock.clock(on)
  const startedAt = clock.now()
  on('command.register', () => ({ value: { command: 'stats-board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt, context: { window: 200_000 }, rateLimits: [] } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', () => ({ sessionId: 's' }))
  let answer = () => {}
  on('tool.call', () => new Promise(resolve => { answer = () => resolve({ result: {} }) }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(60_000) // idle before the first prompt
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(10_000)
  const question = $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }],
  })
  await clock.advance(20_000) // the person thinks
  answer()
  await question
  await clock.advance(5_000)

  const live = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const liveText = (await live.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(liveText).toContain('1m 35s') // length: 60 + 10 + 20 + 5
  expect(liveText).toContain('0m 15s') // busy: 10 + 5, the 20 s wait left out
  await live.unmount()

  await $.turn.complete({ answer: 'ok', durationMs: 35_000, isAborted: false, reason: 'answer', turnId: 't1' })
  await clock.advance(30_000) // idle again: busy stays
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const afterText = (await after.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(afterText).toContain('2m 05s')
  expect(afterText).toContain('0m 15s')
  expect(afterText).toContain('(12% of the session)')
  await after.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  const cleared = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const clearedText = (await cleared.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(clearedText).toContain('0m 00s')
  expect(clearedText).toContain('No turns finished yet.')
  await cleared.unmount()
})
