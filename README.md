# pi-devcontainers

Launch dev containers with [pi](https://github.com/badlogic/pi-mono) pre-installed and configured — without modifying project files.

Solves the "Windows ARM problem": native module failures, path inconsistencies, and tool incompatibilities by running pi inside a consistent Linux container environment.

## Quick Start

```bash
# Launch a devcontainer with pi for your project
npx pidc up -w /path/to/project

# Attach to the running pi session
npx pidc attach -w /path/to/project

# Stop the container
npx pidc down -w /path/to/project
```

Both `pidc` and `pi-devcontainers` work as commands.

## How It Works

1. **Reads your project's** `devcontainer.json` (if it exists)
2. **Reads your pi config** from `~/.pi/devcontainers.json`
3. **Resolves extensions & skills** from pi's `settings.json` — mounts them directly into the container
4. **Merges** everything into a temporary `devcontainer.json` — your project's config is never modified
5. **Launches** the container via `@devcontainers/cli`
6. **Starts pi** inside the container via [holdpty](https://github.com/marcfargas/holdpty)

```
Host (any OS)                            Container (Linux)
┌─────────────────────────┐              ┌──────────────────────────────────┐
│ npx pidc up             │──── up ─────▶│ /opt/pi/          (node + pi)   │
│                         │              │                                  │
│ ~/.pi/ ─────────────────│──── RO ─────▶│ ~/.pi/            (config, RO)  │
│                         │              │ ~/.pi/todos/      (volume, RW)  │
│                         │              │ ~/.pi/memoria/    (volume, RW)  │
│                         │              │                                  │
│ C:/dev/my-ext/ ─────────│──── RO ─────▶│ /c/dev/my-ext/    (extension)   │
│ C:/dev/skills/ ─────────│──── RO ─────▶│ /c/dev/skills/    (skills)      │
│                         │              │                                  │
│ project/ ───────────────│── bind ─────▶│ /workspaces/project/ (project)  │
│                         │◀── attach ──│                                  │
│                         │              │ holdpty → pi session             │
└─────────────────────────┘              └──────────────────────────────────┘
```

### Mount Architecture

Pi's configuration and code reach the container through layered mounts:

| Mount | Type | What |
|-------|------|------|
| `~/.pi` → `~/.pi` | bind (RO) | All pi config: agent, settings, skills references |
| `~/.pi/todos` | volume (RW) | Writable overlay for TODO persistence |
| `~/.pi/memoria` | volume (RW) | Writable overlay for agent memory |
| Extension/skill dirs | bind (RO) | Each path from `settings.json`, mounted at the POSIX equivalent |
| `settings.json` | bind (file) | **Windows only** — patched copy with `C:/dev/…` → `/c/dev/…` path conversion |
| Project dir | bind (RW) | Your project workspace |

On **Linux/macOS**, the original `settings.json` is used as-is through the `~/.pi` RO mount — live config reload works normally. On **Windows**, a patched copy is bind-mounted over it because Windows paths (`C:/dev/…`) must be converted to POSIX (`/c/dev/…`) for the Linux container.

## User Configuration

Create `~/.pi/devcontainers.json`:

```jsonc
{
  // Node.js version for pi's isolated runtime
  "nodeVersion": "22.14.0",

  // Pi version (npm semver or "latest")
  "piVersion": "latest",

  // How to run pi: "holdpty" (default) or "pi-server" (future)
  "mode": "holdpty",

  // Dirs under ~/.pi that need to be writable (Docker volumes)
  "writable": ["todos", "memoria"],

  // Extension handling: "pack" (mount from host) or "skip" (none)
  "extensions": "pack",

  // Environment variables to inject
  // With value: set explicitly
  // Without value (null): copy from host environment
  "env": {
    "CREDENTIAL_BROKER_URL": null,
    "CREDENTIAL_BROKER_TOKEN": null,
    "CUSTOM_VAR": "explicit-value"
  },

  // Default base image for projects without devcontainer.json
  "defaultImage": "mcr.microsoft.com/devcontainers/base:ubuntu"
}
```

All fields are optional — sensible defaults are used for anything omitted.

## CLI Reference

```
npx pidc <command> [options]

Commands:
  up       Create and start a devcontainer with pi
  attach   Attach to a running pi session
  down     Stop and remove the devcontainer
  status   List running pi devcontainers

Options:
  -w, --workspace-folder <path>  Project path (default: cwd)
  --mode <holdpty|pi-server>     Override run mode
  --writable <path>              Additional writable dir (repeatable)
  -e, --env <KEY=VALUE|KEY>      Set env var (KEY=VALUE) or copy from host (KEY)
  --rebuild                      Force rebuild of container
  --no-extensions                Skip extension/skill mounting
```

## How the Merge Works

Your project's `devcontainer.json` is the **base**. pi-devcontainers only **adds**:

| What | How |
|------|-----|
| `features` | Adds the pi feature to the existing features object |
| `mounts` | Appends pi mounts (RO config, writable volumes, extension/skill dirs) |
| `remoteEnv` | Merges — project vars take precedence over pi vars |
| `postCreateCommand` | **Untouched** — pi uses mounts, no setup chaining needed |
| Everything else | **Untouched** (image, build, ports, customizations, etc.) |

If your project has no `devcontainer.json`, a minimal one is generated with the configured default image.

## Dev Container Feature

The feature installs an **isolated** Node.js + pi + holdpty in `/opt/pi/`. It does not touch the container's existing Node.js or any project dependencies.

```
/opt/pi/
├── bin/
│   ├── node
│   ├── npm
│   ├── pi
│   └── holdpty
├── lib/
└── setup.sh
```

The feature is added automatically by the CLI — you never need to reference it in your project's `devcontainer.json`.

## Development

```bash
git clone https://github.com/marcfargas/pi-devcontainers
cd pi-devcontainers
npm install
npm run build
npm test                    # unit tests
npm run test:integration    # Docker integration tests
```

### Monorepo Structure

```
packages/
├── cli/        # Host CLI (npx pidc)
├── feature/    # Dev Container Feature (install.sh, setup.sh)
└── wrapper/    # npm name squatting (pi-devcontainers → @marcfargas/pi-devcontainers)
test/
├── unit/       # 63 unit tests (paths, config, merge, extensions, state)
└── integration/
```

### Lifecycle & State

The devcontainers CLI provides `up` but no `down`/`stop`. pidc fills that gap:

- **State file** (`~/.pi/devcontainers-state.json`): persists container IDs, workspace mappings, and temp dir paths after each `pidc up`
- **`pidc down`**: uses `docker stop`/`rm` with the saved container ID, cleans up temp dirs
- **`pidc attach`**: uses `docker exec -it` directly (bypasses devcontainer exec which requires a config file in the workspace)
- **`pidc status`**: reads state file, cross-references with Docker for live status
- **Fallback**: if the state file is missing/stale, containers are found by Docker label (`devcontainer.local_folder`)

## License

**Code**: [MIT](./LICENSE)

**Skills** (`skills/`): [CC0 1.0 Universal](./skills/LICENSE) — public domain, no attribution required.
