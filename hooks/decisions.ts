// Decision register: one Markdown file (default docs/decisions.md), one entry per decision.
//
//   ## D-007 · No penalty for entering mud
//   - status: pending          (pending | accepted | rejected | changed)
//   - type: proposal           (proposal = Claude decided, waiting for confirmation; question = open)
//   - area: terrain
//   - proposal: Entering mud costs nothing; leaving it does.
//   - source: docs/terrain.md
//   - added: 2026-10-12
//
// After a ruling the module adds `resolved`, `answer` (for "changed" or with a comment) and
// `applied: no`. Claude then carries the ruling into the source documents and sets `applied: yes`.
//
// Registers written in Polish (`status: czeka`, `typ: propozycja`, `źródło`, …) are read as well, and an
// entry keeps the language it was written in when it is resolved. New entries follow the `language` setting.
//
// Pure functions only, so they can be tested and imported by the hooks module.

export type Language = 'en' | 'pl'
export type DecisionStatus = 'pending' | 'accepted' | 'rejected' | 'changed'

/** Canonical (English) field names used inside Kokpit. */
export type Field = 'status' | 'type' | 'area' | 'proposal' | 'question' | 'source' | 'added' | 'resolved' | 'answer' | 'applied'

export type Decision = {
  id: string
  title: string
  status: DecisionStatus
  /** Fields by canonical name. */
  fields: Partial<Record<Field, string>>
  language: Language
}

type Vocabulary = { fields: Record<Field, string>; status: Record<DecisionStatus, string>; yes: string; no: string }

export const VOCABULARY: Record<Language, Vocabulary> = {
  en: {
    fields: {
      status: 'status',
      type: 'type',
      area: 'area',
      proposal: 'proposal',
      question: 'question',
      source: 'source',
      added: 'added',
      resolved: 'resolved',
      answer: 'answer',
      applied: 'applied',
    },
    status: { pending: 'pending', accepted: 'accepted', rejected: 'rejected', changed: 'changed' },
    yes: 'yes',
    no: 'no',
  },
  pl: {
    fields: {
      status: 'status',
      type: 'typ',
      area: 'obszar',
      proposal: 'propozycja',
      question: 'pytanie',
      source: 'źródło',
      added: 'dodano',
      resolved: 'rozstrzygnięto',
      answer: 'odpowiedź',
      applied: 'wprowadzono',
    },
    status: { pending: 'czeka', accepted: 'przyjęta', rejected: 'odrzucona', changed: 'inaczej' },
    yes: 'tak',
    no: 'nie',
  },
}

const POLISH_ONLY = new Set(Object.values(VOCABULARY.pl.fields).filter(f => f !== 'status'))

function canonicalField(key: string): Field | null {
  for (const lang of ['en', 'pl'] as Language[]) {
    for (const [field, word] of Object.entries(VOCABULARY[lang].fields)) if (word === key) return field as Field
  }
  return null
}

const HEADER = /^## (D-\d+) · (.+)$/
const FIELD = /^- ([^:]+):\s?(.*)$/

/** All entries of the file, in file order. */
export function parseDecisions(text: string): Decision[] {
  const out: Decision[] = []
  let cur: Decision | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const h = HEADER.exec(line)
    if (h) {
      cur = { id: h[1] ?? '', title: (h[2] ?? '').trim(), status: 'pending', fields: {}, language: 'en' }
      out.push(cur)
      continue
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      cur = null
      continue
    }
    const f = cur ? FIELD.exec(line) : null
    if (cur && f) {
      const key = (f[1] ?? '').trim().toLowerCase()
      const value = (f[2] ?? '').trim()
      if (POLISH_ONLY.has(key)) cur.language = 'pl'
      const field = canonicalField(key)
      if (!field) continue
      cur.fields[field] = value
      if (field === 'status') cur.status = normStatus(value)
    }
  }
  return out
}

function normStatus(v: string): DecisionStatus {
  const s = v.toLowerCase()
  if (s.startsWith('accept') || s.startsWith('przyj')) return 'accepted'
  if (s.startsWith('reject') || s.startsWith('odrz')) return 'rejected'
  if (s.startsWith('chang') || s.startsWith('inacz')) return 'changed'
  return 'pending'
}

export function isQuestion(d: Decision): boolean {
  const t = (d.fields.type ?? '').toLowerCase()
  return t.startsWith('question') || t.startsWith('pyt')
}

export function pending(ds: Decision[]): Decision[] {
  return ds.filter(d => d.status === 'pending')
}

function isYes(v: string | undefined): boolean {
  const s = (v ?? '').toLowerCase()
  return s === 'yes' || s === 'tak'
}

/** Resolved, but not yet carried into the source documents. */
export function toApply(ds: Decision[]): Decision[] {
  return ds.filter(d => d.status !== 'pending' && !isYes(d.fields.applied))
}

/**
 * Writes a ruling into the file text: replaces the entry's `status` and adds (or overwrites) the ruling
 * fields, in the entry's own language. The rest of the file stays byte for byte.
 */
export function resolveDecision(
  text: string,
  id: string,
  status: Exclude<DecisionStatus, 'pending'>,
  date: string,
  answer?: string,
): string {
  const lines = text.split('\n')
  const start = lines.findIndex(l => HEADER.exec(l.replace(/\s+$/, ''))?.[1] === id)
  if (start < 0) throw new Error(`No entry ${id}`)
  let end = start + 1
  while (end < lines.length && !(lines[end] ?? '').startsWith('## ') && !(lines[end] ?? '').startsWith('# ')) end++
  const entry = parseDecisions(lines.slice(start, end).join('\n'))[0]
  const v = VOCABULARY[entry?.language ?? 'en']
  const set: Partial<Record<Field, string>> = { status: v.status[status], resolved: date, applied: v.no }
  if (answer && answer.trim()) set.answer = answer.trim().replace(/\s*\n\s*/g, ' ')
  // The last field line of the entry: new fields go after it, blank lines stay at the end.
  let lastField = start
  const seen = new Set<Field>()
  for (let i = start + 1; i < end; i++) {
    const f = FIELD.exec((lines[i] ?? '').replace(/\s+$/, ''))
    if (!f) continue
    lastField = i
    const field = canonicalField((f[1] ?? '').trim().toLowerCase())
    if (field && field in set) {
      lines[i] = `- ${v.fields[field]}: ${set[field]}`
      seen.add(field)
    }
  }
  const extra = (Object.keys(set) as Field[]).filter(k => !seen.has(k)).map(k => `- ${v.fields[k]}: ${set[k]}`)
  lines.splice(lastField + 1, 0, ...extra)
  return lines.join('\n')
}

/** Instruction for Claude: carry the rulings into the source documents. */
export function applyPrompt(file: string, ds: Decision[]): string {
  const items = ds
    .map(d => {
      const answer = d.fields.answer ? ` — answer: "${d.fields.answer}"` : ''
      return `- ${d.id} · ${d.title}: ${d.status}${answer} (source: ${d.fields.source ?? 'none'})`
    })
    .join('\n')
  return (
    `Decision register (${file}): the user resolved ${ds.length} ${ds.length === 1 ? 'entry' : 'entries'}:\n${items}\n\n` +
    'Carry each ruling into the source documents in the repo (replace "to be confirmed" with the decision; for a ' +
    'rejected one, describe what stays instead). If a ruling changes how the program behaves, do not change the ' +
    `code: list what would have to change and ask. Finally mark the carried entries in ${file} as applied, in ` +
    'the language each entry is written in.'
  )
}

/** Next free entry number (a hint in the prompt). */
export function nextId(ds: Decision[]): string {
  const max = ds.reduce((m, d) => Math.max(m, Number(d.id.slice(2)) || 0), 0)
  return 'D-' + String(max + 1).padStart(3, '0')
}

/** The entry format, spelled in the given language, for the system-prompt note. */
export function entryFormat(lang: Language): string {
  const v = VOCABULARY[lang]
  const f = v.fields
  return (
    `"## D-NNN · title", then the lines "- ${f.status}: ${v.status.pending}", "- ${f.type}: ` +
    `${lang === 'pl' ? 'propozycja|pytanie' : 'proposal|question'}", "- ${f.area}: …", "- ${f.proposal}: …" ` +
    `(or "- ${f.question}: …"), "- ${f.source}: files", "- ${f.added}: YYYY-MM-DD"`
  )
}
