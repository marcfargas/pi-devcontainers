#!/usr/bin/env bash
#
# Pi container setup — runs as postCreateCommand if needed.
#
# With the current architecture (layered mounts), this script is rarely
# needed. Mounts handle everything:
#   ~/.pi/          — RO bind mount of host ~/.pi
#   ~/.pi/todos/    — writable Docker volume overlay
#   ~/.pi/memoria/  — writable Docker volume overlay
#   ~/.pi/agent/settings.json — patched single-file bind mount
#   /c/dev/...      — RO bind mounts for extensions/skills
#
# This script only ensures writable dirs exist (belt-and-suspenders).

set -euo pipefail

USER_PI_DIR="${HOME}/.pi"

echo "=== Pi Setup ==="
mkdir -p "${USER_PI_DIR}/todos" "${USER_PI_DIR}/memoria" 2>/dev/null || true
echo "=== Pi Setup: Done ==="
