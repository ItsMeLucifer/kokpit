---
name: handoff
description: Zapisuje stan pracy do pliku wątku (.claude/handoffs/<wątek>.md), który ciągnie się przez kolejne sesje tego tematu, żeby świeża sesja po /clear podjęła pracę bez zgadywania. Zamiennik /compact. Użyj, gdy użytkownik mówi „handoff”, „zapisz stan”, „kończymy na dziś”, „kontekst się zapełnia”, albo gdy Kokpit uruchomi go przyciskiem lub automatycznie.
argument-hint: "[na czym ma się skupić następna sesja]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/stan.sh *) Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/check_handoff.py *) Read Write(.claude/handoffs/*) Edit(.claude/handoffs/*)
---

# Handoff — dopisanie sesji do wątku

Piszesz dla siebie z przyszłości: następna sesja nie widzi tej rozmowy, ma tylko plik wątku i repozytorium. Liczy się to, czego **nie da się odtworzyć z kodu**: decyzje, ślepe uliczki, liczby z pomiarów i to, co użytkownik poprawiał.

Jeden wątek = jeden temat pracy (np. `cutscenka-plauen`), jeden plik przez wszystkie sesje. Plik **rośnie**, a nie jest pisany od nowa — dzięki temu szczegóły nie giną przy kolejnych przekazaniach.

Fokus następnej sesji (może być pusty): $ARGUMENTS

## Stan projektu (zebrany przed startem skilla)

!`${CLAUDE_SKILL_DIR}/scripts/stan.sh ${CLAUDE_SESSION_ID} ${CLAUDE_PROJECT_DIR}`

## Kiedy nie pisać

- **Tryb planowania** (zapis plików zablokowany poza plikiem planu): nie zapisuj stanu sesji nigdzie, także nie do pliku planu. Powiedz jednym zdaniem, że handoff ruszy po wyjściu z trybu planowania, i wróć do pracy.

## Kroki

1. **Ustal wątek.**
   - Skrypt pokazał „WĄTEK TEJ SESJI: <plik>” → piszesz do tego pliku.
   - „brak” → jeśli temat tej sesji to ciąg dalszy któregoś wątku z listy, użyj go; inaczej załóż nowy: `.claude/handoffs/<krótki-slug-ascii>.md` (np. `teren-bloto`, `ui-karty`). W obu przypadkach dopisz `${CLAUDE_SESSION_ID}` do `sessions:` we frontmatterze.
   - Ta sesja dotyczyła dwóch niezależnych tematów → dwa wątki, każdy ze swoim kawałkiem.
2. **Przejrzyj całą rozmowę** według listy niżej, zanim cokolwiek napiszesz. Nie pisz z pamięci ostatnich kilku wiadomości.
3. **Zaktualizuj plik** według szablonu:
   - **Sekcje chronione** — Decyzje, Próbowaliśmy i odpadło, Uwagi użytkownika i pułapki: istniejące punkty zostają **słowo w słowo**, nowe dopisujesz na końcu sekcji. Punkt nieaktualny przenieś do `## Archiwum` w **pliku archiwum** `<wątek>.archiwum.md` (obok wątku) z dopiskiem „— zastąpione: <czym>, <data>”. Nigdy nie skracaj ani nie przeredagowuj starych punktów.
   - **Sekcje streszczane** — Cel, Stan teraz, Dowody i liczby, Otwarte pytania, Następne kroki, Szybki start: przepisz na aktualne.
   - **Dziennik** — dopisz jeden wpis na końcu (data, id sesji, 2–4 zdania). Starych nie ruszaj. W pliku wątku zostaje ostatnich 8 wpisów; starsze przenieś słowo w słowo na koniec `## Dziennik (starsze)` w pliku archiwum.
   - **Plik archiwum** tylko rośnie: dopisujesz na końcu jego sekcji, niczego w nim nie zmieniasz ani nie usuwasz. Nie ma go jeszcze, a jest co przenieść → załóż go z szablonu niżej. Wątek sprzed tego podziału (punkty w `## Archiwum` pliku wątku, ponad 8 wpisów Dziennika) przy tym handoffie odchudź tak samo.
   - **Zapisuj edycjami** (Edit): dopisz punkty na końcu sekcji chronionych, podmień całe sekcje streszczane. Całego istniejącego wątku nie przepisuj (Write) — to tysiące tokenów wyjścia i łatwo zgubić punkt. Write tylko dla nowego wątku albo nowego pliku archiwum.
   - Zaktualizuj `updated:` i `branch:`.
4. **Sprawdź** plik — z poprzednią wersją, jeśli skrypt zrobił kopię:
   `python3 ${CLAUDE_SKILL_DIR}/scripts/check_handoff.py <plik> --previous <kopia z .poprzednie/>`
   (dla nowego wątku bez `--previous`). Walidator sam czyta plik archiwum obok wątku i jego poprzednią kopię. Popraw każdy BŁĄD i sprawdź ponownie; UWAGI o rozmiarze i Archiwum potraktuj jako zadanie na ten handoff.
5. **Zakończ** krótko (bez streszczania pliku). Pierwsza linia odpowiedzi to dokładnie `Kokpit · handoff zapisany: <wątek>` — po tym znaczniku Kokpit w sesji nadrzędnej (gdy tę sesję ktoś uruchomił) pomija notatkę o tej turze zamiast ją komentować; jeśli kończysz turę przez `wrap_up`, recap też zaczyna się od tego znacznika. Dalej: ścieżka, wynik sprawdzenia, krok 1 z „Następnych kroków” i zdanie: „Następna wiadomość wyczyści rozmowę i wznowi wątek (albo `/clear`, potem `/wznow`).” Wyjątek: gdy w tle pracują jeszcze agenty albo komendy tej sesji, napisz, że czyszczenie poczeka na ich wyniki (przepadłyby), a wyniki dopisz potem do wątku. Nie zaczynaj nowej pracy po handoffie.

## Lista do przejrzenia rozmowy

- Jaki był cel na początku i czy się zmienił po drodze?
- Co jest zrobione **i sprawdzone** (test, render, zrzut, uruchomienie), a co zrobione, ale niesprawdzone?
- Co jest w połowie (które pliki, w jakim stanie)?
- Które decyzje podjął **użytkownik** (jego słowami), a które to propozycje Claude, na które jeszcze nie odpowiedział?
- Co próbowaliśmy i porzuciliśmy — i dlaczego? (To najdroższa wiedza do odtworzenia.)
- Jakie liczby padły: wyniki testów, pomiary, rozmiary, czasy, procenty?
- Co użytkownik poprawiał, czego nie chciał, jakie ma preferencje w tym zadaniu?
- Jakie pułapki środowiska wyszły (zerwane połączenie z narzędziem, ścieżki, uprawnienia, cache, import)?
- Które pliki i dokumenty następna sesja musi przeczytać — w jakiej kolejności?
- Jakie pytania czekają na odpowiedź użytkownika? Co blokuje?

## Szablon (nowy wątek)

```markdown
---
thread: <slug>
sessions: [${CLAUDE_SESSION_ID}]
updated: <RRRR-MM-DD GG:MM>
branch: <gałąź albo none>
---

# <temat wątku w kilku słowach>

## Cel
<1–2 zdania: co ta praca ma osiągnąć i po czym poznać, że skończona.>

## Stan teraz
- Zrobione i sprawdzone: <co — czym sprawdzone>
- Zrobione, niesprawdzone: <co — czego brakuje do sprawdzenia>
- W toku: <plik/miejsce — w jakim stanie zostało>
- Repozytorium: <gałąź, ile plików zmienionych, czy coś zacommitowane>

## Decyzje
- Użytkownik (<data>): <decyzja> — „<jego słowa, jeśli padły>”
- Propozycja Claude, czeka na odpowiedź (<data>): <propozycja>

## Próbowaliśmy i odpadło
- <podejście> → <co się stało> → <dlaczego porzucone>

## Uwagi użytkownika i pułapki
- <preferencja, korekta, rzecz, której nie chce>
- <pułapka środowiska i jak ją obejść>

## Dowody i liczby
- <testy x/y, pomiary, wartości przed → po>

## Otwarte pytania
- <pytanie do użytkownika albo bloker> (albo „brak”)

## Następne kroki
1. <pierwsza konkretna czynność — da się wykonać od razu>
2. <...>

## Szybki start
- Przeczytaj: <plik/dokument> (po co)
- Uruchom: `<komenda>` (co ma wyjść)
- Przydatne skille/narzędzia: <...>

## Dziennik
- <RRRR-MM-DD GG:MM> · <id sesji> — <2–4 zdania: co zrobiono w tym odcinku>

## Archiwum
- brak (nieaktualne punkty i starsze wpisy Dziennika idą do `<slug>.archiwum.md`)
```

## Szablon (plik archiwum `<slug>.archiwum.md`)

```markdown
# Archiwum wątku <slug>

Punkty i wpisy przeniesione z `<slug>.md`, słowo w słowo. Tylko dopisywane; `/wznow` czyta ten plik dopiero, gdy czegoś brakuje.

## Archiwum
- <punkt sekcji chronionej> — zastąpione: <czym>, <data>

## Dziennik (starsze)
- <najstarszy wpis Dziennika, słowo w słowo>
```

## Zasady

- **Nie zmyślaj.** Czego nie wiesz na pewno, oznacz „[niesprawdzone]”. Handoff z wiarygodnie brzmiącymi zgadywankami jest gorszy niż brak handoffu.
- **Pochodzenie decyzji.** Twoja propozycja nie jest decyzją użytkownika, nawet jeśli odpowiedział „ok” na całą listę — zapisz, na co faktycznie się zgodził. Gdy propozycję zatwierdzi, dopisz nowy punkt „Użytkownik (<data>): …”, a stary przenieś do Archiwum.
- **Wskazuj, nie przepisuj.** Jeśli coś jest w dokumencie, pliku albo commicie — podaj ścieżkę/nazwę, nie kopiuj treści. Trwałe ustalenia projektu i tak powinny trafić do dokumentów projektu; wątek ma na nie wskazywać.
- **Konkret zamiast przymiotników.** „test_terrain 244/244” zamiast „testy przechodzą”; „ścieżka X” zamiast „ten plik”.
- **Zwięźle w sekcjach streszczanych** (razem do ok. 1000 słów). Sekcje chronione mogą rosnąć — to ich zadanie; plik wątku trzymaj poniżej ~20 KB (czytany w całości przy każdym `/wznow`), resztę niesie plik archiwum.
- **Bez sekretów.** Klucze, tokeny, hasła, dane osobowe — zamaskuj (`sk-…XXXX`) albo pomiń.
- Pisz po polsku, chyba że rozmowa szła w innym języku.
