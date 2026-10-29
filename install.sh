#!/usr/bin/env bash
# A new machine: clone the Kokpit repo and run ./install.sh [--graphify] [--headroom].
# Then, in every project: /kokpit:setup project.
exec "$(cd "$(dirname "$0")" && pwd)/skills/setup/scripts/setup.sh" machine "$@"
