# pi-devcontainers

Launch dev containers with [pi](https://github.com/badlogic/pi-mono) pre-installed and configured — without modifying project files.

Solves the "Windows ARM problem": native module failures, path inconsistencies, and tool incompatibilities by running pi inside a consistent Linux container environment.

## Quick Start

```bash
# Launch a devcontainer with pi for your project
npx @marcfargas/pi-devcontainers up -w /path/to/project

# Attach to the running pi session
npx @marcfargas/pi-devcontainers attach -w /path/to/project

# Stop the container
npx @marcfargas/pi-devcontainers down -w /path/to/project
```

## How It Works

1. **Reads your project's** `devcontainer.json` (if it exists)
2. **Reads your pi config** from `~/.pi/devcontainers.json`
3. **Packs linked extensions** via `npm pack` (so they work inside the container)
4. **Merges** everything into a temporary `devcontainer.json` — your project's config is never modified
5. **Launches** the container via `@devcontainers/cli`
6. **Starts pi** inside the container via [holdpty](https://github.com/marcfargas/holdpty)

```
Host (any OS)                          Container (Linux)
┌───────────────────────┐              ┌────────────────────────────┐
│ npx pi-devcontainers  │──── up ─────▶│ /opt/pi/      (node + pi) │
│                       │              │ /opt/pi-host-config/ (RO)  │
│ ~/.pi/ (your config)  │              │ ~/.pi/todos/  (volume, RW) │
│                       │◀── attach ──│ ~/.pi/memoria (volume, RW) │
│                       │              │ /workspace/   (project)    │
└───────────────────────┘              │ holdpty → pi session       │
                                       └────────────────────────────┘
```

## User Configuration

Create `~/.pi/devcontainers.json`:

```jsonc
{
  // Node.js version for pi's isolated runtime
  "nodeVersion": "22.14.0",
  
  // Pi version (npm semver or "latest")
  "piVersion": "latest",
  
  // How to run pi: "holdpty" (now) or "pi-server" (future)
  "mode": "holdpty",
  
  // Dirs under ~/.pi that need to be writable (Docker volumes)
  "writable": ["todos", "memoria"],
  
  // How to handle npm-linked extensions
  // "pack" = npm pack on host, install in container
  // "registry" = install from npm registry
  // "skip" = no extensions
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
  "defaultImage": "mcr.microsoft.com/devcontainers/universal:latest"
}
```

## CLI Reference

```
npx @marcfargas/pi-devcontainers <command> [options]

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
  --no-extensions                Skip extension packing
```

## How the Merge Works

Your project's `devcontainer.json` is the **base**. pi-devcontainers only **adds**:

| What | How |
|------|-----|
| `features` | Adds the pi feature to the existing features object |
| `mounts` | Appends pi mounts (RO config, writable volumes, extension tarballs) |
| `remoteEnv` | Merges — project vars take precedence over pi vars |
| `postCreateCommand` | Chains — string: `&&`, array: converts to object, object: adds `pi-setup` key |
| Everything else | **Untouched** (image, build, ports, customizations, etc.) |

If your project has no `devcontainer.json`, a minimal one is generated with the configured default image.

## Dev Container Feature

The feature installs an **isolated** Node.js + pi + holdpty in `/opt/pi`. It does not touch the container's existing Node.js or any project dependencies.

## Development

```bash
git clone https://github.com/marcfargas/pi-devcontainers
cd pi-devcontainers
npm install
npm run build
npm test                    # unit tests
npm run test:integration    # Docker integration tests
```

## License

**Code**: [MIT](./LICENSE)

**Skills** (`skills/`): [CC0 1.0 Universal](./skills/LICENSE) — public domain, no attribution required.
