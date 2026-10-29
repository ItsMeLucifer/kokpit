---
status: org-rules
wersja: 1
rdzen: 0.10.0
wlasciciel: Właściciel (definicja w 10-projekt.md)
---

# 00 · Praca agentów

Czytaj, gdy: dzielisz zadanie na subagentów, pracujesz równolegle z innymi sesjami, raportujesz wynik albo Właściciela nie ma przy komputerze.

## Zakres i równoległość

1. Jedna sesja = jeden worktree i zakres plików. **Dwóch agentów nie edytuje tego samego pliku.** Integrację wyników, decyzje i końcową weryfikację zostawiasz sobie (główna rozmowa).
2. Duże zadanie (wiele plików albo niezależnych części) dzielisz na podzadania i niezależne części delegujesz równolegle. Drobiazgów (do ok. 3 kroków) nie delegujesz: subagent czyta pliki od nowa i wychodzi drożej.
3. **Polecenie dla subagenta jest samowystarczalne:** cel, pliki, kryteria odbioru, zakazy (`00-rdzen-bezpieczenstwo.md` i „Nietykalne” z `10-projekt.md`), „nie pytaj, zdecyduj i opisz”. Subagent nie widzi rozmowy, a wbudowane agenty Explore i Plan nie ładują `CLAUDE.md`.
4. Izolowany worktree subagenta startuje od zacommitowanego HEAD, nie od drzewa roboczego. Pracę zależną od niezacommitowanych zmian robisz w głównym worktree. Wyniki z izolowanych worktree zbierasz i sprawdzasz, zanim worktree usuniesz (`git -C <wt> status --porcelain`).
5. Agenty w tle przeżywają `/clear` i oddają raport do sesji, która je uruchomiła. Przed ponownym uruchomieniem sprawdzasz, czy poprzednie nie wróciły.

## Raport

6. Wynik subagenta to **twierdzenie do sprawdzenia**: zanim powiesz, że zrobione, sprawdzasz diff, uruchamiasz test albo zaglądasz w plik.
7. **Kto zrobił, ten nie odbiera.** Pracę o dużej stawce (zmiana przekrojowa, logika trudna do odwrócenia, wydanie) sprawdza ktoś inny niż jej autor: osobny agent (np. `/review`) dostaje diff i kryteria, nie Twoje wnioski. Agent chwali własną pracę; od tego jest drugi.
8. Raport rozróżnia: **zrobione i sprawdzone** (z dowodem), **zrobione, niesprawdzone**, **nie zrobione**, **pytania**. Co jest zrobione i sprawdzone, mówisz wprost, bez asekuracji.

## Gdy Właściciela nie ma

9. Nie zadajesz pytań, na które nie dostaniesz odpowiedzi: decydujesz w granicach tych zasad, a decyzję wpisujesz do rejestru jako propozycję, żeby Właściciel mógł ją zawetować. Trudne decyzje sprawdzasz kilkoma niezależnymi krytykami (dostają pliki i pytania, nie Twoje wnioski).
10. Pilnujesz limitu zużycia: przy dużej pracy kończysz handoffem, zanim limit się wyczerpie. Kolejność pracy jest taka, żeby po każdym kroku repo było spójne.
11. Operacje nieodwracalne (usunięcia, nadpisania, publikacje) bez wyraźnej zgody odkładasz i opisujesz w raporcie jako propozycję.

## Wątki

12. Wątek handoffu prowadzisz po każdym dłuższym kawałku pracy (`/handoff`); wiedzę trwałą z niego przenosisz do wiki albo reguł (`00-rdzen-wiedza.md`, zasada 2).
