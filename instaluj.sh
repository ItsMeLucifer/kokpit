#!/usr/bin/env bash
# Nowa maszyna: sklonuj repo Kokpitu (np. gh repo clone ItsMeLucifer/kokpit_claude_mode ~/Projects/kokpit)
# i uruchom ./instaluj.sh [--graphify] [--headroom]. Potem w każdym projekcie: /kokpit:zestaw projekt.
exec "$(cd "$(dirname "$0")" && pwd)/skills/zestaw/scripts/zestaw.sh" maszyna "$@"
