---
name: diagnoza
description: Pętla diagnozy trudnych błędów i regresji wydajności. Użyj, gdy coś jest zepsute, rzuca błędem, nie przechodzi, działa inaczej w grze niż w Probierzu albo zwolniło — zanim zaczniesz zgadywać przyczynę.
---

# Diagnoza

Dyscyplina na trudne błędy. Fazę pomijasz tylko z podanym powodem.

Na podstawie `diagnosing-bugs` z mattpocock/skills (MIT), dostosowane do Godota i Zavishy.

## Faza 1: pętla, która świeci na czerwono

**To jest cały skill.** Z ciasną pętlą (jedna komenda, która robi się *czerwona* na *tym* błędzie) przyczyna się znajdzie; bez niej żadne czytanie kodu nie pomoże. Włóż tu najwięcej wysiłku.

Sposoby, mniej więcej w tej kolejności:

1. **Test GDScript** na właściwym szwie: `Godot --headless --path . --script tests/test_<obszar>.gd` (albo `python3 tools/testing/run_tests.py <fragment>`).
2. **Skrypt-uprząż** `extends SceneTree` w katalogu roboczym: ładuje level/zasób, odgrywa kroki, sprawdza stan.
3. **Pętla różnicowa:** ta sama linia ruchów przez grę i przez Probierza (`tools/balance_spike/parity.gd`), albo stara i nowa wersja danych — porównanie planszy po każdym kroku.
4. **Zrzut i porównanie obrazu** dla błędów wizualnych: skrypt `tests/capture_*.gd` + porównanie pikseli z dobrym zrzutem.
5. **Blender:** skrypt przez MCP, który mierzy konkretną rzecz (zakres klatek akcji, krzywa kości, wymiar boxu) zamiast oglądania widoku.
6. **Bisekcja:** gdy błąd pojawił się między dwoma znanymi stanami — `git bisect run` z komendą z pkt 1–4.
7. **Człowiek w pętli** tylko w ostateczności: gdy trzeba kliknąć w grze, przygotuj dokładną listę kroków i co ma odpisać.

Zacieśnij pętlę: szybciej (węższy test, bez `--import`, jeśli niepotrzebny), ostrzej (sprawdzaj dokładny objaw, nie „nie wybuchło”), deterministycznie (ziarno wyprawy, stały seed).

**Gotowe, gdy** masz **jedną komendę**, którą już raz uruchomiłeś (pokaż wywołanie i wynik), i która: odtwarza **dokładny objaw zgłoszony przez użytkownika**, daje ten sam werdykt za każdym razem, trwa sekundy, działa bez człowieka. Łapiesz się na czytaniu kodu i budowaniu teorii, zanim ta komenda istnieje — wracasz tutaj.

Nie da się zbudować pętli: powiedz to wprost, wypisz, co próbowałeś, i poproś o to, czego brakuje (log z gry, zrzut, krok po kroku, plik `.blend`).

## Faza 2: odtwórz i zminimalizuj

Upewnij się, że to **ten** błąd, a nie sąsiedni. Potem tnij scenariusz (fale, jednostki, bronie, klatki) po jednym elemencie, uruchamiając pętlę po każdym cięciu. Gotowe, gdy każdy pozostały element jest nośny.

## Faza 3: hipotezy

3–5 hipotez w kolejności prawdopodobieństwa, każda z przewidywaniem: „Jeśli przyczyną jest X, to zmiana Y usunie błąd”. Pokaż listę użytkownikowi i od razu testuj pierwszą — jego wiedza może przetasować kolejność, ale nie czekasz na nią.

## Faza 4: sondy

Jedna zmienna naraz. Logi z unikalnym znacznikiem `[DIAG-xxxx]`, żeby sprzątanie było jednym grepem. Wydajność: najpierw pomiar (czas, liczba stanów Probierza, profiler), potem bisekcja.

## Faza 5: poprawka i test regresji

Test regresji **przed** poprawką, ale tylko na właściwym szwie — takim, który odtwarza prawdziwy wzorzec błędu. Brak takiego szwu to samo w sobie znalezisko: zapisz je (kandydat do `/architektura`). Kolejność: test czerwony → poprawka → test zielony → pętla z fazy 1 na pierwotnym scenariuszu.

## Faza 6: sprzątanie

- [ ] pierwotny scenariusz już nie odtwarza błędu
- [ ] test regresji przechodzi (albo brak szwu opisany)
- [ ] `grep -rn "DIAG-"` pusty
- [ ] uprzęże i skrypty robocze usunięte albo w katalogu roboczym poza repo
- [ ] w podsumowaniu: która hipoteza okazała się prawdziwa i dlaczego
