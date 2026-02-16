# pi-devcontainers

## 0.3.0

### Patch Changes

- Updated dependencies [[`2bafe85`](https://github.com/marcfargas/pi-devcontainers/commit/2bafe85bce7b8c8c05a8993566de8a577763930f), [`efb969b`](https://github.com/marcfargas/pi-devcontainers/commit/efb969beb1d90eb475192e489b16733327a23785), [`2bafe85`](https://github.com/marcfargas/pi-devcontainers/commit/2bafe85bce7b8c8c05a8993566de8a577763930f)]:
  - @marcfargas/pi-devcontainers@0.3.0

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

### Patch Changes

- Updated dependencies []:
  - @marcfargas/pi-devcontainers@0.2.0
