#!/usr/bin/env bash
#
# Dev Container Feature: Pi Coding Agent
#
# Installs an isolated Node.js + pi + holdpty into /opt/pi.
# Does NOT touch the container's existing Node.js installation.
#
# Options (from devcontainer-feature.json):
#   NODE_VERSION - Node.js version (default: 22.14.0)
#   PI_VERSION   - pi npm version (default: latest)

set -euo pipefail

NODE_VERSION="${NODEVERSION:-22.14.0}"
PI_VERSION="${PIVERSION:-latest}"
PI_HOME="/opt/pi"

echo "=== Pi Feature: Installing Node.js ${NODE_VERSION} + pi@${PI_VERSION} ==="

# --- Architecture detection (works on all Linux distros) ---
ARCH_RAW=$(uname -m)
case "${ARCH_RAW}" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  armv7l)  ARCH="armv7l" ;;
  *)
    echo "Error: Unsupported architecture: ${ARCH_RAW}"
    exit 1
    ;;
esac
echo "  Detected architecture: ${ARCH_RAW} → ${ARCH}"

# --- Install Node.js to /opt/pi ---
mkdir -p "${PI_HOME}"

NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
echo "  Downloading Node.js from ${NODE_URL}..."

# Install curl/wget if needed (works on both Debian and Alpine)
if ! command -v curl &>/dev/null; then
  if command -v apt-get &>/dev/null; then
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils
  elif command -v apk &>/dev/null; then
    apk add --no-cache curl ca-certificates xz
  fi
fi

curl -fsSL "${NODE_URL}" | tar -xJ -C "${PI_HOME}" --strip-components=1

echo "  Node.js installed: $(${PI_HOME}/bin/node --version)"

# --- Install pi ---
echo "  Installing pi@${PI_VERSION}..."
if [ "${PI_VERSION}" = "latest" ]; then
  "${PI_HOME}/bin/npm" install -g @mariozechner/pi-coding-agent
else
  "${PI_HOME}/bin/npm" install -g "@mariozechner/pi-coding-agent@${PI_VERSION}"
fi

# --- Install holdpty ---
echo "  Installing holdpty..."
"${PI_HOME}/bin/npm" install -g @marcfargas/holdpty

# --- Create wrapper scripts in /usr/local/bin ---
cat > /usr/local/bin/pi << 'WRAPPER'
#!/bin/sh
exec /opt/pi/bin/node /opt/pi/lib/node_modules/@mariozechner/pi-coding-agent/cli.js "$@"
WRAPPER
chmod +x /usr/local/bin/pi

cat > /usr/local/bin/holdpty << 'WRAPPER'
#!/bin/sh
exec /opt/pi/bin/node /opt/pi/lib/node_modules/@marcfargas/holdpty/dist/cli.js "$@"
WRAPPER
chmod +x /usr/local/bin/holdpty

# --- Verify ---
echo "  Verifying installation..."
echo "    pi: $(/usr/local/bin/pi --version 2>/dev/null || echo 'installed (version check may need config)')"
echo "    holdpty: $(/usr/local/bin/holdpty --version 2>/dev/null || echo 'installed')"
echo "    node: $(${PI_HOME}/bin/node --version)"

echo "=== Pi Feature: Installation complete ==="
