import type { Automation, HandoffSettings, PausedAgent, PausedRecord } from '../types'

/** Paused background agents per thread, `<thread>.json`, in the main checkout. */
export const PAUSED_DIR = '.claude/kokpit/paused'
/** The prompt the model passes to restart a paused agent; Kokpit swaps it for the original brief. */
export const RESUME_MARK = 'kokpit-resume:'

export const HANDOFF_SETTINGS_0: HandoffSettings = { level: null, soft: null, critical: null }
export const LEVELS: Automation[] = ['manual', 'assisted', 'automatic']
export const SOFT_CHOICES = [150_000, 200_000, 300_000, 400_000]
export const CRITICAL_CHOICES = [400_000, 500_000, 600_000, 700_000]

/** Never later than at 75% of the window: the engine's auto-compact comes around 95%. */
const WINDOW_CAP = 0.75
/** Critical threshold cap, as a fraction of the context window. */
const CRITICAL_CAP = 0.85
/** Default critical threshold = clear threshold + this many tokens. */
export const CRITICAL_EXTRA = 100_000

const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)

export function parseHandoffSettings(raw: unknown): HandoffSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  // 0.15–0.16 stored a switch `autoClear`.
  const level = LEVELS.includes(r.level as Automation) ? (r.level as Automation) : r.autoClear === true ? 'automatic' : null
  return { level, soft: positive(r.soft), critical: positive(r.critical) }
}

export type Flow = {
  level: Automation
  /** When a handoff starts by itself: never, after a finished task, or (plugin setting only) the first quiet turn. */
  mode: 'button' | 'break' | 'auto'
  /** After the save: your next message clears, or only the button. */
  clearMode: 'message' | 'button'
  /** Clears and resumes without a message, and pauses background agents past the critical threshold. */
  autoClear: boolean
}

/** What the chosen level means; without a choice, the plugin settings decide. */
export function flowOf(level: Automation | null, config: { mode: Flow['mode']; clearMode: Flow['clearMode'] }): Flow {
  if (level === 'manual') return { level, mode: 'button', clearMode: 'button', autoClear: false }
  if (level === 'assisted') return { level, mode: 'break', clearMode: 'message', autoClear: false }
  if (level === 'automatic') return { level, mode: 'break', clearMode: 'message', autoClear: true }
  const guess: Automation = config.mode === 'button' ? 'manual' : 'assisted'
  return { level: guess, mode: config.mode, clearMode: config.clearMode, autoClear: false }
}

/** Clear threshold: the setting, but never beyond 75% of the model's window. */
export function thresholdFor(setting: number, window: number): number {
  return Math.min(setting, Math.floor(window * WINDOW_CAP))
}

/** Critical threshold: the setting (0 = soft + CRITICAL_EXTRA), at most 85% of the window, never below soft. */
export function hardThresholdFor(soft: number, setting: number, window: number): number {
  const wanted = setting > 0 ? setting : soft + CRITICAL_EXTRA
  return Math.max(soft, Math.min(wanted, Math.floor(window * CRITICAL_CAP)))
}

/** Both thresholds for this window: the panel's choice first, then the plugin settings. */
export function thresholds(
  s: HandoffSettings,
  config: { soft: number; hard: number },
  window: number,
): { soft: number; critical: number } {
  const soft = thresholdFor(s.soft ?? config.soft, window)
  return { soft, critical: hardThresholdFor(soft, s.critical ?? config.hard, window) }
}

/** The agent id in a restart marker, or null. */
export function markerId(prompt: string): string | null {
  const m = new RegExp('^\\s*' + RESUME_MARK + '\\s*(\\S+)\\s*$').exec(prompt)
  return m ? (m[1] ?? null) : null
}

/** The brief of a paused agent with a note to continue from its draft. */
export function continuePrompt(a: PausedAgent): string {
  const files = a.files.length ? ` Files it had changed: ${a.files.slice(0, 20).join(', ')}.` : ''
  return (
    (a.prompt ?? '') +
    '\n\n---\nKokpit: an earlier run of this task was stopped before it finished (the parent conversation was ' +
    'cleared to free its context). Continue from where it stopped: first look at the current state of the files ' +
    `this task owns (git status and git diff in your working directory).${files} Keep what is done and correct, ` +
    'do not start over and do not redo finished parts. Report as the brief asks.'
  )
}

/** The note for /resume: restart each resumable agent with its marker, list the rest. */
export function pausedNote(r: PausedRecord): string {
  const ok = r.agents.filter(a => a.prompt !== null && !a.fork)
  const lost = r.agents.filter(a => a.prompt === null || a.fork)
  const lines = [
    '',
    '## Background work Kokpit paused for the clear',
    '',
    `Before it cleared the conversation (${r.at.slice(0, 16).replace('T', ' ')}), Kokpit stopped background work of this thread.`,
  ]
  if (ok.length) {
    lines.push(
      'Before step 4, start each agent below again: one Agent call per agent, `run_in_background: true`, ' +
        '`description` and `subagent_type` as listed, and as `prompt` only the marker. Kokpit puts the original brief ' +
        'back, with a note to continue from the draft. Do not do their work yourself; their results arrive as usual. ' +
        'Notices that these agents were stopped may still come in: ignore them.',
      '',
      ...ok.map(
        a =>
          `- prompt \`${RESUME_MARK}${a.id}\` · description "${a.description}" · subagent_type \`${a.subagentType}\`` +
          (a.files.length ? ` · had changed: ${a.files.slice(0, 6).join(', ')}` : ''),
      ),
    )
  }
  if (lost.length) {
    lines.push(
      '',
      'Stopped and not restartable as they were (a fork, or started before Kokpit saw it): decide from the thread whether to start them anew.',
      ...lost.map(a => `- ${a.description || a.subagentType}` + (a.files.length ? ` (had changed: ${a.files.slice(0, 6).join(', ')})` : '')),
    )
  }
  if (r.commands.length) {
    lines.push('', 'Background commands that were running (their output is lost; run them again if still needed):', ...r.commands.map(c => `- ${c}`))
  }
  return lines.join('\n')
}

/** The record after one agent was restarted; null when nothing is left to restart. */
export function afterRestart(r: PausedRecord, id: string): PausedRecord | null {
  const agents = r.agents.filter(a => a.id !== id)
  return agents.some(a => a.prompt !== null && !a.fork) ? { ...r, agents } : null
}
