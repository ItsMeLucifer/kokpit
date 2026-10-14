---
name: wznow
description: Wznawia pracę z wątku handoffu (.claude/handoffs/<wątek>.md) i przypina do niego bieżącą sesję. Użyj na początku nowej sesji, gdy użytkownik mówi „wznów”, „kontynuuj”, „gdzie skończyliśmy”, albo gdy Kokpit uruchomi go przyciskiem.
argument-hint: "[wątek, ścieżka albo id sesji; puste = najnowszy wątek]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/znajdz.sh *) Read
---

# Wznowienie z wątku

Wskazany wątek (puste = najnowszy): $ARGUMENTS

## Co jest na dysku

!`${CLAUDE_SKILL_DIR}/scripts/znajdz.sh ${CLAUDE_PROJECT_DIR} ${CLAUDE_SESSION_ID} $ARGUMENTS`

Skrypt już przypiął tę sesję do wybranego wątku (`sessions:`), więc `/handoff` w tej sesji dopisze do tego samego pliku.

## Kroki

1. **Przeczytaj plik wątku w całości.** Najważniejsze: Następne kroki, Decyzje, Próbowaliśmy i odpadło, Uwagi użytkownika i pułapki. Dziennik i Archiwum — tylko gdy czegoś brakuje.
2. **Sprawdź, czy jest aktualny.** Porównaj „Stan teraz” z tym, co pokazał skrypt (commity i zmiany od `updated`). Jeśli coś się rozjechało — powiedz co, w jednym zdaniu.
3. **Przeczytaj pliki z „Szybkiego startu”** w podanej kolejności. Nie czytaj na zapas całego repozytorium.
4. **Zgłoś się krótko** (do 6 linii): wątek, cel, stan w jednym zdaniu, otwarte pytania do użytkownika (jeśli są), krok 1.
5. **Działaj.** Jeśli krok 1 jest jednoznaczny, odwracalny i nie czeka na odpowiedź użytkownika — zacznij go od razu w tej samej odpowiedzi. Jeśli czeka na decyzję — zadaj jedno pytanie i stop.

## Zasady

- Decyzje „Użytkownik (…)” są zamknięte — nie otwieraj ich bez nowego powodu.
- „Próbowaliśmy i odpadło” to lista rzeczy, których **nie** powtarzasz.
- „Propozycja Claude, czeka na odpowiedź” to sprawy otwarte, nie ustalenia.
