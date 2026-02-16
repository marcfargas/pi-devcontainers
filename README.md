# pi-devcontainers

Launch dev containers with [pi](https://github.com/badlogic/pi-mono) pre-installed and configured — without modifying project files.

## Why

Pi runs on the host OS. On Windows ARM (Surface Pro, etc.) this causes constant issues:

- Native Node.js modules fail to build or have no ARM64 binaries
- Path separators, symlinks, and filesystem behaviour differ from Linux
- Tools assume Linux/macOS and break subtly on Windows
- Every extension or skill must handle Windows edge cases

VS Code solved this exact problem with **Dev Containers** — run your dev environment in a consistent Linux container, regardless of host OS. `pidc` does the same for pi: wraps the standard `devcontainers` CLI, injects pi as a Dev Container Feature, mounts your config read-only, and manages the container lifecycle.

Your project's `devcontainer.json` is never modified. Everything pi needs is layered on top via a temporary merged config.

## Quick Start

```bash
# One-shot: up → attach → down when you detach
npx pidc run -w /path/to/project

# Or manage the lifecycle yourself
npx pidc up -w /path/to/project
npx pidc attach -w /path/to/project    # Ctrl+A d to detach
npx pidc down -w /path/to/project
```

Both `pidc` and `pi-devcontainers` work as commands.

## How It Works

1. **Reads** your project's `devcontainer.json` (if it exists)
2. **Reads** your pi config from `~/.pi/devcontainers.json`
3. **Resolves** extensions & skills from pi's `settings.json`
4. **Merges** everything into a temporary `devcontainer.json` (project config never modified)
5. **Launches** the container via `@devcontainers/cli`
6. **Starts pi** inside the container via [holdpty](https://github.com/marcfargas/holdpty)

```
Host (any OS)                            Container (Linux amd64)
┌─────────────────────────┐              ┌──────────────────────────────────┐
│ npx pidc up             │──── up ─────▶│ /opt/pi/          (node + pi)   │
│                         │              │                                  │
│ ~/.pi/ ─────────────────│──── RO ─────▶│ ~/.pi/            (config, RO)  │
│                         │              │ ~/.pi/todos/      (volume, RW)  │
│                         │              │ ~/.pi/memoria/    (volume, RW)  │
│                         │              │                                  │
│ extensions/ ────────────│──── RO ─────▶│ /c/dev/my-ext/    (monorepo)    │
│ skills/ ────────────────│──── RO ─────▶│ /c/dev/skills/    (skills)      │
│                         │              │                                  │
│ project/ ───────────────│── bind ─────▶│ /workspaces/project/ (RW)       │
│                         │◀── attach ──│                                  │
│                         │              │ holdpty → pi session             │
└─────────────────────────┘              └──────────────────────────────────┘
```

### Mount Architecture

| Mount | Type | Purpose |
|-------|------|---------|
| `~/.pi` → `~/.pi` | bind (RO) | All pi config: agent settings, skills, extensions references |
| `~/.pi/todos` | bind (RW) | Writable overlay for TODO persistence |
| `~/.pi/memoria` | bind (RW) | Writable overlay for agent memory |
| Extension/skill dirs | bind (RO) | Each path from `settings.json`, mounted at POSIX equivalent |
| `settings.json` | bind (file) | **Windows only** — patched copy with path conversion |
| Project dir | bind (RW) | Your project workspace |

Extensions in monorepos are mounted at the monorepo root so hoisted `node_modules` resolve correctly.

On **Windows**, a patched `settings.json` is bind-mounted over the original to convert `C:/dev/…` paths to `/c/dev/…`. On **Linux/macOS**, the original is used as-is.

### Merge Strategy

Your project's `devcontainer.json` is the **base**. pidc only **adds**:

| Field | How |
|-------|-----|
| `features` | Adds the pi feature |
| `mounts` | Appends pi mounts |
| `remoteEnv` | Merges — project vars take precedence |
| `postCreateCommand` | Chains pi setup (symlink fixup on Windows) |
| Everything else | **Untouched** (image, build, ports, customizations…) |

If your project has no `devcontainer.json`, a minimal one is generated with the configured default image.

## Configuration

Configuration is layered: **CLI flags > project > user > defaults**.

### User config: `~/.pi/devcontainers.json`

Global preferences — applies to all projects:

```jsonc
{
  "nodeVersion": "22.14.0",
  "piVersion": "latest",
  "mode": "holdpty",
  "writable": ["todos", "memoria"],
  "extensions": "pack",
  "env": {
    "CREDENTIAL_BROKER_URL": null,   // null = copy from host
    "CUSTOM_VAR": "explicit-value"
  },
  "defaultImage": "mcr.microsoft.com/devcontainers/base:ubuntu"
}
```

All fields optional — sensible defaults for anything omitted.

### Project config: `<project>/.pi/devcontainers.json`

Per-project overrides — same schema, takes precedence over user config:

```jsonc
{
  "defaultImage": "node:22",              // project needs Node
  "env": {
    "DATABASE_URL": null                  // copy from host for this project
  },
  "writable": ["experiments"]             // extra writable dir (merged with user)
}
```

Useful for pinning a base image, adding project-specific env vars, or extra writable mounts.

## CLI Reference

```
npx pidc <command> [options]

Commands:
  run      up + attach + down in one step (like docker run)
  up       Create and start a devcontainer with pi
  attach   Attach to a running pi session
  down     Stop and remove the devcontainer
  status   List running pi devcontainers

Options:
  -w, --workspace-folder <path>  Project path (default: cwd)
  --mode <holdpty|pi-server>     Override run mode
  --writable <path>              Additional writable dir (repeatable)
  -e, --env <KEY=VALUE|KEY>      Set env var or copy from host
  --rebuild                      Force rebuild of container
  --no-extensions                Skip extension/skill mounting
  -v, --verbose                  Show full build output
```

## Dev Container Feature

The feature installs an **isolated** Node.js + pi + holdpty in `/opt/pi/`. It does not touch the container's existing Node.js or project dependencies.

The feature is published at `ghcr.io/marcfargas/devcontainer-features/pi` and added automatically by the CLI — you never reference it in your project's config.

## Non-Standard Behaviour

pidc wraps the devcontainers CLI but deviates from standard behaviour in several ways (using `docker exec` instead of `devcontainer exec`, injecting terminal env vars, fixing Docker Desktop symlink paths, etc.).

See [DEVIATIONS.md](./DEVIATIONS.md) for the complete list with explanations.

## Development

```bash
git clone https://github.com/marcfargas/pi-devcontainers
cd pi-devcontainers
npm install
npm run build
npm test
```

### Monorepo Structure

```
packages/
├── cli/        # Host CLI (npx pidc)
├── feature/    # Dev Container Feature (install.sh)
└── wrapper/    # npm name squatting (pi-devcontainers → @marcfargas/pi-devcontainers)
test/
├── unit/       # Unit tests (paths, config, merge, extensions, state)
└── integration/
```

### Lifecycle & State

The devcontainers CLI has no `down`/`stop`/`status`. pidc fills that gap with a state file (`~/.pi/devcontainers-state.json`) mapping workspaces to container IDs. Falls back to Docker label discovery if the state file is stale.

## License

**Code**: [MIT](./LICENSE)

**Skills** (`skills/`): [CC0 1.0 Universal](./skills/LICENSE) — public domain, no attribution required.
