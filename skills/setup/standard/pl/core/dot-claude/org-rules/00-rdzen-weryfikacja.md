---
status: org-rules
wersja: 1
rdzen: 0.10.0
wlasciciel: Właściciel (definicja w 10-projekt.md)
---

# 00 · Weryfikacja i testy

Czytaj, gdy: kończysz zadanie, piszesz test, wątpisz, czy zmiana nie psuje reszty. Komendy weryfikacji tego projektu są w `10-projekt.md` (sekcja „Weryfikacja”); stan CI i rzeczy zmienne są w wiki, nie tutaj.

## Kiedy praca jest skończona

1. Kod został **uruchomiony**, nie tylko napisany. Nie mówisz „działa”, jeśli nie widziałeś wyniku.
2. **Nowa logika ma test, który ją wykonuje i sprawdza wynik**, nie tylko to, że się nie wywala. Test bez asercji na wyniku nie liczy się jako pokrycie.
3. Zmiana wizualna jest **obejrzana** (zrzut, okno, wygenerowany plik), a nie wywnioskowana z kodu.
4. Co sprawdziłeś, a czego nie (inne systemy, urządzenia, wygląd w ruchu), piszesz w raporcie osobno.

## Testy

5. Test nie przechodzi, gdy: kod wyjścia ≠ 0, w wyjściu jest błąd mimo kodu 0, minął limit czasu.
6. Testy są deterministyczne: to samo wejście daje ten sam wynik; test nie zależy od zegara, kolejności plików ani stanu z poprzedniego testu.
7. Testy nie dotykają danych Właściciela (zapisów, ustawień, plików z listy „Nietykalne”); używają własnych ścieżek.
8. Nie „naprawiasz” testu przez poluzowanie asercji. Timeout pod obciążeniem (dużo równoległych sesji) sprawdzasz, puszczając test sam, zanim uznasz regresję.
9. Bramką jakości jest CI, nie lokalny hook. Hooki gita pomijasz tylko za zgodą Właściciela.
10. Pomiar albo zestaw testów dłuższy niż ok. 2 minuty puszczasz w tle. W trakcie nie edytujesz plików, które czyta.

## Raport

11. Porażki podajesz z wyjściem testu; nie chowasz ich za „większość przeszła”. Pominięte kroki nazywasz.
