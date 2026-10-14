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

/** Stan handoffu w tej sesji. */
export type Handoff = {
  /** Do ilu tokenów kontekstu handoff jest odłożony („Później”). */
  snoozedUntil: number
  /** Ścieżka wątku po ostatnim zapisie, dopóki użytkownik nie zdecyduje, co dalej. */
  savedPath: string | null
  /** Handoff się pisze (skill uruchomiony, plik jeszcze nie zapisany). */
  running: boolean
  /** Kiedy handoff ruszył (ms zegara silnika); pliki starsze od tego nie są jego zapisem. */
  startedAt: number
  /** Tura, w której wątek zapisano; każda późniejsza tura robi zapis nieaktualnym. */
  savedTurnId: string | null
  /** Rozmowa poszła dalej od zapisu — przed /clear trzeba dopisać handoff jeszcze raz. */
  stale: boolean
  /** Po udanym handoffie Kokpit sam robi /clear i wznawia (użytkownik już o to poprosił). */
  clearAfter: boolean
  /** Sesja jest w trybie planowania (zapis plików zablokowany) — handoff nie rusza. */
  planMode: boolean
  /** Handoff poproszony w trybie planowania — czeka na wyjście z niego. */
  afterPlan: boolean
  /** Przy ilu tokenach był ostatni handoff w tej sesji (0 = jeszcze nie było). */
  lastTokens: number
}

/** Jeden handoff w dzienniku $.store (do /kokpit). */
export type HandoffLogEntry = {
  at: string
  tokens: number
  thread: string
  mode: 'przycisk' | 'przerwa' | 'auto'
}

/** Zadanie w tle (testy, Probierz, komenda) — patrz hooks/tlo.ts. */
export type Job = {
  id: string
  label: string
  kind: 'testy' | 'probierz' | 'komenda'
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

/** Liczniki rejestru decyzji do paska. */
export type DecisionCounts = { pending: number; toApply: number }

declare module 'claude-code' {
  interface PluginState {
    kokpit: {
      usage: Usage | null
      tasks: Task[]
      handoff: Handoff
      /** Najnowszy wątek w projekcie (do przycisku „Wznów”), albo null. */
      resumable: string | null
      /** Zadania w tle tej sesji (ostatnie). */
      jobs: Job[]
      /** Ile decyzji czeka i ile rozstrzygniętych czeka na przeniesienie do dokumentów. */
      decisions: DecisionCounts | null
    }
  }
}
