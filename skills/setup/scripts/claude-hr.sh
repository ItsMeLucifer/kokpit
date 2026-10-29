#!/usr/bin/env bash
# headroom trial: ONE Claude Code session in the terminal through a local proxy, no traces left after exit.
#   claude-hr.sh [arguments for claude]
# Limits (checked in the headroom 0.41.0 code and the Claude Code documentation):
#   - the Code tab of the desktop app bypasses the proxy anyway (Desktop overrides ANTHROPIC_BASE_URL),
#   - Remote Control does not work in this session (an API address other than api.anthropic.com),
#   - code read from files and grep output pass uncompressed; only long logs and JSON gain.
# No headroom MCP server (--no-mcp, otherwise it registers for the whole machine), no Serena, no telemetry.
# The result after a few sessions: `headroom savings`.
set -u
command -v headroom >/dev/null 2>&1 || { echo "No headroom: setup.sh machine --headroom"; exit 1; }
export HEADROOM_TELEMETRY=off HEADROOM_UPDATE_CHECK=off
headroom wrap claude --no-mcp --code-memory none --1m -- "$@"
code=$?
headroom unwrap claude >/dev/null 2>&1 || true
exit $code
