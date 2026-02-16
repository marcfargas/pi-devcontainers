# Deviations from Standard Dev Containers

This document lists every way `pidc` deviates from the standard `devcontainer` CLI behaviour. If you're debugging something unexpected inside a pidc-managed container, start here.

## 1. Docker exec instead of devcontainer exec

**Standard**: `devcontainer exec --workspace-folder <path>` reads the project's `.devcontainer/devcontainer.json` and runs commands inside the container with proper env and user context.

**pidc**: Uses `docker exec` directly with the saved container ID. The devcontainer CLI's `exec` requires a config file in the workspace — since we use a temporary merged config (not the project's), the CLI can't find it.

**Impact**: Environment variables set via `remoteEnv` in devcontainer.json are NOT available through `docker exec`. pidc compensates by injecting `TERM`, `COLORTERM`, and `LANG` via `-e` flags on every `docker exec` call.

## 2. Terminal environment injected explicitly

**Standard**: `remoteEnv` values are set by the devcontainer runtime and available in all shells.

**pidc**: Since we use `docker exec` (see above), `remoteEnv` is invisible. pidc injects these on every exec:
- `TERM=xterm-256color` — enables color and cursor control
- `COLORTERM=truecolor` — enables 24-bit RGB colours (required by pi's TUI)
- `LANG=C.UTF-8` — enables Unicode box-drawing characters

These are also set in `remoteEnv` of the merged config (for anything that does use the devcontainer exec path), but the `docker exec -e` flags are the actual mechanism.

## 3. Temporary merged config

**Standard**: `devcontainer up` reads `.devcontainer/devcontainer.json` from the workspace.

**pidc**: Generates a temporary `devcontainer.json` in `$TEMP/pidc-<timestamp>/` that merges the project's config with pi's requirements (feature, mounts, env). The project file is never modified. The temp config is referenced via `--config <path>`.

**Impact**: After `devcontainer up`, the devcontainer CLI's other commands (`exec`, `read-configuration`) won't find this config unless you pass `--config` explicitly. pidc doesn't use them — it goes through Docker directly.

## 4. State file for lifecycle management

**Standard**: The devcontainer CLI has no `down`, `stop`, or `status` commands. It finds containers by label (`devcontainer.local_folder`).

**pidc**: Maintains `~/.pi/devcontainers-state.json` mapping workspace paths to container IDs, temp config dirs, the remote user, and timestamps. This enables:
- `pidc down` — `docker stop` + `docker rm` + temp dir cleanup
- `pidc attach` — `docker exec -it` with the right container
- `pidc status` — cross-references state with live Docker status
- Falls back to label-based discovery if the state file is stale

## 5. Symlink fixup on Windows (`/mnt/host/`)

**Standard**: Bind mounts on Docker Desktop for Windows work transparently.

**pidc**: Docker Desktop rewrites symlink targets inside bind mounts with a `/mnt/host/` prefix. For example, an npm workspace symlink `node_modules/@foo/bar → ../../packages/bar` resolves to `/mnt/host/c/dev/repo/packages/bar` instead of `/c/dev/repo/packages/bar`. This path doesn't exist in the container.

**Fix**: pidc adds a `postCreateCommand` that creates `/mnt/host/<drive>` → `/<drive>` symlinks (e.g., `/mnt/host/c` → `/c`) via `sudo`. Only on Windows.

## 6. Monorepo root mounts for extensions

**Standard**: You mount exactly what you specify.

**pidc**: When an extension path (from pi's `settings.json`) is inside an npm workspace monorepo, pidc walks up the directory tree to find the monorepo root (a `package.json` with `workspaces`). It mounts the monorepo root instead of the individual package directory. This ensures hoisted `node_modules` are accessible for `require()` resolution.

The patched `settings.json` still references the specific package path — only the Docker mount is widened.

## 7. Paths under `~/.pi` are not mounted individually

**Standard**: N/A (this is pidc-specific).

**pidc**: The entire `~/.pi` directory is bind-mounted read-only into the container. Any extension or skill paths that live under `~/.pi/` are skipped from individual mounting — they're already accessible via the parent mount. This prevents duplicate skill/extension discovery (pi auto-scans `~/.pi/agent/skills/`).

## 8. Settings.json path patching (Windows only)

**Standard**: N/A.

**pidc**: On Windows, pi's `settings.json` contains Windows paths (`C:/dev/my-extension`). These don't exist inside the Linux container. pidc creates a patched copy in a temp directory that converts all extension/skill paths to their POSIX equivalents (`/c/dev/my-extension`) and mounts it over the original.

On Linux/macOS, the original `settings.json` is used as-is through the `~/.pi` mount — host paths are already valid POSIX paths.

## 9. Container user resolution

**Standard**: `devcontainer exec` respects `remoteUser` from the config automatically.

**pidc**: Since we use `docker exec`, we must handle `remoteUser` ourselves. pidc reads `remoteUser` from the project's devcontainer.json, derives the container home directory (`root` → `/root`, others → `/home/<user>`), passes `-u <user>` on docker exec calls, and persists the user in the state file. If no `remoteUser` is set, no `-u` flag is passed, deferring to the container's default (typically `root`).

## 10. Pi runtime isolation

**Standard**: Dev Container Features install into the container's filesystem alongside everything else.

**pidc**: The pi feature installs a completely isolated Node.js + pi + holdpty in `/opt/pi/`. It does not interfere with the project's Node.js version, global packages, or PATH ordering (beyond prepending `/opt/pi/bin`). This prevents pi's dependencies from conflicting with the project's.

## 11. Writable volume overlays on read-only mounts

**Standard**: Bind mounts are either RO or RW, no mixing.

**pidc**: The `~/.pi` directory is mounted read-only (agent config shouldn't be mutated from inside the container). However, pi needs to write to specific subdirectories (`todos/`, `memoria/`). pidc creates named Docker volumes and mounts them on top of the RO bind at those paths, creating a writable overlay. The writable paths are configurable via `~/.pi/devcontainers.json`.
