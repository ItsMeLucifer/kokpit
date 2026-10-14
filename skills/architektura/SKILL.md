---
name: architektura
description: Przegląd architektury — szuka miejsc do pogłębienia modułów (płytkie moduły, przeciekające szwy, logika trudna do testowania) i pokazuje je w raporcie HTML z diagramami przed/po. Uruchamiaj ręcznie, w wolnej chwili albo gdy diagnoza wykazała brak szwu na test.
disable-model-invocation: true
argument-hint: "[obszar, np. core/battle; puste = gorące miejsca z historii gita]"
---

# Architektura: możliwości pogłębienia

Na podstawie `improve-codebase-architecture` i `codebase-design` z mattpocock/skills (MIT).

Obszar: $ARGUMENTS

## Słownik (używaj dokładnie tych słów)

- **Moduł** — wszystko z interfejsem i implementacją (funkcja, klasa, skrypt, zestaw skryptów).
- **Interfejs** — wszystko, co wywołujący musi wiedzieć: sygnatury, ale też niezmienniki, kolejność wywołań, tryby błędów, wymagana konfiguracja.
- **Głębokość** — ile zachowania dostaje wywołujący (i test) na jednostkę interfejsu. Głęboki: dużo za małym interfejsem. Płytki: interfejs prawie tak złożony jak implementacja.
- **Szew** — miejsce, gdzie można zmienić zachowanie bez edytowania w tym miejscu; tam żyje interfejs.
- **Adapter** — konkretna rzecz spełniająca interfejs na szwie (np. `SimBoard` jako adapter planszy dla Probierza).
- **Dźwignia** (dla wywołujących) i **lokalność** (dla utrzymujących: zmiana, błędy i wiedza w jednym miejscu).

Zasady: **test usunięcia** — wyobraź sobie usunięcie modułu; jeśli złożoność znika, był przelotką, jeśli wraca w N miejscach, zarabiał na siebie. **Interfejs jest powierzchnią testu** — chęć testowania „za” interfejsem znaczy, że moduł ma zły kształt. **Jeden adapter = szew hipotetyczny, dwa = prawdziwy** (gra + Probierz to wzorcowy prawdziwy szew w tym repo).

## Kroki

1. **Zakres.** Podany obszar albo gorące miejsca: `git log --name-only --since="6 weeks ago"` → pliki zmieniane najczęściej. Przeczytaj dokumenty obszaru w `docs/` i rozstrzygnięte decyzje w `docs/decyzje.md` — tych nie podważasz bez mocnego powodu.
2. **Eksploracja** w podagencie: gdzie zrozumienie jednej rzeczy wymaga skakania po wielu małych modułach; gdzie moduły są płytkie; gdzie czyste funkcje wydzielono „dla testów”, a błędy siedzą w sposobie wywołania; gdzie moduły przeciekają przez szwy; co jest nietestowane albo trudne do testowania przez obecny interfejs. Zastosuj test usunięcia do każdego podejrzanego.
3. **Raport HTML** w `$TMPDIR/architektura-<znacznik czasu>.html` (poza repo), otwórz go (`open`) i podaj ścieżkę. Na kandydata karta: pliki · problem · rozwiązanie (prozą) · korzyści w kategoriach dźwigni, lokalności i testów · diagram przed/po (Mermaid z CDN dla grafów zależności, ręczne SVG dla reszty) · siła rekomendacji: Mocna / Warto zbadać / Spekulatywna. Na końcu „Najpierw to” z uzasadnieniem. Nie proponuj jeszcze interfejsów.
4. **Zapytaj**, który kandydat zgłębić. Po wyborze: przejdź drzewo decyzji metodą `/grill` (ograniczenia, zależności, kształt pogłębionego modułu, co za szwem, które testy przetrwają). Jeśli trzeba porównać interfejsy — 3 podagenty równolegle, każdy z innym ograniczeniem (minimalny interfejs 1–3 wejścia; maksymalna elastyczność; najprostszy najczęstszy przypadek), potem porównanie pod kątem głębokości, lokalności i miejsca szwu. Odrzucenie kandydata z trwałym powodem → wpis do `docs/decyzje.md`, żeby kolejny przegląd go nie proponował.
