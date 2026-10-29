export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = { id: string; subject: string; status: TaskStatus }

export type Usage = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  fiveHour: number | null
  fiveHourResetsAt: string | null
  week: number | null
  weekResetsAt: string | null
}

/** Handoff state in this session. */
export type Handoff = {
  /** Context tokens up to which the handoff is snoozed ("Later"). */
  snoozedUntil: number
  /** Thread path after the last save, until the user decides what comes next. */
  savedPath: string | null
  /** A handoff is being written (skill started, file not saved yet). */
  running: boolean
  /** When the handoff started (engine clock, ms); files older than this are not its save. */
  startedAt: number
  /** The turn that saved the thread; any later turn makes the save stale. */
  savedTurnId: string | null
  /** The conversation moved on since the save: the handoff must be refreshed before /clear. */
  stale: boolean
  /** After a successful handoff Kokpit runs /clear and resumes by itself (the user already asked). */
  clearAfter: boolean
  /** The session is in plan mode (file writes blocked): no handoff starts. */
  planMode: boolean
  /** A handoff was requested in plan mode and waits for plan mode to end. */
  afterPlan: boolean
  /** "Clear and resume" while background work runs: /clear after its results, thread refreshed first. */
  clearWhenIdle: boolean
  /** Context tokens at the last handoff in this session (0 = none yet). */
  lastTokens: number
  /** The last turn ended with a question to the user: the soft threshold waits for the answer. */
  awaiting: boolean
  /** What blocks clearing while waiting for background work (for the bar); absent = nothing. */
  busy?: string[]
}

/** Claude's latest answers in this conversation (written to a file when clearing). */
export type Answer = { at: string; text: string }

/** Tool state in the current repo (the /tools pane). */
export type ToolsInfo = {
  /** graphify is installed on this machine. */
  graphifyInstalled: boolean
  /** graphify hooks are in the project settings (`graphify claude install`). */
  graphOn: boolean
  /** Share of code graphify reads (0–1), or null when it could not be computed. */
  share: number | null
  /** The setup check says a graph makes sense in this repo. */
  fits: boolean
  /** Skills hidden from the model in this repo (`skillOverrides` in .claude/settings.json). */
  hidden: string[]
  /** Account skills and ~/.claude/skills that can be hidden in this repo. */
  skills: { name: string; description: string }[]
}

/** One handoff in the store log (for the stats in /kokpit). */
export type HandoffLogEntry = {
  at: string
  tokens: number
  thread: string
  /** `refresh` = the thread was refreshed before clearing because a message came after the conversation moved on. */
  mode: 'button' | 'break' | 'auto' | 'refresh'
}

/** A background job (tests, a named job, a command, the local model); see hooks/background.ts. */
export type Job = {
  id: string
  label: string
  kind: 'tests' | 'job' | 'command' | 'local'
  byClaude: boolean
  startedAt: number
  endedAt: number | null
  code: number | null
  total: number | null
  passed: number
  failed: number
  failedNames: string[]
  lastLine: string
  logPath: string | null
  hidden: boolean
}

/** Decision register counters for the bar. */
export type DecisionCounts = { pending: number; toApply: number }

/** Tab of the /kokpit pane. */
export type Tab = 'economy' | 'stats' | 'handoff'

declare module 'claude-code' {
  interface PluginState {
    kokpit: {
      usage: Usage | null
      tasks: Task[]
      handoff: Handoff
      /** The latest thread in the project (for the "Resume" button), or null. */
      resumable: string | null
      /** This session's background jobs (the latest few). */
      jobs: Job[]
      /** Pending decisions and resolved ones waiting to be carried into the documents. */
      decisions: DecisionCounts | null
      /** Claude's last two answers in this conversation (handoff turns excluded). */
      answers: Answer[]
      /** File with the previous conversation's answers (after an automatic clear), for the button and pane. */
      previous: string | null
      /** Tools in this repo (the /tools pane), refreshed when opened. */
      tools: ToolsInfo | null
      /** Conversation window id for store keys that survive /clear (outlives a code reload). */
      owner: string | null
      /** Background results held back because Claude is waiting for the user's answer. */
      inbox: InboxItem[]
      /** Economy in this conversation: settings and the current difficulty rating. */
      economy: EconomyState
      /** Economy stats for the project, or null before the first read. */
      economyStats: EconomyStats | null
      /** Weekly calibration (shared across projects) and plan, to turn savings into a share of the limit. */
      calibration: { calibration: Calibration; plan: Plan } | null
      /** Ollama models and whether opencode exists, or null before the check. */
      local: { models: string[]; opencode: boolean; ollama: boolean } | null
      /** Open tab of the /kokpit pane. */
      tab: Tab
    }
  }
}

/** A background result waiting for the user's answer (it is attached to it). */
export type InboxItem = { id: string; label: string; text: string }

/** Economy in this conversation. */
export type EconomyState = {
  /** Settings in effect in this conversation (loaded at start or after /clear: the prompt does not change mid-conversation). */
  active: EconomySettings
  /** Settings saved for the project (they differ from the active ones until the next conversation). */
  saved: EconomySettings
  /** Difficulty rating of the current request (from the rating tool), null = not rated yet. */
  rating: Rating | null
  reason: string
  /** Failed tool calls in this turn (each raises effort one level). */
  bumps: number
  /** The effort ceiling of the session and the effort sent with the last step. */
  ceiling: Level | null
  current: Level | null
}

/** Model effort level. */
export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** Difficulty rating the model reports with Kokpit's tool. */
export type Rating = 'simple' | 'medium' | 'hard'

/** Economy settings per project (Kokpit store, keyed by the project root). */
export type EconomySettings = {
  /** Large tasks are split across subagents, each with a model (Opus/Sonnet) and effort from the rubric. */
  split: boolean
  /** Main-conversation effort follows difficulty: start at the ceiling, step down after the rating. */
  effort: boolean
  /** Lowest level effort may drop to. */
  floor: Level
  /** Highest level: fixed (Kokpit may raise effort above the session setting) or "session" = the session setting. */
  ceiling: Level | 'session'
  /** Simple tasks go to a local Ollama model (text directly, code through opencode in a separate worktree). */
  local: boolean
  /** Ollama model name, e.g. glm-4.7-flash. */
  localModel: string
}

/** Economy stats for a project. */
export type EconomyStats = {
  since: string
  /** Main-conversation steps by effort: count and output tokens. */
  steps: Partial<Record<Level, { n: number; out: number }>>
  /** Steps that ran below the session ceiling. */
  lowered: number
  ratings: Partial<Record<Rating, number>>
  /** Subagents by "model/effort". */
  subagents: Record<string, number>
  /** Estimate: output tokens the lowered steps did not produce. */
  savedOutput: number
  /** The same in API dollars (a common measure across models). */
  savedEffortUsd: number
  /** Subagents under Economy: actual cost, and the same traffic on the conversation's model and effort. */
  subCost: number
  subBaseline: number
  /** Raw data for the estimate: output tokens of lowered steps, keyed "model|ceiling>level". */
  lowerings: Record<string, number>
  /** Steps on models missing from Kokpit's price list (priced as Opus 5.5). */
  unknownModels: number
}

/** Calibration: how many API dollars of measured usage made up how many percentage points of the week. */
export type Calibration = {
  cost: number
  percent: number
  samples: number
  /** The last weekly reading and the cost measured since it (until the next rise). */
  last: number | null
  accrued: number
}

/** Subscription plan: calibration and savings percentages are kept separately for each. */
export type Plan = 'pro' | 'x5' | 'x20'
