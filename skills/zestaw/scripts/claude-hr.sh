#!/usr/bin/env bash
# Próba Headrooma: JEDNA sesja Claude Code w terminalu przez lokalne proxy, bez śladów po wyjściu.
#   claude-hr.sh [argumenty dla claude]
# Ograniczenia (sprawdzone w kodzie headroom 0.41.0 i w dokumentacji Claude Code):
#   - karta Code w aplikacji desktopowej i tak omija proxy (Desktop nadpisuje ANTHROPIC_BASE_URL),
#   - w tej sesji nie działa Remote Control (adres API inny niż api.anthropic.com),
#   - kod czytany z plików i wyniki grep przechodzą bez kompresji; zyskują tylko długie logi i JSON.
# Bez serwera MCP headroom (--no-mcp, inaczej rejestruje się dla całej maszyny), bez Serena, bez telemetrii.
# Wynik po kilku sesjach: `headroom savings`.
set -u
command -v headroom >/dev/null 2>&1 || { echo "Brak headroom — zestaw.sh maszyna --headroom"; exit 1; }
export HEADROOM_TELEMETRY=off HEADROOM_UPDATE_CHECK=off
headroom wrap claude --no-mcp --code-memory none --1m -- "$@"
kod=$?
headroom unwrap claude >/dev/null 2>&1 || true
exit $kod
