import type { Register, EngineInterface } from 'claude-code'

// A finished turn shorter than this is one you were probably watching.
const LONG_TURN_MS = 20_000
// Two triggers for the same moment (a question also raising a Notification) show once.
const DEDUPE_MS = 5_000

// A tray balloon: Windows 11 drops WinRT toasts from short-lived processes, the
// balloon path shows reliably. The icon has to live while the balloon is up.
const BALLOON_PS = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle = $env:CC_NOTIFY_TITLE
$n.BalloonTipText = $env:CC_NOTIFY_TEXT
$n.Visible = $true
$n.ShowBalloonTip(8000)
Start-Sleep -Seconds 9
$n.Dispose()
`

// powershell -EncodedCommand takes base64 of UTF-16LE.
const encodePs = (script: string) => {
  let bytes = ''
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    bytes += String.fromCharCode(c & 0xff, c >> 8)
  }
  return btoa(bytes)
}

// Starts the balloon in a hidden child and returns at once, so no hook waits on it.
const LAUNCH_PS = `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encodePs(BALLOON_PS)}'`

const clip = (text: string, max = 180) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const DEFAULT_TITLE = 'Claude Code needs you'

let lastSentAt = 0
let title = DEFAULT_TITLE

// In an IntelliJ terminal: "Claude - <project>", the project being the nearest
// folder up from cwd that holds `.idea`, named by `.idea/.name` or else its folder.
async function titleFor($: EngineInterface, cwd: string) {
  if ((await $.env.get('TERMINAL_EMULATOR')) !== 'JetBrains-JediTerm') return DEFAULT_TITLE
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  for (let n = parts.length; n > 0; n--) {
    const dir = parts.slice(0, n).join('/')
    if (dir === '' || !(await $.fs.exists(`${dir}/.idea`))) continue
    const named = (await $.fs.exists(`${dir}/.idea/.name`))
      ? (await $.fs.read(`${dir}/.idea/.name`)).trim()
      : ''
    return `Claude - ${named || parts[n - 1]}`
  }
  return `Claude - ${parts[parts.length - 1] ?? 'Code'}`
}

async function desktop($: EngineInterface, text: string) {
  const now = Date.now()
  if (now - lastSentAt < DEDUPE_MS) return
  lastSentAt = now

  const body = clip(text.replace(/\s+/g, ' ').trim())

  try {
    if ((await $.env.get('OS')) === 'Windows_NT') {
      const ran = await $.process.run(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(LAUNCH_PS)],
        { env: { CC_NOTIFY_TITLE: title, CC_NOTIFY_TEXT: body }, timeoutMs: 15_000 },
      )
      if (ran.exitCode === 0) return
    }
    const sent = await $.ui.notify(body, { title })
    if (!sent.isSent) $.ui.toast(`${title}: ${body}`)
  } catch {
    $.ui.toast(`${title}: ${body}`)
  }
}

export const register: Register = on => {
  let notifiedTurn: string | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      title = await titleFor($, started.cwd)
    } catch {
      title = DEFAULT_TITLE
    }
    return started
  })

  // Permission prompts, MCP elicitations and the engine's own idle reminder.
  on('classic.Notification', async ($, e, next) => {
    const isIdle = e.notification_type === 'idle_prompt'
    if (!(isIdle && notifiedTurn !== undefined)) await desktop($, e.message)
    return next(e)
  })

  // The model asks a question: notify before the dialog blocks on the answer.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const first = e.questions[0]?.question ?? 'Claude has a question for you.'
    await desktop($, first)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) notifiedTurn = undefined
    return next(e)
  })

  // A long main-loop turn finished: Claude is waiting for your next prompt.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && e.durationMs >= LONG_TURN_MS) {
      notifiedTurn = e.turnId
      await desktop($, `Done after ${Math.round(e.durationMs / 1000)} s: ${e.answer || 'waiting for your reply.'}`)
    }
    return done
  })
}
