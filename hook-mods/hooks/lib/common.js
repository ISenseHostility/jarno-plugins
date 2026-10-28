// Shared helpers for the pet, achievements and minigame hooks.
// Everything here fails soft: hooks must never break a session.
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')

// `claude -p` and SDK runs (such as design-debate's opponent) set an sdk-* entrypoint.
const isHeadless = () => /^sdk-/.test(process.env.CLAUDE_CODE_ENTRYPOINT || '')

// Reads the hook's JSON input. Gives up after `ms` so a hook never hangs.
function readStdin(ms = 1500) {
  return new Promise((resolve) => {
    let data = ''
    const done = () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    }
    const timer = setTimeout(done, ms)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => { clearTimeout(timer); done() })
    process.stdin.on('error', () => { clearTimeout(timer); done() })
  })
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const text = JSON.stringify(value, null, 2)
  try {
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
  } catch {
    // Windows refuses the rename while a reader holds the file open.
    try { fs.unlinkSync(tmp) } catch {}
    fs.writeFileSync(file, text)
  }
}

// A tiny cross-process lock so parallel hooks don't lose each other's writes.
function withLock(file, fn, waitMs = 800) {
  const lock = `${file}.lock`
  const start = Date.now()
  let fd = null
  while (fd === null) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fd = fs.openSync(lock, 'wx')
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.unlinkSync(lock)
      } catch {}
      if (Date.now() - start > waitMs) break
      const until = Date.now() + 15
      while (Date.now() < until) { /* short spin, hooks are tiny */ }
    }
  }
  try { return fn() } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch {}
      try { fs.unlinkSync(lock) } catch {}
    }
  }
}

// The git repo root (nearest folder up holding .git), else the folder itself.
function projectRoot(cwd) {
  if (!cwd) return null
  let dir = path.resolve(cwd)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return path.resolve(cwd)
    dir = up
  }
}

// Control characters stripped so a name can't drive the terminal.
const clean = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '')

// Safe as an object key: a folder named __proto__ must not reach the prototype.
const safeKey = (s) => {
  const k = clean(s) || 'unknown'
  return ['__proto__', 'constructor', 'prototype'].includes(k) ? `${k}_` : k
}

function projectName(cwd) {
  const root = projectRoot(cwd)
  return safeKey(root ? path.basename(root) || root : 'unknown')
}

// ---- test runs -------------------------------------------------------------

const TEST_SEGMENT = new RegExp(
  '^(?:(?:npx|bunx|pnpx|uv\\s+run|poetry\\s+run|pipenv\\s+run|hatch\\s+run)\\s+)?(?:' + [
    '(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?test(?::\\S+)?\\b',
    '(?:npm|pnpm|yarn)\\s+t\\b',
    '(?:jest|vitest|mocha|ava|tap|karma|playwright\\s+test|cypress\\s+run)\\b',
    '(?:pytest|py\\.test|tox|nox)\\b',
    'python[\\d.]*(?:\\.exe)?\\s+-m\\s+(?:pytest|unittest)\\b',
    '(?:cargo|go|dotnet|flutter|dart|deno|mix|swift|zig)\\s+test\\b',
    '(?:\\.[\\\\/])?(?:mvnw?|gradlew?)(?:\\.cmd|\\.bat)?\\b.*\\b(?:test|check|verify)\\b',
    '(?:phpunit|rspec|ctest)\\b',
    '(?:bundle\\s+exec\\s+)?(?:rake|rails)\\s+(?:test|spec)\\b',
    'make\\s+(?:test|check)\\b',
    'claude\\s+plugin\\s+test\\b',
    'invoke-pester\\b',
  ].join('|') + ')',
  'i'
)

// Splits `a && b; c | d` into its commands and drops env assignments and `cd`.
function isTestCommand(command) {
  if (typeof command !== 'string') return false
  return command.split(/&&|\|\||;|\||\n/).some((part) => {
    const seg = part.trim().replace(/^(?:\w+=\S*\s+)+/, '').replace(/^(?:time|env)\s+/, '')
    return TEST_SEGMENT.test(seg)
  })
}

const FAIL_MARKERS = [
  /\b[1-9]\d* (?:failed|failing|failures?)\b/i,
  /\bTests?:\s+.*\b[1-9]\d* failed\b/i,
  /^\s*FAIL\s/m,
  /\bFAILED\b/,
  /\bBUILD FAILURE\b/,
  /\btest result: FAILED\b/,
  /\bSome tests failed\b/i,
  /\bTests? failed\b/i,
]

// 'pass' | 'fail' | null for a Bash tool result, from the hook input.
function testOutcome(input) {
  const cmd = input && input.tool_input && input.tool_input.command
  if (input.tool_name !== 'Bash' || !isTestCommand(cmd)) return null
  if (input.tool_input.run_in_background) return null
  if (input.hook_event_name === 'PostToolUseFailure') return input.is_interrupt ? null : 'fail'
  const r = input.tool_response || {}
  if (r.interrupted) return null
  if (typeof r.exitCode === 'number' && r.exitCode !== 0) return 'fail'
  if (typeof r.exit_code === 'number' && r.exit_code !== 0) return 'fail'
  const out = `${typeof r === 'string' ? r : ''}${r.stdout || ''}\n${r.stderr || ''}`
  return FAIL_MARKERS.some((re) => re.test(out)) ? 'fail' : 'pass'
}

// `.claude/last-test-result` in the project: "pass" or "fail" as the first word.
function readLastTestResult(cwd) {
  const root = projectRoot(cwd)
  if (!root) return null
  const file = path.join(root, '.claude', 'last-test-result')
  try {
    const stat = fs.statSync(file)
    const text = fs.readFileSync(file, 'utf8').trim()
    let status = null
    try {
      const j = JSON.parse(text)
      status = String(j.status || j.result || (j.success === true ? 'pass' : j.success === false ? 'fail' : ''))
    } catch {
      status = text.split(/\s+/)[0]
    }
    status = status.toLowerCase()
    const result = /^(pass|passed|ok|green|success|0)$/.test(status) ? 'pass'
      : /^(fail|failed|red|failure|error|1)$/.test(status) ? 'fail' : null
    return result && { result, ts: stat.mtimeMs, mine: text.includes('by=cc-hooks') }
  } catch { return null }
}

function writeLastTestResult(cwd, result, command) {
  const root = projectRoot(cwd)
  if (!root) return
  try {
    // A cloned repo could make .claude or the file a symlink to somewhere else: never write through one.
    const dir = path.join(root, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    if (fs.lstatSync(dir).isSymbolicLink()) return
    const realRoot = fs.realpathSync(root)
    if (fs.realpathSync(dir) !== path.join(realRoot, '.claude')) return
    const target = path.join(dir, 'last-test-result')
    try { if (!fs.lstatSync(target).isFile()) return } catch {}
    const cmd = String(command || '').replace(/\s+/g, ' ').slice(0, 200)
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0)
    const fd = fs.openSync(target, flags, 0o644)
    try { fs.writeSync(fd, `${result}\n${new Date().toISOString()} by=cc-hooks\n${cmd}\n`) } finally { fs.closeSync(fd) }
  } catch {}
}

// ---- desktop notifications --------------------------------------------------

// Windows 11 drops WinRT toasts from short-lived processes; a tray balloon from
// a hidden, detached PowerShell shows reliably (it shows as a toast on Win 11).
const BALLOON_PS = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle = $env:CC_TOAST_TITLE
$n.BalloonTipText = $env:CC_TOAST_TEXT
$n.Visible = $true
$n.ShowBalloonTip(8000)
Start-Sleep -Seconds 9
$n.Dispose()
`

function toast(title, text) {
  if (process.env.CC_NO_TOAST) return
  try {
    const { spawn } = require('child_process')
    const opts = { detached: true, stdio: 'ignore', windowsHide: true }
    let child
    if (process.platform === 'win32') {
      const encoded = Buffer.from(BALLOON_PS, 'utf16le').toString('base64')
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
        { ...opts, env: { ...process.env, CC_TOAST_TITLE: title, CC_TOAST_TEXT: text } })
    } else if (process.platform === 'darwin') {
      const q = (s) => JSON.stringify(String(s))
      child = spawn('osascript', ['-e', `display notification ${q(text)} with title ${q(title)}`], opts)
    } else {
      child = spawn('notify-send', [title, text], opts)
    }
    child.on('error', () => {})
    child.unref()
  } catch {}
}

module.exports = {
  CLAUDE_DIR, readStdin, readJSON, writeJSON, withLock,
  isHeadless, clean, safeKey, projectRoot, projectName, isTestCommand, testOutcome,
  readLastTestResult, writeLastTestResult, toast,
}
