---
name: przeglad
description: Przegląd zmian w dwóch osiach równolegle — Standardy (czy kod trzyma zasady repo) i Specyfikacja (czy robi to, o co chodziło). Użyj przed commitem, po większej zmianie albo gdy użytkownik prosi o review zmian od jakiegoś punktu.
argument-hint: "[punkt odniesienia: commit, gałąź, HEAD~n; puste = niezacommitowane zmiany] [ścieżka specyfikacji]"
---

# Przegląd w dwóch osiach

Na podstawie `code-review` z mattpocock/skills (MIT), dostosowane do repo bez trackera zadań.

Argumenty: $ARGUMENTS

## 1. Ustal punkt odniesienia

- Podany commit/gałąź → `git diff <punkt>...HEAD` plus `git log <punkt>..HEAD --oneline`.
- Brak → zmiany niezacommitowane: `git diff HEAD` plus nowe pliki z `git status --short` (w tym repo praca często leży niezacommitowana — to jest domyślny przypadek, nie pytaj o punkt).

Sprawdź, że diff nie jest pusty, zanim uruchomisz agentów.

## 2. Źródła specyfikacji (pierwsze, które istnieje)

1. Ścieżka z argumentów.
2. Plik wątku z `.claude/handoffs/`, którego `sessions:` zawiera tę sesję (Cel, Decyzje, Następne kroki).
3. Rozstrzygnięte wpisy z `docs/decyzje.md` dotyczące zmienianych obszarów.
4. Dokument fazy w `docs/` pasujący do tematu zmian.
5. Brak → oś Specyfikacja zgłasza „brak specyfikacji” i nic więcej.

## 3. Źródła standardów

Każdy plik, który opisuje, jak pisać kod w tym repo — w Zavishy co najmniej: `AGENTS.md`, `.claude/CLAUDE.MD`, `docs/testing.md` (Zasady pisania testów), `docs/ui_skin.md` (tokeny: nowa liczba w UI = token `UiTokens`), `docs/zavisha_filozofia_determinizmu.md` (jedna kopia reguł walki dla gry i Probierza). Do tego zawsze **zapachy bazowe** niżej — to oceny, nie twarde naruszenia, a udokumentowany standard repo zawsze wygrywa.

Zapachy (Fowler): niejasna nazwa · zduplikowany kod · zazdrość o cudze dane · grupy danych wędrujące razem · prymityw zamiast typu domenowego · powtarzany `match`/`if` na tym samym typie · zmiana rozsiana po wielu plikach · plik zmieniany z wielu niezwiązanych powodów · spekulatywna ogólność · długie łańcuchy wywołań · pośrednik, który tylko deleguje.

## 4. Dwa agenty równolegle

Uruchom oba naraz, na pierwszym planie.

- **Standardy:** dostaje komendę diffu, listę commitów, listę plików standardów i pełną listę zapachów. Zadanie: per plik/fragment (a) naruszenia udokumentowanych standardów z cytatem zasady (plik + reguła), (b) zapachy z cytatem fragmentu; oddziel twarde naruszenia od ocen; pomiń to, co pilnują testy/narzędzia. Do 400 słów.
- **Specyfikacja:** dostaje komendę diffu, listę commitów i specyfikację. Zadanie: (a) czego specyfikacja chce, a nie ma albo jest w połowie, (b) co jest w diffie, a nikt o to nie prosił, (c) co wygląda na zrobione, ale źle. Cytat ze specyfikacji przy każdym punkcie. Do 400 słów.

## 5. Raport

`## Standardy` i `## Specyfikacja` osobno, bez scalania i przestawiania — kod może przejść jedną oś i oblać drugą. Na końcu jedna linia: liczba uwag w każdej osi i najpoważniejsza w każdej z nich (bez wybierania jednego zwycięzcy między osiami).
