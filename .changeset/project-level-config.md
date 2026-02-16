---
"@marcfargas/pi-devcontainers": minor
---

Support project-level `.pi/devcontainers.json` for per-project configuration overrides. Project config takes precedence over user config for all settings.

Add `features` config field to inject additional devcontainer features (e.g. `github-cli`) into all containers. User and project features are merged additively with the project's own devcontainer.json.
