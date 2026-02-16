# pi-devcontainers — Agent Guide

## What This Is

CLI tool (`pidc`) that wraps `@devcontainers/cli` to launch any project inside a Dev Container with pi pre-installed. Solves Windows ARM environment issues without modifying project files.

## Architecture

```
packages/
├── cli/        # Host-side CLI (TypeScript, the main package)
│   └── src/
│       ├── index.ts        # CLI entry point, arg parsing
│       ├── config.ts       # ~/.pi/devcontainers.json + CLI overrides
│       ├── merge.ts        # Merge project + pi devcontainer.json (CORE LOGIC)
│       ├── extensions.ts   # Resolve extensions/skills from settings.json
│       ├── paths.ts        # Cross-platform path helpers
│       ├── exec.ts         # Docker + devcontainer CLI wrappers
│       ├── state.ts        # Container state persistence
│       └── commands/       # up, down, attach, run, status
├── feature/    # Dev Container Feature (shell scripts, runs inside container)
│   ├── install.sh          # Installs isolated node + pi + holdpty in /opt/pi
│   └── devcontainer-feature.json
└── wrapper/    # npm name squatting (pi-devcontainers → @marcfargas/pi-devcontainers)
test/
├── unit/       # 63 tests — paths, config, merge, extensions, state
└── integration/
```

## Key Design Decisions

- **Never modify project files** — temp merged config in $TEMP, `--config` flag
- **Additive-only merge** — project devcontainer.json is the base, pi adds features/mounts/env
- **Docker exec, not devcontainer exec** — devcontainer exec needs config in workspace; we use docker directly with saved container IDs
- **Layered mounts** — RO bind `~/.pi`, writable volume overlays for todos/memoria
- **Monorepo root mounts** — extensions in monorepos mount at the workspace root for node_modules resolution
- **Windows path conversion** — `C:/dev/…` → `/c/dev/…` in patched settings.json
- **Feature from GHCR** — `ghcr.io/marcfargas/devcontainer-features/pi:0`, never local
- **`/mnt/host` symlink fixup** — Docker Desktop rewrites symlink targets; postCreateCommand creates `/mnt/host/c` → `/c`

Read [DEVIATIONS.md](../DEVIATIONS.md) for the full list of non-standard behaviours.

## Development Workflow

```bash
npm install
npm run build           # builds packages/cli
npm test                # 63 unit tests (vitest)
npm link -w packages/cli  # makes pidc available globally (NOT npm link at root)
```

### Testing E2E

```bash
pidc up -w test/integration/fixtures/minimal --rebuild -v
pidc attach -w test/integration/fixtures/minimal
pidc down -w test/integration/fixtures/minimal
```

Or all-in-one: `pidc run -w test/integration/fixtures/minimal --rebuild`

### Publishing the Feature

Feature is published to GHCR from `packages/feature/`:
```bash
# In a separate repo: github.com/marcfargas/devcontainer-features
# Feature source is copied there and published via devcontainer features publish
```

## Gotchas

- **`npm link -w packages/cli`** not `npm link` at repo root — the CLI is in a workspace
- **`--build-no-cache`** may not bust Docker's feature layer cache; check `holdpty --version` inside container after rebuild
- **Git Bash + docker exec -it** — doesn't work (no TTY); use PowerShell or Windows Terminal for interactive testing
- **`$PATH` expansion in Git Bash** — escape with single quotes when passing to docker exec `-e`
- **Feature installs holdpty from npm** — local holdpty changes need npm publish to reach containers

## Stack

- TypeScript (ESM, Node 20+)
- Vitest for tests
- npm workspaces monorepo
- No framework dependencies — pure Node.js APIs + child_process for docker/devcontainer CLI
