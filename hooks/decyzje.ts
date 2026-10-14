// Rejestr decyzji: jeden plik Markdown (domyślnie docs/decyzje.md), wpis na decyzję.
//
//   ## D-007 · Wejście w błoto bez kary
//   - status: czeka            (czeka | przyjęta | odrzucona | inaczej)
//   - typ: propozycja          (propozycja = Claude zdecydował, czeka na potwierdzenie; pytanie = otwarte)
//   - obszar: teren
//   - propozycja: Wejście w błoto nic nie kosztuje, płaci się wyjściem.
//   - źródło: claude/analiza_roguelike.md, docs/manual.md (Teren)
//   - dodano: 2026-10-12
//
// Po rozstrzygnięciu moduł dopisuje pola `rozstrzygnięto`, `odpowiedź` (przy „inaczej” albo
// z komentarzem) i `wprowadzono: nie`. Claude przenosi rozstrzygnięcie do dokumentów źródłowych
// i ustawia `wprowadzono: tak`.
//
// Same funkcje czyste — bez $, żeby dało się je testować i importować z modułu haków.

export type DecisionStatus = 'czeka' | 'przyjęta' | 'odrzucona' | 'inaczej'

export type Decision = {
  id: string
  title: string
  status: DecisionStatus
  fields: Record<string, string>
}

const HEADER = /^## (D-\d+) · (.+)$/
const FIELD = /^- ([^:]+):\s?(.*)$/

/** Wszystkie wpisy pliku, w kolejności z pliku. */
export function parseDecisions(text: string): Decision[] {
  const out: Decision[] = []
  let cur: Decision | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const h = HEADER.exec(line)
    if (h) {
      cur = { id: h[1] ?? '', title: (h[2] ?? '').trim(), status: 'czeka', fields: {} }
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
      cur.fields[key] = value
      if (key === 'status') cur.status = normStatus(value)
    }
  }
  return out
}

function normStatus(v: string): DecisionStatus {
  const s = v.toLowerCase()
  if (s.startsWith('przyj')) return 'przyjęta'
  if (s.startsWith('odrz')) return 'odrzucona'
  if (s.startsWith('inacz')) return 'inaczej'
  return 'czeka'
}

export function pending(ds: Decision[]): Decision[] {
  return ds.filter(d => d.status === 'czeka')
}

/** Rozstrzygnięte, ale jeszcze nie przeniesione do dokumentów źródłowych. */
export function toApply(ds: Decision[]): Decision[] {
  return ds.filter(d => d.status !== 'czeka' && (d.fields['wprowadzono'] ?? 'nie').toLowerCase() !== 'tak')
}

/**
 * Zapisuje rozstrzygnięcie w tekście pliku: podmienia `status` wpisu i dopisuje (albo
 * nadpisuje) pola rozstrzygnięcia. Reszta pliku zostaje bajt w bajt.
 */
export function resolveDecision(
  text: string,
  id: string,
  status: Exclude<DecisionStatus, 'czeka'>,
  date: string,
  answer?: string,
): string {
  const lines = text.split('\n')
  const start = lines.findIndex(l => HEADER.exec(l.replace(/\s+$/, ''))?.[1] === id)
  if (start < 0) throw new Error(`Nie ma wpisu ${id}`)
  let end = start + 1
  while (end < lines.length && !(lines[end] ?? '').startsWith('## ') && !(lines[end] ?? '').startsWith('# ')) end++
  // Ostatnia linia pola we wpisie — po niej dopisujemy, puste linie zostają na końcu.
  let lastField = start
  const set: Record<string, string> = {
    status,
    rozstrzygnięto: date,
    wprowadzono: 'nie',
  }
  if (answer && answer.trim()) set['odpowiedź'] = answer.trim().replace(/\s*\n\s*/g, ' ')
  const seen = new Set<string>()
  for (let i = start + 1; i < end; i++) {
    const f = FIELD.exec((lines[i] ?? '').replace(/\s+$/, ''))
    if (!f) continue
    lastField = i
    const key = (f[1] ?? '').trim().toLowerCase()
    if (key in set) {
      lines[i] = `- ${key}: ${set[key]}`
      seen.add(key)
    }
  }
  const extra = Object.keys(set)
    .filter(k => !seen.has(k))
    .map(k => `- ${k}: ${set[k]}`)
  lines.splice(lastField + 1, 0, ...extra)
  return lines.join('\n')
}

/** Polecenie dla Claude: przenieść rozstrzygnięcia do dokumentów źródłowych. */
export function applyPrompt(file: string, ds: Decision[]): string {
  const items = ds
    .map(d => {
      const answer = d.fields['odpowiedź'] ? ` — odpowiedź: „${d.fields['odpowiedź']}”` : ''
      return `- ${d.id} · ${d.title}: ${d.status}${answer} (źródło: ${d.fields['źródło'] ?? 'brak'})`
    })
    .join('\n')
  return (
    `Rejestr decyzji (${file}): użytkownik rozstrzygnął ${ds.length} ${ds.length === 1 ? 'pozycję' : 'pozycje'}:\n${items}\n\n` +
    'Przenieś każde rozstrzygnięcie do dokumentów źródłowych w repo (zamień „do potwierdzenia” na decyzję, ' +
    'przy odrzuconej opisz, co zostaje zamiast). Jeśli rozstrzygnięcie zmienia zachowanie gry, nie zmieniaj kodu — ' +
    `wypisz, co by trzeba zmienić, i zapytaj. Na koniec ustaw w ${file} „wprowadzono: tak” przy przeniesionych wpisach. ` +
    'Dokumentów projektu claude/*.md z claude.ai stąd nie zmienisz — wypisz, które trzeba zaktualizować w czacie.'
  )
}

/** Następny wolny numer wpisu (do podpowiedzi w prompcie). */
export function nextId(ds: Decision[]): string {
  const max = ds.reduce((m, d) => Math.max(m, Number(d.id.slice(2)) || 0), 0)
  return 'D-' + String(max + 1).padStart(3, '0')
}
