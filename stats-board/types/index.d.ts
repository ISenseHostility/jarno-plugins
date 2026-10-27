export type AgentTokens = {
  key: string
  label: string
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  turns: number
}

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type Gauges = {
  contextPercent?: number
  contextTokens?: number
  contextWindow?: number
  limits: LimitWindow[]
}

/** Clock times are `$.clock.now()` milliseconds. */
export type Timing = {
  sessionStartedAt?: number
  /** Finished main-loop turns, less the time they waited on the person. */
  busyMs: number
  /** The main-loop turn running now, if any. */
  turnStartedAt?: number
  /** Waits on the person already closed in the running turn. */
  turnWaitMs: number
  /** Set while the running turn waits on the person. */
  waitingSince?: number
}

declare module 'claude-code' {
  interface PluginState {
    'stats-board': { agents: Shaped<AgentTokens[]>; gauges: Shaped<Gauges>; timing: Shaped<Timing> }
  }
}
