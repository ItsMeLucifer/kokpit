#!/usr/bin/env bash
# Collects the project state for a handoff and finds this session's thread. Always exits 0: the skill must
# not fail on a project without git or without a handoff directory.
SESSION="${1:-unknown}"
PROJECT="${2:-$PWD}"
DIR="$PROJECT/.claude/handoffs"
cd "$PROJECT" 2>/dev/null || true

echo "date: $(date '+%Y-%m-%d %H:%M %Z')"
echo "project: $PROJECT"
echo "session: $SESSION"

is_thread() { case "$1" in *.archive.md|*.archiwum.md) return 1 ;; *.md) return 0 ;; *) return 1 ;; esac; }

# This session's thread = the file whose `sessions:` frontmatter lists this session.
THREAD=""
if [ -d "$DIR" ]; then
  for f in $(grep -l -m1 "^sessions:.*$SESSION" "$DIR"/*.md 2>/dev/null); do
    if is_thread "$f"; then THREAD="$f"; break; fi
  done
fi
if [ -n "$THREAD" ]; then
  echo "THREAD OF THIS SESSION: $THREAD"
  mkdir -p "$DIR/.previous" 2>/dev/null
  PREV="$DIR/.previous/$(basename "$THREAD")"
  cp "$THREAD" "$PREV" 2>/dev/null && echo "copy of the previous version (for the validator): $PREV"
  # The thread's archive only grows; a copy next to it lets the validator check that nothing disappeared.
  ARCHIVE=""
  for suffix in .archive.md .archiwum.md; do
    [ -f "${THREAD%.md}$suffix" ] && ARCHIVE="${THREAD%.md}$suffix"
  done
  if [ -n "$ARCHIVE" ]; then
    cp "$ARCHIVE" "$DIR/.previous/$(basename "$ARCHIVE")" 2>/dev/null
    echo "THREAD ARCHIVE: $ARCHIVE ($(wc -c <"$ARCHIVE" | tr -d ' ') B; append at the end of its sections, do not read it all)"
  else
    echo "THREAD ARCHIVE: none (create it next to the thread when there is something to move)"
  fi
else
  echo "THREAD OF THIS SESSION: none — pick an existing thread from the list below or start a new one"
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "branch: $(git branch --show-current 2>/dev/null)"
  echo
  echo "## git status (first 40 lines)"
  git status --short 2>/dev/null | head -40
  echo "changed files in total: $(git status --short 2>/dev/null | wc -l | tr -d ' ')"
  echo
  echo "## recent commits"
  git log --oneline -8 2>/dev/null
  echo
  echo "## diff --stat against HEAD (short)"
  git diff HEAD --stat 2>/dev/null | tail -15
else
  echo "git: no repository"
fi

echo
if [ -n "$THREAD" ]; then
  echo "## CURRENT CONTENT OF THE THREAD (you append to it; carry protected sections over word for word)"
  cat "$THREAD"
fi

echo
echo "## threads in the project (newest first; title from the first heading)"
if [ -d "$DIR" ]; then
  n=0
  for f in $(ls -1t "$DIR"/*.md 2>/dev/null); do
    is_thread "$f" || continue
    echo "- $(basename "$f"): $(grep -m1 '^# ' "$f" | sed 's/^# //')"
    n=$((n + 1)); [ $n -ge 8 ] && break
  done
fi
exit 0
