# Deviations from Standard Dev Containers

Current `pidc` behavior that differs from using `@devcontainers/cli` directly.

> This file reflects the **current** simplified architecture.
> Historical deviations removed in the refactor (docker-exec runtime, state file, manual env/user/cwd handling)
> are listed at the end.

## 1. Temporary merged config for `up`

**Standard**: `devcontainer up` reads `.devcontainer/devcontainer.json` from the workspace.

**pidc**: Builds a temporary merged `devcontainer.json` (project config + pi additions), then runs:

```bash
devcontainer up --workspace-folder <project> --config <temp>
```

The project file is never modified.

After `up`, temp config is deleted immediately.

## 2. Pi-specific feature + mounts are injected

`pidc` appends pi requirements to the merged config:
- pi feature (`ghcr.io/marcfargas/devcontainer-features/pi`)
- `~/.pi` bind mount (RO)
- writable overlays (`todos`, `memoria`, configurable)
- extension/skill mounts
- `remoteEnv` additions

Project settings still take precedence where intended (e.g. existing `remoteEnv` keys).

## 3. Windows symlink fixup (`/mnt/host/*`)

On Docker Desktop for Windows, bind-mount symlink targets can be rewritten with `/mnt/host/...` paths that
are not resolvable in-container.

`pidc` chains a Windows-only `postCreateCommand` to create links like:

```bash
/mnt/host/c -> /c
```

## 4. Monorepo root mounting for extensions

If an extension path is inside an npm workspace monorepo, `pidc` mounts the monorepo root (RO) instead of only
that package directory so hoisted `node_modules` resolve correctly.

## 5. `~/.pi` subpaths are deduped from explicit mounts

Paths under `~/.pi` are not mounted individually because `~/.pi` is already mounted as a parent bind mount.

## 6. Windows `settings.json` path patching

On Windows, pi settings can contain Windows paths (`C:/...`) that are invalid in Linux containers.

`pidc` generates a patched `settings.json` with POSIX paths (`/c/...`) and bind-mounts that file in-container.

## 7. Pi runtime isolation

The feature installs isolated Node + pi + holdpty in `/opt/pi/`, avoiding conflicts with project Node/tooling.

## 8. Writable overlays on a read-only `~/.pi`

`~/.pi` is mounted RO, but selected subdirectories (default: `todos`, `memoria`) are mounted RW on top.

---

## Removed Historical Deviations (no longer true)

These were intentionally removed in the simplification refactor:

- Using raw `docker exec` for runtime commands (now `devcontainer exec --workspace-folder`)
- Manual injection of terminal env vars on every exec
- Manual user/CWD resolution for attach/run
- State file (`~/.pi/devcontainers-state.json`) for lifecycle mapping
