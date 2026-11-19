import { shellArgv } from './background'

export type LintRule = { files: string[]; command: string }

export type ChecksConfig = {
  enabled: boolean
  lint: LintRule[]
  suppressions: boolean
  excuses: boolean
  patterns: RegExp[]
  /** Globs where a new markdown file may appear without asking; null = no markdown check. */
  markdown: string[] | null
}

export const DEFAULT_MARKDOWN = [
  'docs/**',
  '.claude/**',
  '**/README.md',
  '**/CLAUDE.md',
  '**/AGENTS.md',
  '**/SKILL.md',
  'CHANGELOG.md',
  'LICENSE.md',
]

export const LINT_TIMEOUT_MS = 60_000
const REPORT_LINES = 30
const ANY_LOCATION = /[\w./-]+\.\w+["']?[:(, ]+(line\s+)?\d+/

export const SUPPRESSIONS: { name: string; re: RegExp }[] = [
  { name: 'eslint-disable', re: /eslint-disable/ },
  { name: '@ts-ignore', re: /@ts-ignore\b/ },
  { name: '@ts-expect-error', re: /@ts-expect-error\b/ },
  { name: '@ts-nocheck', re: /@ts-nocheck\b/ },
  { name: 'biome-ignore', re: /biome-ignore/ },
  { name: 'noqa', re: /#\s*noqa\b/i },
  { name: 'type: ignore', re: /#\s*type:\s*ignore\b/ },
  { name: 'pylint: disable', re: /pylint:\s*disable/ },
  { name: 'pyright: ignore', re: /pyright:\s*ignore/ },
  { name: 'ignore (Dart)', re: /\/\/\s*ignore(_for_file)?:/ },
  { name: '@warning_ignore', re: /@warning_ignore\b/ },
  { name: 'gdlint', re: /#\s*gdlint\s*:\s*(ignore|disable)/ },
  { name: 'nolint', re: /\/\/\s*nolint\b/i },
  { name: '#[allow]', re: /#!?\[allow\(/ },
  { name: '@SuppressWarnings', re: /@SuppressWarnings\b/ },
  { name: '@Suppress', re: /@Suppress\(/ },
  { name: 'swiftlint:disable', re: /swiftlint:disable/ },
  { name: 'rubocop:disable', re: /rubocop:disable/ },
  { name: 'NOLINT', re: /\bNOLINT(NEXTLINE)?\b/ },
  { name: 'pragma warning disable', re: /#\s*pragma\s+warning\s+disable/ },
  { name: 'phpstan-ignore', re: /@phpstan-ignore/ },
  { name: 'coverage ignore', re: /(istanbul|c8|v8)\s+ignore|pragma:\s*no\s*cover/ },
]

const COMMENT = /(\/\/|\/\*|^\s*\*|(^|\s)#(?![0-9a-fA-F]{3,8}\b)|<!--|(^|\s)--\s)(.*)$/
const EXCUSES = /\b(TODO|FIXME|HACK|XXX)\b|\b(workaround|work around|for now|temporar(y|ily)|quick fix|hacky|tymczasow\w*|obej(ś|s)ci\w*|na razie)\b/i

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|gd|dart|go|rs|swift|kt|kts|java|cs|c|cc|cpp|h|hpp|m|mm|rb|php|lua|sh|bash|zsh|sql|vue|svelte|scala|ex|exs|hx)$/i

export function parseChecks(text: string | null): ChecksConfig {
  const defaults: ChecksConfig = {
    enabled: true,
    lint: [],
    suppressions: true,
    excuses: true,
    patterns: [],
    markdown: DEFAULT_MARKDOWN,
  }
  if (!text || !text.trim()) return defaults
  let raw: unknown
  try {
    raw = (JSON.parse(text) as Record<string, unknown>).checks
  } catch {
    return defaults
  }
  if (raw === false) return { ...defaults, enabled: false }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  const c = raw as Record<string, unknown>
  const lint: LintRule[] = []
  for (const r of Array.isArray(c.lint) ? c.lint : []) {
    if (!r || typeof r !== 'object') continue
    const { files, command } = r as Record<string, unknown>
    const globs = (Array.isArray(files) ? files : [files]).filter((g): g is string => typeof g === 'string' && !!g.trim())
    if (globs.length && typeof command === 'string' && command.trim()) lint.push({ files: globs, command: command.trim() })
  }
  const patterns: RegExp[] = []
  for (const p of Array.isArray(c.patterns) ? c.patterns : []) {
    if (typeof p !== 'string') continue
    try {
      patterns.push(new RegExp(p))
    } catch {
      // an invalid pattern in the user's config is skipped, not fatal
    }
  }
  const md = c.markdown
  return {
    enabled: true,
    lint,
    suppressions: c.suppressions !== false,
    excuses: c.excuses !== false,
    patterns,
    markdown:
      md === false ? null : Array.isArray(md) ? md.filter((g): g is string => typeof g === 'string') : DEFAULT_MARKDOWN,
  }
}

export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] ?? ''
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

export function matchesAny(globs: readonly string[], rel: string): boolean {
  return globs.some(g => globToRegExp(g).test(rel))
}

/** Lines of `after` that `before` did not have (as many times), with 1-based line numbers in `after`. */
export function addedLines(before: string, after: string): { line: number; text: string }[] {
  const left = new Map<string, number>()
  for (const l of before.split('\n')) left.set(l, (left.get(l) ?? 0) + 1)
  const out: { line: number; text: string }[] = []
  after.split('\n').forEach((text, i) => {
    const n = left.get(text) ?? 0
    if (n > 0) left.set(text, n - 1)
    else if (text.trim()) out.push({ line: i + 1, text })
  })
  return out
}

export type Finding = { line: number; kind: 'suppression' | 'excuse'; what: string }

export function isCode(rel: string): boolean {
  return CODE_EXT.test(rel)
}

export function findIssues(rel: string, added: { line: number; text: string }[], c: ChecksConfig): Finding[] {
  if (!c.enabled || !CODE_EXT.test(rel)) return []
  const out: Finding[] = []
  for (const { line, text } of added) {
    const sup = c.suppressions ? SUPPRESSIONS.find(s => s.re.test(text)) : undefined
    const own = c.patterns.find(p => p.test(text))
    if (sup || own) {
      out.push({ line, kind: 'suppression', what: sup?.name ?? String(own) })
      continue
    }
    if (!c.excuses) continue
    const comment = COMMENT.exec(text)?.[0]
    const excuse = comment ? EXCUSES.exec(comment) : null
    if (excuse) out.push({ line, kind: 'excuse', what: excuse[0] })
  }
  return out
}

export function lintCommand(c: ChecksConfig, rel: string): string | null {
  const rule = c.enabled ? c.lint.find(r => matchesAny(r.files, rel)) : undefined
  if (!rule) return null
  const q = "'" + rel.replace(/'/g, "'\\''") + "'"
  return /\{files?\}/.test(rule.command) ? rule.command.replace(/\{files?\}/g, q) : `${rule.command} ${q}`
}

export function lintArgv(command: string): string[] {
  return shellArgv(command)
}

/**
 * Linter output reduced to problems on the changed lines of this file. Only when no output line names any
 * `file:line` location (a linter that reports otherwise) does the whole output count.
 */
export function lintProblems(output: string, rel: string, changed: readonly number[]): string[] {
  const base = rel.split('/').pop() ?? rel
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const loc = new RegExp(`(?:${esc(rel)}|${esc(base)})["']?[:(, ]+(?:line\\s+)?(\\d+)`)
  const lines = output.split('\n').filter(l => l.trim())
  const located = lines.map(l => ({ l, m: loc.exec(l) }))
  if (!located.some(x => x.m) && !lines.some(l => ANY_LOCATION.test(l))) return lines.slice(0, REPORT_LINES)
  const set = new Set(changed)
  return located.filter(x => x.m && set.has(Number(x.m[1]))).map(x => x.l).slice(0, REPORT_LINES)
}

export function checksNote(rel: string, findings: Finding[], lint: string[]): string | null {
  if (!findings.length && !lint.length) return null
  const parts: string[] = [`Kokpit checks on ${rel}:`]
  const sup = findings.filter(f => f.kind === 'suppression')
  const exc = findings.filter(f => f.kind === 'excuse')
  if (sup.length) {
    parts.push(
      `the change adds a checker suppression (${sup.map(f => `line ${f.line}: ${f.what}`).join('; ')}). ` +
        'Fix what the checker reports instead of silencing it. Keep a suppression only when the rule is wrong for ' +
        'this case or the cause is outside this code, and say why in your report.',
    )
  }
  if (exc.length) {
    parts.push(
      `the change adds a comment that reads like a workaround (${exc.map(f => `line ${f.line}: "${f.what}"`).join('; ')}). ` +
        'Solve the problem, or leave the code without the excuse and name the open issue in your report ' +
        '(a decision for the register if the Owner must choose).',
    )
  }
  if (lint.length) parts.push('the linter reports problems on the changed lines:\n' + lint.join('\n'))
  return parts.join('\n')
}

export function markdownAllowed(c: ChecksConfig, rel: string): boolean {
  if (!c.enabled || c.markdown === null || !/\.md$/i.test(rel)) return true
  return matchesAny(c.markdown, rel)
}

export const MARKDOWN_REASON =
  'Kokpit: a new markdown file outside the places this repo keeps documents. Knowledge belongs in an existing ' +
  'page, the progress file or the decision register; allow it only if you asked for this file.'
