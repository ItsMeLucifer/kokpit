import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  addedLines,
  checksNote,
  findIssues,
  globToRegExp,
  lintCommand,
  lintProblems,
  markdownAllowed,
  parseChecks,
} from '../hooks/checks'
import { LESSONS_OFF_NOTE, parseQuality } from '../hooks/register'

const CONFIG = JSON.stringify({
  tests: 'npm test',
  checks: {
    lint: [
      { files: ['**/*.gd'], command: 'gdlint {file}' },
      { files: 'src/**/*.ts', command: 'npx eslint' },
    ],
    patterns: ['DIRTY_TRICK'],
    markdown: ['docs/**', '**/README.md'],
  },
})

test('config: defaults without a checks section, off with false, rules and globs parsed', () => {
  const none = parseChecks(null)
  expect(none.enabled && none.suppressions && none.excuses).toBe(true)
  expect(none.lint).toHaveLength(0)
  expect(none.markdown).toContain('docs/**')
  expect(parseChecks('{"checks": false}').enabled).toBe(false)
  expect(parseChecks('not json').enabled).toBe(true)
  const c = parseChecks(CONFIG)
  expect(c.lint.map(r => r.files)).toEqual([['**/*.gd'], ['src/**/*.ts']])
  expect(c.patterns[0]?.test('x = DIRTY_TRICK()')).toBe(true)
  expect(parseChecks('{"checks": {"markdown": false}}').markdown).toBeNull()
  expect(parseChecks('{"checks": {"patterns": ["("]}}').patterns).toHaveLength(0)
})

test('globs: ** spans directories, * stays in one', () => {
  expect(globToRegExp('**/*.gd').test('scenes/board/tile.gd')).toBe(true)
  expect(globToRegExp('**/*.gd').test('tile.gd')).toBe(true)
  expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
  expect(globToRegExp('docs/**').test('docs/x/y.md')).toBe(true)
})

test('added lines: only what the change introduced, with line numbers in the new text', () => {
  const before = 'a\n// eslint-disable-next-line\nb\n'
  const after = 'a\n// eslint-disable-next-line\nb\n// eslint-disable-next-line\nc\n'
  expect(addedLines(before, after)).toEqual([
    { line: 4, text: '// eslint-disable-next-line' },
    { line: 5, text: 'c' },
  ])
})

test('findings: suppressions in any language, excuses only inside comments, nothing for markdown', () => {
  const c = parseChecks(CONFIG)
  const lines = [
    { line: 1, text: '  // @ts-ignore' },
    { line: 2, text: 'x = 1  # type: ignore' },
    { line: 3, text: '@warning_ignore("unused_variable")' },
    { line: 4, text: '  // for now we skip the cache' },
    { line: 5, text: 'const forNow = "temporary"' },
    { line: 6, text: 'color = "#ffaa00"' },
    { line: 7, text: '# TODO: real fix' },
    { line: 8, text: 'y = DIRTY_TRICK()' },
  ]
  const f = findIssues('src/a.ts', lines, c)
  expect(f.map(x => [x.line, x.kind])).toEqual([
    [1, 'suppression'],
    [2, 'suppression'],
    [3, 'suppression'],
    [4, 'excuse'],
    [7, 'excuse'],
    [8, 'suppression'],
  ])
  expect(findIssues('docs/notes.md', lines, c)).toHaveLength(0)
  expect(findIssues('src/a.ts', lines, parseChecks('{"checks": {"excuses": false, "suppressions": false}}'))).toHaveLength(0)
})

test('lint: the matching rule, the file quoted, problems only on changed lines', () => {
  const c = parseChecks(CONFIG)
  expect(lintCommand(c, 'scenes/my tile.gd')).toBe("gdlint 'scenes/my tile.gd'")
  expect(lintCommand(c, 'src/x/y.ts')).toBe("npx eslint 'src/x/y.ts'")
  expect(lintCommand(c, 'README.md')).toBeNull()
  const out = [
    'scenes/tile.gd:3: Error: Function name "Foo" is not valid (function-name)',
    'scenes/tile.gd:40: Error: Max line length exceeded (max-line-length)',
    'Failure: 2 problems found',
  ].join('\n')
  expect(lintProblems(out, 'scenes/tile.gd', [40, 41])).toEqual(['scenes/tile.gd:40: Error: Max line length exceeded (max-line-length)'])
  expect(lintProblems(out, 'scenes/tile.gd', [10])).toEqual([])
  expect(lintProblems('Something broke', 'scenes/tile.gd', [1])).toEqual(['Something broke'])
  expect(lintProblems('/abs/path/src/y.ts(12,5): error TS2322', 'src/y.ts', [12])).toHaveLength(1)
})

test('the note: silent when clean, names lines and the way out otherwise', () => {
  expect(checksNote('a.ts', [], [])).toBeNull()
  const note = checksNote('a.ts', [{ line: 4, kind: 'suppression', what: '@ts-ignore' }], ['a.ts:9: bad'])
  expect(note).toContain('line 4: @ts-ignore')
  expect(note).toContain('Fix what the checker reports')
  expect(note).toContain('a.ts:9: bad')
})

test('markdown: allowed places pass, others ask, off when disabled', () => {
  const c = parseChecks(CONFIG)
  expect(markdownAllowed(c, 'docs/a.md')).toBe(true)
  expect(markdownAllowed(c, 'src/README.md')).toBe(true)
  expect(markdownAllowed(c, 'IMPLEMENTATION_SUMMARY.md')).toBe(false)
  expect(markdownAllowed(c, 'src/x.ts')).toBe(true)
  expect(markdownAllowed(parseChecks('{"checks": {"markdown": false}}'), 'NOTES.md')).toBe(true)
  expect(markdownAllowed(parseChecks(null), '.claude/handoffs/x.md')).toBe(true)
})

function project(on: On, files: Record<string, string>, lintOutput = '') {
  const runs: string[][] = []
  const mem: Record<string, unknown> = {}
  const rel = (path: string) => path.replace(/^\/p\//, '')
  on('store.get', (_$, e) => ({ value: mem[e.key] }))
  on('store.set', (_$, e) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.root', () => ({ value: '/p' }))
  on('session.cwd', () => ({ value: '/p' }))
  on('fs.exists', (_$, e) => ({ value: rel(e.path) in files }))
  on('fs.read', (_$, e) => {
    const text = files[rel(e.path)]
    if (text === undefined) throw new Error('ENOENT ' + e.path)
    return { value: text }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    return {
      value: { exitCode: lintOutput ? 1 : 0, stdout: lintOutput, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('tool.call', async (_$, e) => {
    const x = e as unknown as { tool: string; file_path: string; old_string?: string; new_string?: string; content?: string }
    const k = rel(x.file_path)
    if (x.tool === 'Write') files[k] = x.content ?? ''
    if (x.tool === 'Edit') files[k] = (files[k] ?? '').replace(x.old_string ?? '', x.new_string ?? '')
    return { result: {} as never }
  })
  on('tool.check', async () => ({ decision: 'allow' as const }))
  mock.clock(on, { now: Date.parse('2026-11-19T10:00:00Z') })
  return runs
}

const KOKPIT_JSON = JSON.stringify({ checks: { lint: [{ files: ['**/*.ts'], command: 'npx eslint {file}' }] } })

test('after an edit: a suppression and a lint problem on the changed line reach the model, clean edits stay silent', async ($, on) => {
  const files: Record<string, string> = {
    '.claude/kokpit.json': KOKPIT_JSON,
    'src/a.ts': 'const a = 1\nconst b = 2\n',
  }
  const runs = project(on, files, 'src/a.ts:2:7  error  b is never reassigned  prefer-const\nsrc/a.ts:1:1  error  old problem')
  const r = (await $.tool.call({
    tool: 'Edit',
    file_path: '/p/src/a.ts',
    old_string: 'const b = 2',
    new_string: '// @ts-ignore\nconst b = 2',
  } as never)) as { context?: string[] }
  const note = (r.context ?? []).join('\n')
  expect(note).toContain('line 2: @ts-ignore')
  expect(runs[0]?.join(' ')).toContain("npx eslint 'src/a.ts'")
  expect(note).not.toContain('old problem')

  const clean = (await $.tool.call({ tool: 'Write', file_path: '/p/src/b.ts', content: 'export const c = 3\n' } as never)) as {
    context?: string[]
  }
  expect(clean.context ?? []).toHaveLength(0)
  expect(runs).toHaveLength(2)
})

test('checks off in the config: nothing runs, nothing is said', async ($, on) => {
  const files: Record<string, string> = { '.claude/kokpit.json': '{"checks": false}', 'src/a.ts': '' }
  const runs = project(on, files, 'src/a.ts:1:1 error')
  const r = (await $.tool.call({ tool: 'Write', file_path: '/p/src/a.ts', content: '// eslint-disable\n' } as never)) as {
    context?: string[]
  }
  expect(r.context ?? []).toHaveLength(0)
  expect(runs).toHaveLength(0)
})

test('a new markdown file outside the document places asks the person; allowed places and existing files pass', async ($, on) => {
  project(on, { 'NOTES.md': 'old' })
  const ask = await $.tool.check({ tool: 'Write', input: { file_path: '/p/IMPLEMENTATION_SUMMARY.md', content: 'x' } } as never)
  expect(ask.decision).toBe('ask')
  expect(ask.reason).toContain('markdown')
  const docs = await $.tool.check({ tool: 'Write', input: { file_path: '/p/docs/new-page.md', content: 'x' } } as never)
  expect(docs.decision).toBe('allow')
  const existing = await $.tool.check({ tool: 'Write', input: { file_path: '/p/NOTES.md', content: 'x' } } as never)
  expect(existing.decision).toBe('allow')
})

const PANE_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 40,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 40, contentRows: 40 },
  view: 'main',
} as never

test('the Quality tab turns the checks off for the project, the other switches stay on', async ($, on) => {
  const files: Record<string, string> = { '.claude/kokpit.json': KOKPIT_JSON, 'src/a.ts': '' }
  const runs = project(on, files, 'src/a.ts:1:1 error')
  on('ui.open', () => ({ value: undefined as never }))
  on('command.run', async () => ({ text: '' }))
  await $.command.run({ command: 'kokpit', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'kokpit', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-panel' })
  await pane.press({ key: 'tab-quality' })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('linter on **/*.ts')
  expect(drawn).toContain('no feature map yet')
  await pane.press({ key: 'q-checks' })
  const r = (await $.tool.call({ tool: 'Write', file_path: '/p/src/a.ts', content: '// @ts-ignore\n' } as never)) as {
    context?: string[]
  }
  expect(r.context ?? []).toHaveLength(0)
  expect(runs.filter(x => x.join(' ').includes('eslint'))).toHaveLength(0)
  const ask = await $.tool.check({ tool: 'Write', input: { file_path: '/p/NOTES.md', content: 'x' } } as never)
  expect(ask.decision).toBe('allow')
  const after = JSON.stringify(await pane.drawn())
  expect(after).toContain('○ Off')
  expect(after).toContain('● On ')
})

test('help in the panel: explanations hidden by default, shown on demand', async ($, on) => {
  project(on, {})
  on('ui.open', () => ({ value: undefined as never }))
  on('command.run', async () => ({ text: '' }))
  const pane = await $.ui.mount({ plugin: 'kokpit', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'kokpit-panel' })
  expect(JSON.stringify(await pane.drawn())).not.toContain('Large tasks go to subagents')
  await pane.press({ key: 'kokpit-help' })
  expect(JSON.stringify(await pane.drawn())).toContain('Large tasks go to subagents')
})

test('quality settings: everything on unless stored off', () => {
  expect(parseQuality(undefined)).toEqual({ checks: true, verify: true, lessons: true })
  expect(parseQuality({ lessons: false })).toEqual({ checks: true, verify: true, lessons: false })
  expect(LESSONS_OFF_NOTE).toContain('Lessons for skills and checks')
})
