---
name: retro
description: Retrospektywa sesji — co w środowisku pracy (instrukcje, testy, narzędzia, skille, dokumenty) poprawić, żeby następna sesja poszła lepiej. Uruchamiaj ręcznie po sesji, zwłaszcza takiej, która poszła bokiem.
disable-model-invocation: true
argument-hint: "[sesja albo wątek handoffu; puste = bieżąca]"
---

# Retro

Na podstawie `retro` z mattpocock/skills (MIT). Poprawiasz **środowisko**, nie kod.

Zakres: $ARGUMENTS (puste = ta sesja; wątek = plik z `.claude/handoffs/`, w tym „Próbowaliśmy i odpadło” i „Uwagi użytkownika i pułapki”).

## Gdzie szukać

Przejdź przez sesję i dla każdej kategorii znajdź konkretne przypadki z tej sesji (cytat albo krok), nie ogólniki:

- **Nawigacja** — gdzie szukanie pliku/informacji trwało długo? Czy jedna linia-wskaźnik w `AGENTS.md`/`.claude/CLAUDE.MD` albo w dokumencie by to skróciła?
- **Automatyczne sprawdzenia** — jaki błąd z tej sesji złapałby test, skrypt `--check`, walidator albo hook? Najpierw sprawdź, czy taki test już istnieje i tylko nie jest podpięty (`tools/testing/run_tests.py`, `test_pillar`, `build_frames.py --check`) — to jest znalezisko, nie pisanie od nowa.
- **Standardy** — czy błąd był mechaniczny (wzorzec, zakazane API, miejsce pliku)? Wtedy sprawdzenie w kodzie, nie zasada w dokumencie. Zasada w dokumencie tylko dla ocen, których nie da się zautomatyzować.
- **Instrukcje stałe** — co w `AGENTS.md`/`.claude/CLAUDE.MD` nie zmienia zachowania (no-op), jest nieaktualne albo powinno być skillem ładowanym na żądanie?
- **Ekonomia narzędzi** — które wywołania były drogie (długie odczyty, pełne testy zamiast jednego, Probierz na pierwszym planie zamiast `/probierz` w tle)?
- **Dostęp do informacji** — czego zabrakło (log gry, zrzut, wyjście Godota, stan Blendera)? Jak to dać na stałe?
- **Pułapki powtarzalne** — co użytkownik musiał poprawiać więcej niż raz? Kandydat do sekcji „Uwagi” w wątku albo do instrukcji stałych.

## Wynik

Lista kandydatów od najpoważniejszego. Przy każdym: co się stało (konkret z sesji), proponowana zmiana (gotowy fragment albo diff), gdzie (plik), i czy to sprawdzenie automatyczne czy tekst. Nic nie wprowadzasz bez zgody — użytkownik wybiera numery.
