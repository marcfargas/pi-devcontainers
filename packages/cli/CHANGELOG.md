# @marcfargas/pi-devcontainers

## 0.3.0

### Minor Changes

- [`2bafe85`](https://github.com/marcfargas/pi-devcontainers/commit/2bafe85bce7b8c8c05a8993566de8a577763930f) Thanks [@marcfargas](https://github.com/marcfargas)! - Support project-level `.pi/devcontainers.json` for per-project configuration overrides. Project config takes precedence over user config for all settings.

  Add `features` config field to inject additional devcontainer features (e.g. `github-cli`) into all containers. User and project features are merged additively with the project's own devcontainer.json.

### Patch Changes

- [`2bafe85`](https://github.com/marcfargas/pi-devcontainers/commit/2bafe85bce7b8c8c05a8993566de8a577763930f) Thanks [@marcfargas](https://github.com/marcfargas)! - Fix JSONC config parsing to handle trailing commas, which caused `~/.pi/devcontainers.json` to be silently ignored.

  Fix environment variable passthrough: resolved env vars (e.g. `BROKER_URL`) are now correctly passed to `docker exec` when launching pi via holdpty.

  Fix workspace folder detection: set explicit `workspaceFolder` in merged config so lifecycle hooks run with the correct working directory.

  Fix extension/skill resolution to not bail early when user-level `settings.json` is missing — project-level settings are now always checked.

  Fix extension path patching in `settings.json` for container use.

  Set `PI_DEVCONTAINER=1` in container environment for runtime detection.

- [`efb969b`](https://github.com/marcfargas/pi-devcontainers/commit/efb969beb1d90eb475192e489b16733327a23785) Thanks [@marcfargas](https://github.com/marcfargas)! - Delegate container runtime to `devcontainer exec` instead of direct `docker exec`. Containers are now resolved by label (`--id-label`) for reliable attach and exec, independent of ephemeral config files.

  Mount `~/.pi` into all common user homes (`/root`, `/home/vscode`, `/home/node`) so pi data is accessible regardless of the project's `remoteUser` setting.

  Fix Windows argument quoting for `devcontainer exec` — compound shell commands (`bash -c "..."`) with spaces, `&&`, and variable expansion now work correctly on cmd.exe.

  Prefer locally installed `devcontainer` CLI over `npx @devcontainers/cli` fallback.

  Switch JSONC parsing from regex to `jsonc-parser` library.

## 0.2.0

### Minor Changes

- Initial release of pi-devcontainers.

  - **`pidc` CLI** with `up`, `down`, `attach`, `run`, and `status` commands
  - **Additive-only merge** — layers pi as a Dev Container Feature on top of your project's devcontainer.json without modifying project files
  - **Automatic extension & skill mounting** — resolves paths from pi's `settings.json`, mounts monorepo roots for hoisted `node_modules`
  - **Layered mount architecture** — read-only `~/.pi` bind mount with writable volume overlays for `todos/` and `memoria/`
  - **Windows path conversion** — transparently converts Git Bash `/c/` paths and patches `settings.json` for container use
  - **Container lifecycle management** — state file + Docker label fallback for tracking containers across sessions
  - **Dev Container Feature** (`ghcr.io/marcfargas/devcontainer-features/pi`) — installs isolated Node.js + pi + holdpty in `/opt/pi`
  - **Cross-platform path handling** — works from Windows (Git Bash, PowerShell), macOS, and Linux hosts
