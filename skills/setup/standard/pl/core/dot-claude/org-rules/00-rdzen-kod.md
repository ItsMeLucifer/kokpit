---
status: org-rules
wersja: 1
rdzen: 0.12.0
wlasciciel: Właściciel (definicja w 10-projekt.md)
---

# 00 · Kod: przyczyny, komentarze, testy, dokumenty

Czytaj, gdy: piszesz albo przeglądasz kod, test lub dokument. Kokpit sprawdza część tego po każdej edycji (sekcja `checks` w .claude/kokpit.json); reszta zależy od ciebie.

## Naprawiaj przyczyny

1. Problem w naszym kodzie się naprawia, a nie tłumaczy. Żadnego komentarza usprawiedliwiającego obejście („na razie”, „tymczasowo”, „hack”, TODO bez właściciela) i żadnego wyłączenia sprawdzacza (`eslint-disable`, `@ts-ignore`, `# noqa`, `@warning_ignore` i podobne) dla problemu, którego kod mógłby uniknąć.
2. Wyłączenie zostaje tylko wtedy, gdy reguła nie pasuje do tego przypadku albo przyczyna leży poza naszym kodem, a jego linia mówi w kilku słowach, które z tych dwóch.
3. To, czego nie udało się naprawić, nazywasz w raporcie; wybór, który należy do Właściciela, idzie do rejestru decyzji. Ani jedno, ani drugie nie trafia do komentarza.

## Komentarze

4. Komentarz mówi to, czego kod nie powie: ograniczenie z zewnątrz (silnik, platforma, dostawca, protokół, dane zostawione przez starsze wersje), kontrakt publicznej funkcji albo typu, gdy nazwa i sygnatura go nie mówią, albo odsyłacz oszczędzający szukania („parsuje to X”, „trzymaj w zgodzie z Y”).
5. Bez narracji tego, co robi następna linia, bez historii zmiany, bez obrony własnego projektu: historia jest w gicie, decyzje projektowe w rejestrze albo wiki.
6. Niespodziankę w naszym kodzie przerabiasz (nazwa, typ, wydzielona funkcja), aż przestanie potrzebować komentarza.

## Testy

7. Test sprawdza zachowanie przez publiczny interfejs. Przyłóż go do dwóch wyobrażonych zmian: zepsuj zachowanie, a test musi paść; zmień tylko wnętrze, a test musi dalej przechodzić.
8. Test regresyjny na błąd jest mile widziany. Sprawdza zachowanie, które błąd zepsuł, na danych, które je zepsuły, a nie linię, którą zmieniłeś. Test, który tylko podbija pokrycie, się nie liczy.

## Dokumenty

9. Nowy plik markdown powstaje tylko tam, gdzie repo trzyma dokumenty (domyślnie `docs/`, `.claude/` i pliki README). Podsumowanie własnej pracy idzie do raportu, nie do pliku.
10. Dokument opisujący ograniczenie naszego kodu to błąd do naprawy albo wpis w rejestrze, nie strona wiki.

## Poprzeczka jakości

11. Plik projektu mówi, czy projekt albo jego obszar to prototyp, czy produkt. Prototyp pomija boilerplate, warstwy i szerokie testy, ale zachowuje jedno sprawdzenie, że działa; produkt dostaje pełną weryfikację. W obu przypadkach najmniejsza zmiana, która rozwiązuje problem, wygrywa z ogólną.
