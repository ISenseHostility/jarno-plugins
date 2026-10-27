import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const QUESTION = {
  tool: 'AskUserQuestion' as const,
  questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }],
}

// A Windows machine whose files are `files`; returns the env each notification ran with.
function world(on: On, env: Record<string, string>, files: Record<string, string>) {
  const sent: Record<string, string>[] = []
  mock.env(on, { OS: 'Windows_NT', ...env })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  // The engine hands fs hooks native paths (backslashes on Windows).
  const slash = (path: string) => path.replace(/\\/g, '/')
  on('fs.exists', (_, e) => ({ value: slash(e.path) in files }))
  on('fs.read', (_, e) => ({ value: files[slash(e.path)] ?? '' }))
  on('process.run', (_, e) => {
    sent.push({ ...e.init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return sent
}

test('an IntelliJ terminal titles it with the project folder', async ($, on) => {
  const sent = world(on, { TERMINAL_EMULATOR: 'JetBrains-JediTerm' }, { 'C:/Users/me/IdeaProjects/lyricle/.idea': '' })
  await $.session.start({ cwd: String.raw`C:\Users\me\IdeaProjects\lyricle\backend`, surface: 'terminal', isInteractive: true })
  await $.tool.call(QUESTION)
  expect(sent[0]?.CC_NOTIFY_TITLE).toBe('Claude - lyricle')
  expect(sent[0]?.CC_NOTIFY_TEXT).toBe('Which?')
})

test('a project renamed in IntelliJ uses .idea/.name', async ($, on) => {
  const sent = world(on, { TERMINAL_EMULATOR: 'JetBrains-JediTerm' }, {
    'C:/work/repo/.idea': '',
    'C:/work/repo/.idea/.name': 'Lyricle App\n',
  })
  await $.session.start({ cwd: String.raw`C:\work\repo`, surface: 'terminal', isInteractive: true })
  await $.tool.call(QUESTION)
  expect(sent[0]?.CC_NOTIFY_TITLE).toBe('Claude - Lyricle App')
})

test('another terminal keeps the default title', async ($, on) => {
  const sent = world(on, {}, { 'C:/work/repo/.idea': '' })
  await $.session.start({ cwd: String.raw`C:\work\repo`, surface: 'terminal', isInteractive: true })
  await $.tool.call(QUESTION)
  expect(sent[0]?.CC_NOTIFY_TITLE).toBe('Claude Code needs you')
})
