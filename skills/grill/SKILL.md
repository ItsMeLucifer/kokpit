---
name: grill
description: Rozbiór planu albo pomysłu rundami pytań z rekomendowanymi odpowiedziami, aż wszystkie gałęzie decyzji są rozstrzygnięte; odpowiedzi trafiają do rejestru decyzji. Użyj, gdy użytkownik chce przetestować plan, zanim zacznie się robota, albo mówi „przemaglujmy to”.
argument-hint: "[plan, pomysł albo ścieżka dokumentu]"
---

# Grill

Na podstawie `grilling` z mattpocock/skills (MIT).

Temat: $ARGUMENTS

Przesłuchuj, aż dojdziecie do wspólnego rozumienia. Mapuj to jako **drzewo decyzji**: każda decyzja rozgałęzia się na decyzje, które od niej zależą.

## Rundy

**Front** to wszystkie decyzje, których przesłanki są już rozstrzygnięte — pytania, które da się zadać *teraz* bez zgadywania odpowiedzi na inne. Zadaj cały front w jednej rundzie, ponumerowany, z rekomendacją przy każdym pytaniu:

```
❓ **P1 — <tytuł>**: <pytanie, z opcjami, jeśli są>

➡️ <rekomendowana odpowiedź i jednozdaniowe uzasadnienie>
```

Formułuj pytania tak, żeby „tak” przyjmowało rekomendację — użytkownik może odpowiedzieć „1 tak, 2 tak, 3: wolę B”. Pytanie zależne od innego, jeszcze otwartego w tej rundzie, idzie do następnej rundy.

Po odpowiedziach przelicz front i zadaj następną rundę.

## Fakty to Twoja robota

Gdy pytanie potrzebuje faktu z repo, danych, Probierza albo dokumentów — sprawdź sam (podagent, odczyt, krótki pomiar), nie pytaj użytkownika o nic, co możesz znaleźć. Nie blokuj rundy: czekają tylko pytania zależne od trwającego sprawdzenia. **Decyzje** należą do użytkownika — każdą mu przedstaw.

## Koniec

Gotowe, gdy front jest pusty: każda gałąź odwiedzona, nic po cichu założone. Wtedy:

1. Krótkie podsumowanie drzewa: decyzja → odpowiedź.
2. Każda podjęta decyzja, która zmienia projekt gry albo narzędzi, idzie do `docs/decyzje.md` jako wpis od razu rozstrzygnięty (`status: przyjęta`, `rozstrzygnięto: dziś`, `odpowiedź:` słowami użytkownika, `wprowadzono: nie`); pytania, na które użytkownik świadomie nie odpowiedział, jako `status: czeka`.
3. Nie zaczynaj realizacji, dopóki użytkownik nie potwierdzi, że to wspólne rozumienie.
