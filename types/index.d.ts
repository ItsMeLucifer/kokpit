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
  /** „Wyczyść i wznów” przy pracy w tle (agenty, zadania) — /clear po ich wynikach, wątek najpierw dopisany. */
  clearWhenIdle: boolean
  /** Przy ilu tokenach był ostatni handoff w tej sesji (0 = jeszcze nie było). */
  lastTokens: number
  /** Ostatnia tura skończyła się pytaniem do użytkownika — miękki próg czeka na jego odpowiedź. */
  awaiting: boolean
}

/** Ostatnie odpowiedzi Claude w tej rozmowie (do pliku przy czyszczeniu). */
export type Answer = { at: string; text: string }

/** Stan narzędzi w bieżącym repo (panel /narzedzia). */
export type ToolsInfo = {
  /** graphify jest zainstalowany na tej maszynie. */
  graphifyInstalled: boolean
  /** Hooki graphify są w ustawieniach projektu (`graphify claude install`). */
  graphOn: boolean
  /** Udział kodu, który graphify czyta (0–1), albo null, gdy nie dało się policzyć. */
  share: number | null
  /** Ocena zestawu: graf ma sens w tym repo. */
  fits: boolean
  /** Skille ukryte przed modelem w tym repo (`skillOverrides` w .claude/settings.json). */
  hidden: string[]
  /** Skille z konta i ~/.claude/skills, które można ukryć w tym repo. */
  skills: { name: string; description: string }[]
}

/** Jeden handoff w dzienniku $.store (do /kokpit). */
export type HandoffLogEntry = {
  at: string
  tokens: number
  thread: string
  /** `dopisanie` = wątek dopisany przed czyszczeniem, bo przyszła wiadomość, a rozmowa poszła dalej od zapisu. */
  mode: 'przycisk' | 'przerwa' | 'auto' | 'dopisanie'
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
      /** Dwie ostatnie odpowiedzi Claude w tej rozmowie (bez tur handoffu). */
      answers: Answer[]
      /** Plik z odpowiedziami poprzedniej rozmowy (po automatycznym czyszczeniu), do przycisku i panelu. */
      previous: string | null
      /** Narzędzia w tym repo (panel /narzedzia), odświeżane przy otwarciu. */
      tools: ToolsInfo | null
      /** Id okna rozmowy dla kluczy magazynu, które przechodzą przez /clear (przeżywa przeładowanie kodu). */
      owner: string | null
    }
  }
}
