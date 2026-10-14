---
name: grill-me
description: Przesłuchanie luźnego pomysłu rundami pytań, aż da się go z czystym sumieniem przyjąć. Bez zapisu plików, w dowolnym repo albo bez repo, także poza kodem. Dobre, gdy temat leży poza stackiem użytkownika.
argument-hint: "[pomysł, plan albo technologia]"
disable-model-invocation: true
---

# Grill me

Na podstawie `grill-me` z mattpocock/skills (MIT). Ten sam przebieg co `/grill`, ale **bez stanu**: niczego nie zapisuje (ani rejestru decyzji, ani dokumentów). Wynikiem ma być jaśniejszy pomysł w głowie użytkownika.

Temat: $ARGUMENTS

## Rundy

Mapuj temat jako **drzewo decyzji**. **Front** to decyzje, których przesłanki są już rozstrzygnięte. Zadawaj cały front w jednej rundzie, ponumerowany, z rekomendacją:

```
❓ **P1 — <tytuł>**: <pytanie, z opcjami>
💡 <tylko gdy temat jest spoza stacku użytkownika: 1–2 zdania, czemu ta decyzja ma znaczenie, najlepiej przez analogię do tego, co zna — Flutter/Dart, Unity/UE5, Godot>
➡️ <rekomendowana odpowiedź i jednozdaniowe uzasadnienie>
```

„Tak” przyjmuje rekomendację, więc użytkownik może odpowiedzieć „1 tak, 2 tak, 3: wolę B”. Pytanie zależne od innego, jeszcze otwartego, czeka na następną rundę. Po odpowiedziach przelicz front.

## Poza własną technologią

Gdy temat jest spoza stacku użytkownika:
- Najpierw zapytaj o cel i ograniczenia (czas, skala, czy to ma przetrwać, czy wystarczy, że zadziała), a nie o szczegóły techniczne.
- Ukryte decyzje, które w tej technologii każdy podejmuje „domyślnie” (np. zarządzanie stanem, budowanie, wdrożenie, licencje, koszty), wyciągnij na wierzch jako osobne pytania. To one gryzą najczęściej.
- Rekomenduj ścieżkę typową dla tej technologii i zaznacz, gdy rekomendacja wynika z mody, a nie z konieczności.
- Fakty sprawdzaj sam (dokumentacja, repo, krótki pomiar), zamiast pytać o nie użytkownika.

## Zasady

- **Użytkownik prowadzi zakres.** Przyjmij sprzeciw, „nie wiem” i zawężenie zakresu jako pełne odpowiedzi.
- Na „nie wiem” zaproponuj, jak się dowiedzieć: sprawdzenie albo `/prototyp`. Nie zgaduj za użytkownika.
- **Pytania nie do rozstrzygnięcia rozmową** („jak to ma wyglądać”, „czy to będzie się dobrze grało”): przerwij grillowanie tej gałęzi i zaproponuj `/prototyp`.
- Gdy temat jest za duży na jedną sesję (więcej niż ~4 rundy w zasięgu), zaproponuj najpierw podział na części.

## Koniec

Gotowe, gdy front jest pusty. Wtedy podaj zwięzłe drzewo: decyzja → odpowiedź, plus listę rzeczy, które zostały świadomie otwarte. Niczego nie zapisuj i niczego nie realizuj, dopóki użytkownik o to nie poprosi. Jeśli poprosi o zapis w Zavishy, użyj formatu `docs/decyzje.md` jak w `/grill`.
