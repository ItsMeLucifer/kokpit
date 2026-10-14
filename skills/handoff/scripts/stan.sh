#!/usr/bin/env bash
# Zbiera stan projektu do handoffu i znajduje wątek tej sesji. Zawsze kończy się kodem 0 —
# skill nie może się wywrócić na projekcie bez gita albo bez katalogu handoffów.
SESSION="${1:-nieznana}"
PROJECT="${2:-$PWD}"
DIR="$PROJECT/.claude/handoffs"
cd "$PROJECT" 2>/dev/null || true

echo "data: $(date '+%Y-%m-%d %H:%M %Z')"
echo "projekt: $PROJECT"
echo "sesja: $SESSION"

# Wątek tej sesji = plik, którego frontmatter `sessions:` wymienia tę sesję.
THREAD=""
if [ -d "$DIR" ]; then
  THREAD=$(grep -l -m1 "^sessions:.*$SESSION" "$DIR"/*.md 2>/dev/null | head -1)
fi
if [ -n "$THREAD" ]; then
  echo "WĄTEK TEJ SESJI: $THREAD"
  mkdir -p "$DIR/.poprzednie" 2>/dev/null
  PREV="$DIR/.poprzednie/$(basename "$THREAD")"
  cp "$THREAD" "$PREV" 2>/dev/null && echo "kopia poprzedniej wersji (do walidatora): $PREV"
else
  echo "WĄTEK TEJ SESJI: brak — wybierz istniejący wątek z listy niżej albo załóż nowy"
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "gałąź: $(git branch --show-current 2>/dev/null)"
  echo
  echo "## git status (pierwsze 40 wierszy)"
  git status --short 2>/dev/null | head -40
  echo "zmienionych plików razem: $(git status --short 2>/dev/null | wc -l | tr -d ' ')"
  echo
  echo "## ostatnie commity"
  git log --oneline -8 2>/dev/null
  echo
  echo "## diff --stat względem HEAD (skrót)"
  git diff HEAD --stat 2>/dev/null | tail -15
else
  echo "git: brak repozytorium"
fi

echo
if [ -n "$THREAD" ]; then
  echo "## OBECNA TREŚĆ WĄTKU (dopisujesz do niej — sekcje chronione przenosisz dosłownie)"
  cat "$THREAD"
fi

echo
echo "## wątki w projekcie (najnowsze; tytuł z pierwszego nagłówka)"
if [ -d "$DIR" ]; then
  for f in $(ls -1t "$DIR"/*.md 2>/dev/null | head -8); do
    echo "- $(basename "$f"): $(grep -m1 '^# ' "$f" | sed 's/^# //')"
  done
fi
exit 0
