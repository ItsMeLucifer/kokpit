---
name: prototyp
description: Szybki prototyp do wyrzucenia, który odpowiada na jedno pytanie projektowe — czy mechanika/reguła „się klei” (symulacja w jednym pliku HTML z przyciskami) albo jak coś ma wyglądać (kilka radykalnie różnych wariantów obok siebie). Użyj, gdy pytania nie da się rozstrzygnąć na papierze.
---

# Prototyp

Na podstawie `prototype` z mattpocock/skills (MIT). Prototyp to **kod do wyrzucenia, który odpowiada na pytanie**. Pytanie decyduje o kształcie.

## Wybierz gałąź

- **„Czy ta reguła/mechanika się klei?”** (zasady obozu, fale, ekonomia Dukatów, nowy status, kontrakt) → **logika**.
- **„Jak to ma wyglądać?”** (karta, panel, plakietka, ekran) → **wygląd**.

Niejasne i użytkownika nie ma: wybierz gałąź pasującą do kodu obok i napisz założenie na górze prototypu.

## Logika: jeden plik HTML

1. Na górze strony, widocznie: jakie pytanie rozstrzyga ten prototyp (jeden akapit).
2. Logika w jednym `<script>` jako czysty moduł — reducer `(stan, akcja) => stan`, automat stanów albo zestaw czystych funkcji — bez DOM w środku, żeby po rozstrzygnięciu dało się ją przenieść 1:1 do GDScript.
3. Strona: tytuł; **bieżący stan** jako czytelny panel (pola z etykietami, co się właśnie zmieniło); **przyciski swobodne** — jedna akcja na przycisk; **scenariusze** w zakładkach — każdy resetuje stan i prowadzi przez przyciski: ścieżka typowa, trudny przypadek brzegowy, próba czegoś, co powinno być niedozwolone. Dla mechanik losowych: pole na ziarno i przycisk „1000 rozegrań” z rozkładem wyników — liczby, nie wrażenia.
4. Język gry na etykietach (Dukaty, serca, odnowienie), nie nazwy zmiennych. Bez frameworków, wszystko w jednym pliku, otwiera się dwuklikiem.

## Wygląd: warianty obok siebie

Kilka **radykalnie** różnych wariantów (nie odcieni jednego), przełączanych jednym parametrem — w Godocie zmienną środowiskową czytaną przez scenę podglądu i skrypt zrzutu, w HTML parametrem URL i paskiem przełącznika na dole. Jeden zrzut na wariant w tej samej rozdzielczości co gra (1920×1080), obok siebie, żeby porównać od razu.

## Zasady obu gałęzi

- Oznaczony jako prototyp w nazwie, w katalogu roboczym albo obok kodu, którego dotyczy — nigdy w ścieżkach ładowanych przez grę.
- Uruchomienie jedną komendą albo dwuklikiem.
- Bez trwałego stanu, bez testów, bez obsługi błędów poza tym, co potrzebne do uruchomienia.
- Po rozstrzygnięciu: decyzja do `docs/decyzje.md` (albo prosto do kodu, jeśli użytkownik ją podjął), sam prototyp zostaje jako źródło na boku (katalog roboczy albo gałąź `prototyp/<nazwa>`), nie w głównej gałęzi.
