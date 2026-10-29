#!/usr/bin/env bash
# Kokpit setup: the same Claude Code setup on every machine and in every project.
#   setup.sh check [project]                                     what is there and what is missing (changes nothing)
#   setup.sh machine [--graphify] [--headroom] [--overwrite] [--tidy]   uv, plugins, settings profile, optional tools
#   setup.sh project [project] [--graphify] [--force]            .gitignore, thread directory, repo-standard state, optional graphify
#   setup.sh standard <state|init|core|rename-entry|archive|hook> <project> [...]   the repo standard (scripts/standard.py)
# Every step is idempotent: a second run says "already there" and breaks nothing.
# Written for bash 3.2 (the macOS default): no associative arrays and no ${x,,}.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
KOKPIT="$(cd "$HERE/../../.." && pwd)"
. "$HERE/versions.conf"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"

MISSING=0
ok()      { printf '  ✓ %s\n' "$*"; }
missing() { printf '  ✗ %s\n' "$*"; MISSING=$((MISSING + 1)); }
note()    { printf '  ! %s\n' "$*"; }
header()  { printf '\n## %s\n' "$*"; }
has()     { command -v "$1" >/dev/null 2>&1; }

python_run() {  # $1 = script in this directory, then its arguments
  script="$1"; shift
  if has python3; then python3 -I "$HERE/$script" "$@"
  elif has uv; then uv run --no-project --quiet python -I "$HERE/$script" "$@"
  else missing "no python3 and no uv: cannot run $script"; return 1
  fi
}
py() { python_run setup.py "$@"; }
standard() { python_run standard.py "$@"; }

# --- plugins -----------------------------------------------------------------------------------------

plugins() { grep -v '^[[:space:]]*#' "$HERE/plugins.txt" | grep -v '^[[:space:]]*$'; }

marketplace_exists() { claude plugin marketplace list 2>/dev/null | grep -qE "❯ $1( |\$)"; }

# Prints: enabled | disabled | absent.
plugin_state() {
  claude plugin list 2>/dev/null | awk -v id="$1" '
    $1 == "❯" { w = ($2 == id) }
    w && /Status:/ { print (/enabled/ ? "enabled" : "disabled"); found = 1; exit }
    END { if (!found) print "absent" }'
}

plugins_step() {
  header "Claude Code plugins"
  while read -r id src; do
    market="${id#*@}"
    [ "$src" = KOKPIT ] && src="$KOKPIT"
    if ! marketplace_exists "$market"; then
      if [ "$MODE" = check ]; then missing "marketplace $market ($src)"; continue; fi
      if claude plugin marketplace add "$src" >/dev/null 2>&1; then ok "marketplace $market added ($src)"
      else missing "marketplace $market ($src): a private repo needs an authenticated git (gh auth login)"; continue
      fi
    fi
    case "$(plugin_state "$id")" in
      enabled) ok "$id" ;;
      disabled)
        if [ "$MODE" = check ]; then missing "$id disabled"
        elif claude plugin enable "$id" >/dev/null 2>&1; then ok "$id enabled"
        else missing "$id: could not enable it"
        fi ;;
      *)
        if [ "$MODE" = check ]; then missing "$id not installed"
        elif claude plugin install "$id" >/dev/null 2>&1; then ok "$id installed"
        else missing "$id: installation failed (claude plugin install $id)"
        fi ;;
    esac
  done < <(plugins)
}

# --- tools -------------------------------------------------------------------------------------------

# $1 = PyPI package, $2 = pinned version, $3 = install spec, $4 = optional Python version.
tool() {
  if uv tool list 2>/dev/null | grep -q "^$1 v$2\$"; then ok "$1 $2"; return; fi
  current="$(uv tool list 2>/dev/null | awk -v p="$1" '$1 == p { print $2 }')"
  if [ "$MODE" = check ]; then missing "$1 ${current:-absent}, pinned v$2"; return; fi
  if uv tool install --force ${4:+--python "$4"} "$3" >/dev/null 2>&1; then ok "$1 $2 installed"
  else missing "$1: uv tool install $3 failed"
  fi
}

tools_step() {
  header "Tools"
  if has uv; then ok "uv $(uv --version | awk '{print $2}')"
  elif [ "$MODE" = apply ] && has brew && brew install uv >/dev/null 2>&1; then ok "uv installed with Homebrew"
  else missing "uv: brew install uv (or https://docs.astral.sh/uv/getting-started/installation/)"; return 1
  fi
  if has claude; then ok "claude $(claude --version 2>/dev/null | awk '{print $1}')"
  else missing "claude (Claude Code CLI): https://code.claude.com/docs/en/setup"; return 1
  fi
  [ "$WITH_GRAPHIFY" = 1 ] && tool graphifyy "$GRAPHIFY_VERSION" "graphifyy==$GRAPHIFY_VERSION"
  [ "$WITH_HEADROOM" = 1 ] && tool headroom-ai "$HEADROOM_VERSION" "headroom-ai[proxy]==$HEADROOM_VERSION" "$HEADROOM_PYTHON"
  return 0
}

# headroom leftovers that change every session on the machine (not only the trial from claude-hr.sh).
headroom_leftovers() {
  if grep -q 'ANTHROPIC_BASE_URL' "$SETTINGS" 2>/dev/null; then
    note "ANTHROPIC_BASE_URL in $SETTINGS: terminal sessions go through the proxy, Remote Control and MCP tool search are off"
  fi
  if grep -q '"headroom"' "$HOME/.claude.json" 2>/dev/null; then
    note "headroom MCP server registered in ~/.claude.json (loads in every session): headroom unwrap claude"
  fi
}

machine() {
  tools_step || return 1
  plugins_step
  header "Claude Code settings ($SETTINGS)"
  if [ "$MODE" = check ]; then py settings "$SETTINGS" "$HERE/profile.json" --check
  else py settings "$SETTINGS" "$HERE/profile.json" $OVERWRITE
  fi
  headroom_leftovers
  # Claude Code does not read ~/.claude/settings.local.json (local settings exist only per project): a dead file misleads.
  if [ -f "$CLAUDE_DIR/settings.local.json" ]; then
    if [ "$MODE" = apply ] && [ "$TIDY" = 1 ]; then
      mv "$CLAUDE_DIR/settings.local.json" "$CLAUDE_DIR/settings.local.json.bak" && ok "settings.local.json -> settings.local.json.bak"
    else note "$CLAUDE_DIR/settings.local.json: Claude Code does not read it; setup.sh machine --tidy moves it aside"
    fi
  fi
}

# --- project -----------------------------------------------------------------------------------------

add_gitignore() {  # $1 = project directory, $2 = line
  file="$1/.gitignore"
  if grep -qxF "$2" "$file" 2>/dev/null; then ok ".gitignore: $2"; return; fi
  if [ "$MODE" = check ]; then missing ".gitignore: no $2"; return; fi
  # A file without a trailing newline would glue the entry to its last line.
  if [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ]; then printf '\n' >> "$file"; fi
  printf '%s\n' "$2" >> "$file"
  ok ".gitignore: added $2"
}

graphify_step() {  # $1 = project directory
  header "Code graph (graphify)"
  py graph "$1" "$HERE/graphify_extensions.txt"
  fits=$?
  if [ -f "$1/graphify-out/graph.json" ]; then ok "graph exists: graphify-out/graph.json"; fi
  if [ "$WITH_GRAPHIFY" != 1 ]; then
    [ $fits -eq 0 ] && note "fits: turn it on with setup.sh machine --graphify, then setup.sh project --graphify"
    return 0
  fi
  if [ $fits -ne 0 ] && [ "$FORCE" != 1 ]; then
    note "skipped: too little code graphify reads (hooks would send Claude to a graph without the main code); --force to override"
    return 0
  fi
  [ "$MODE" = check ] && return 0
  has graphify || { missing "graphify not installed: setup.sh machine --graphify"; return 1; }
  # Local AST only (no subagents, no tokens). `graphify install` is skipped on purpose: it adds a block to
  # ~/.claude/CLAUDE.md that `graphify uninstall` does not remove.
  if (cd "$1" && GRAPHIFY_NO_CTA=1 GRAPHIFY_BACKEND=none graphify extract . --code-only >/dev/null 2>&1); then ok "graph built (code-only)"
  else missing "graphify extract . --code-only failed"; return 1
  fi
  if (cd "$1" && graphify claude install >/dev/null 2>&1); then ok "PreToolUse hooks and a CLAUDE.md section (graphify claude install)"
  else missing "graphify claude install failed"
  fi
  add_gitignore "$1" "graphify-out/"
  note "after code changes: graphify update . (AST, no LLM); to undo: graphify claude uninstall"
}

project() {  # $1 = project directory
  header "Project $1"
  [ -d "$1" ] || { missing "no directory $1"; return 1; }
  if git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    add_gitignore "$1" ".claude/handoffs/.previous/"
    add_gitignore "$1" ".claude/kokpit/"
  else
    note "not a git repository: .gitignore skipped"
  fi
  if [ -d "$1/.claude/handoffs" ]; then ok "thread directory .claude/handoffs/"
  elif [ "$MODE" = apply ]; then mkdir -p "$1/.claude/handoffs" && ok "created .claude/handoffs/"
  else note "no .claude/handoffs/ (it appears with the first /handoff)"
  fi
  if [ -f "$1/.claude/kokpit.json" ]; then ok "background jobs: .claude/kokpit.json"
  else note "no .claude/kokpit.json: /tests and named jobs need it (e.g. {\"tests\": \"npm test --\"})"
  fi
  header "Fixed per-session cost of project files"
  py sizes "$1"
  header "Repo standard (docs/repo-standard.md in Kokpit)"
  standard state "$1"
  graphify_step "$1"
}

# --- entry -------------------------------------------------------------------------------------------

COMMAND="${1:-check}"
[ $# -gt 0 ] && shift
if [ "$COMMAND" = standard ]; then standard "$@"; exit $?; fi
WITH_GRAPHIFY=0; WITH_HEADROOM=0; OVERWRITE=""; FORCE=0; TIDY=0; TARGET=""
for a in "$@"; do
  case "$a" in
    --graphify)  WITH_GRAPHIFY=1 ;;
    --headroom)  WITH_HEADROOM=1 ;;
    --overwrite) OVERWRITE="--overwrite" ;;
    --force)     FORCE=1 ;;
    --tidy)      TIDY=1 ;;
    -*) echo "unknown option: $a"; exit 2 ;;
    *)  TARGET="$a" ;;
  esac
done
# The check also shows the optional tools when they are already on the machine.
if [ "$COMMAND" = check ]; then
  has graphify && WITH_GRAPHIFY=1
  has headroom && WITH_HEADROOM=1
fi

case "$COMMAND" in
  check)
    MODE=check
    echo "Kokpit setup: check (changes nothing). Kokpit: $KOKPIT"
    machine
    [ -n "$TARGET" ] && project "$TARGET" ;;
  machine)
    MODE=apply
    echo "Kokpit setup: machine. Kokpit: $KOKPIT"
    machine ;;
  project)
    MODE=apply
    project "${TARGET:-$PWD}" ;;
  *)
    sed -n '2,6p' "$0"; exit 2 ;;
esac

echo
if [ $MISSING -eq 0 ]; then echo "Done: nothing missing."
else echo "Missing: $MISSING (✗ above)."
fi
[ "$COMMAND" = check ] && exit 0
[ $MISSING -eq 0 ]
