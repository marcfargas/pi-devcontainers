---
"@marcfargas/pi-devcontainers": patch
---

Fix JSONC config parsing to handle trailing commas, which caused `~/.pi/devcontainers.json` to be silently ignored.

Fix environment variable passthrough: resolved env vars (e.g. `BROKER_URL`) are now correctly passed to `docker exec` when launching pi via holdpty.

Fix workspace folder detection: set explicit `workspaceFolder` in merged config so lifecycle hooks run with the correct working directory.

Fix extension/skill resolution to not bail early when user-level `settings.json` is missing — project-level settings are now always checked.

Fix extension path patching in `settings.json` for container use.

Set `PI_DEVCONTAINER=1` in container environment for runtime detection.
