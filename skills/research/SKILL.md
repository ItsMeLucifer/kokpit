---
name: research
description: Zbadaj pytanie na źródłach pierwotnych (dokumentacja, kod źródłowy, specyfikacje, źródła historyczne) w agencie w tle i zapisz wynik z przypisami jako plik Markdown w repo. Użyj, gdy trzeba coś sprawdzić albo zebrać fakty, a praca ma iść dalej w międzyczasie.
---

# Research w tle

Na podstawie `research` z mattpocock/skills (MIT).

Uruchom **agenta w tle** (narzędzie Agent z pracą w tle), żeby rozmowa szła dalej, gdy on czyta. Jego zadanie:

1. Badać pytanie na **źródłach pierwotnych**: oficjalna dokumentacja (Godot, Claude Code, API narzędzi), kod źródłowy, specyfikacje; w historii i folklorze — źródła naukowe i edycje tekstów, nie blogi przepisujące je z trzeciej ręki. Każde twierdzenie prowadzi do źródła, które je ustala.
2. Oznaczać pewność: `[fakt]` (źródło pierwotne), `[niepewne]` (źródła się różnią — podaj które), `[legenda]` (tradycja, nie fakt).
3. Zapisać jeden plik Markdown z przypisami przy każdym twierdzeniu, w `docs/research/<temat>.md` (albo tam, gdzie repo już trzyma takie notatki).

Gdy wynik dotrze: jedno-dwa zdania wniosku i ścieżka pliku. Jeśli research odpowiada na otwarte pytanie z `docs/decyzje.md` — dopisz odnośnik do pliku w tym wpisie (status zostaje „czeka”, decyduje użytkownik).
