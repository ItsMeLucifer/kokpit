#!/usr/bin/env bash
# Collects the project state for a handoff and finds this session's thread. Always exits 0: the skill must
# not fail on a project without git or without a handoff directory.
SESSION="${1:-unknown}"
PROJECT="${2:-$PWD}"
# One home for threads: `.claude/handoffs/` of the repo's main checkout (the parent of git's common dir),
# whichever worktree the session runs in (resume/scripts/find.sh does the same). Worktrees may hold stale
# copies from before 0.15 (the folder is usually gitignored and an app copies it into a new worktree).
HERE="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$HERE" ] && HERE="$PROJECT"
threads_home() {
  local common
  common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  [ -z "$common" ] && common="$(cd "$1" 2>/dev/null && cd "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)"
  case "$common" in */.git) echo "${common%/.git}" ;; *) echo "$1" ;; esac
}
ROOT_HOME="$(threads_home "$HERE")"
DIR="$ROOT_HOME/.claude/handoffs"
cd "$HERE" 2>/dev/null || true

echo "date: $(date '+%Y-%m-%d %H:%M %Z')"
echo "project: $ROOT_HOME"
[ "$HERE" != "$ROOT_HOME" ] && echo "this session works in the worktree: $HERE"
echo "session: $SESSION"
echo "THREADS DIR: $DIR (every thread of this repo lives here, also for sessions in worktrees)"

is_thread() { case "$1" in *.archive.md|*.archiwum.md) return 1 ;; *.md) return 0 ;; *) return 1 ;; esac; }
by_session() { # $1 = directory
  local f
  for f in "$1"/*.md; do
    [ -f "$f" ] && is_thread "$f" && grep -q -m1 "^sessions:.*$SESSION" "$f" 2>/dev/null && { echo "$f"; return; }
  done
}

# This session's thread = the file whose `sessions:` frontmatter lists this session.
THREAD="$(by_session "$DIR")"
if [ -z "$THREAD" ]; then
  # Pinned in an old worktree copy (before 0.15): move it home, unless the home has a thread of that name.
  for c in "$HERE/.claude/handoffs" "$PROJECT/.claude/handoffs"; do
    [ -d "$c" ] && [ "$(cd "$c" && pwd -P)" != "$(cd "$DIR" 2>/dev/null && pwd -P)" ] || continue
    OLD="$(by_session "$c")"
    [ -n "$OLD" ] || continue
    B="$(basename "$OLD")"
    if [ -e "$DIR/$B" ]; then
      echo "COPY IN A WORKTREE: this session is pinned in $OLD, but the home has $DIR/$B. Write to the"
      echo "home file and carry over what only the copy has; tell the user the copy can be deleted."
      THREAD="$DIR/$B"
    else
      mkdir -p "$DIR" && mv "$OLD" "$DIR/$B" && THREAD="$DIR/$B"
      for suffix in .archive.md .archiwum.md; do
        [ -f "${OLD%.md}$suffix" ] && [ ! -e "$DIR/${B%.md}$suffix" ] && mv "${OLD%.md}$suffix" "$DIR/"
      done
      [ -n "$THREAD" ] && echo "MOVED HOME: $OLD → $THREAD (tell the user)"
    fi
    break
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
  echo "THREAD OF THIS SESSION: none — pick an existing thread from the list below or start a new one in THREADS DIR"
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
