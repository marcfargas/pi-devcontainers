#!/usr/bin/env bash
#
# Pi container setup — runs as postCreateCommand (after container creation).
# At this point, mounts ARE available:
#   /opt/pi-host-config/ — RO bind mount of host ~/.pi
#   /opt/pi-ext-staging/ — packed extension tarballs (if any)
#   ~/.pi/todos/         — writable Docker volume
#   ~/.pi/memoria/       — writable Docker volume
#
# This script:
# 1. Copies non-writable config from the host mount
# 2. Installs packed extension tarballs
# 3. Sets up pi's home directory

set -euo pipefail

PI_HOME="/opt/pi"
HOST_CONFIG="/opt/pi-host-config"
USER_PI_DIR="${HOME}/.pi"

echo "=== Pi Setup: Configuring pi environment ==="

# --- Create ~/.pi if it doesn't exist ---
mkdir -p "${USER_PI_DIR}"

# --- Copy non-writable config from host mount ---
if [ -d "${HOST_CONFIG}" ]; then
  echo "  Copying host config..."

  # Copy directories that should be read-only (config, agents, skills)
  for dir in agent skills config; do
    if [ -d "${HOST_CONFIG}/${dir}" ]; then
      echo "    - ${dir}/"
      cp -a "${HOST_CONFIG}/${dir}" "${USER_PI_DIR}/${dir}" 2>/dev/null || true
    fi
  done

  # Copy individual config files
  for file in config.json devcontainers.json; do
    if [ -f "${HOST_CONFIG}/${file}" ]; then
      echo "    - ${file}"
      cp -a "${HOST_CONFIG}/${file}" "${USER_PI_DIR}/${file}" 2>/dev/null || true
    fi
  done
else
  echo "  No host config found at ${HOST_CONFIG} — using defaults"
fi

# --- Install packed extension tarballs ---
EXT_STAGING="/opt/pi-ext-staging"
if [ -d "${EXT_STAGING}" ]; then
  tarball_count=$(find "${EXT_STAGING}" -name "*.tgz" 2>/dev/null | wc -l)
  if [ "$tarball_count" -gt 0 ]; then
    echo "  Installing ${tarball_count} packed extension(s)..."
    for tarball in "${EXT_STAGING}"/*.tgz; do
      echo "    - $(basename "${tarball}")"
      "${PI_HOME}/bin/npm" install -g "${tarball}" --ignore-scripts 2>/dev/null || \
        echo "      ⚠ Failed to install $(basename "${tarball}")"
    done
  fi
else
  echo "  No extension staging directory found — skipping"
fi

# --- Ensure writable dirs exist (volumes mount over empty dirs) ---
# These should already be Docker volumes, but create them just in case
mkdir -p "${USER_PI_DIR}/todos" "${USER_PI_DIR}/memoria" 2>/dev/null || true

echo "=== Pi Setup: Done ==="
