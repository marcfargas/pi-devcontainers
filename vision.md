# pi-devcontainers — Vision

## Problem — What exists and why it's not good enough

Pi (the coding agent) runs on the host OS. On Windows ARM (Surface Pro, etc.), this causes constant issues:
- Native Node.js modules fail to build or have no ARM64 binaries
- Path separators, symlinks, and filesystem behavior differ from Linux
- Tools assume Linux/macOS and break subtly on Windows
- Every pi extension or tool we develop must handle Windows ARM edge cases

VS Code solved this exact problem with **Dev Containers** — run your dev environment in a Linux container, regardless of host OS. We should do the same for pi.

## Goal — What we're building and for whom

**`pi-devcontainers`**: An npm package that lets a pi user launch any project inside a Dev Container with pi pre-installed and configured, without modifying the project's `devcontainer.json`.

**Target user**: A developer already using pi who hits environment issues (Windows ARM primarily, but also useful for reproducible environments on any OS).

**Usage**:
```bash
npx pi-devcontainers up --workspace-folder /c/dev/credential-broker
npx pi-devcontainers attach credential-broker
npx pi-devcontainers down credential-broker
```

## Current State — What exists

- **Dev Containers spec**: Well-established standard with a CLI (`@devcontainers/cli`)
- **Dev Container Features**: Composable units that add tools to containers
- **pi**: Currently installed globally on host, with extensions via `npm link` for development
- **`~/.pi/`**: User's pi config — agents, skills, extensions, todos, memoria
- **holdpty**: Detached PTY sessions that we can use for running pi inside containers
- **pi-server** (upcoming): Will allow headless pi with remote client connection

The `devcontainers` CLI already supports injection of features, mounts, env vars, and config overrides via CLI flags — all without modifying the project:
```
--override-config     Merge/override devcontainer.json
--additional-features Inject features not in project config
--mount               Additional bind/volume mounts
--remote-env          Inject environment variables
--secrets-file        Secret env vars from JSON file
```

## Architecture — How it should work

### Components (single repo)

```
pi-devcontainers/
├── packages/
│   ├── cli/                    # npm package: pi-devcontainers
│   │   ├── src/
│   │   │   ├── index.ts        # CLI entry point
│   │   │   ├── commands/
│   │   │   │   ├── up.ts       # Launch devcontainer with pi
│   │   │   │   ├── attach.ts   # Attach to running pi session
│   │   │   │   └── down.ts     # Stop container
│   │   │   ├── config.ts       # Read/merge ~/.pi/devcontainers.json
│   │   │   ├── merge.ts        # Merge project + pi devcontainer.json
│   │   │   ├── extensions.ts   # Detect linked exts, npm pack them
│   │   │   └── holdpty.ts      # holdpty integration
│   │   └── package.json
│   │
│   └── feature/                # Dev Container Feature
│       ├── devcontainer-feature.json
│       ├── install.sh          # Build-time: install isolated node + pi
│       └── setup.sh            # postCreate: unpack extensions, configure
│
├── test/                       # Integration tests (docker-in-docker)
└── package.json                # Monorepo root
```

### Flow

```
Host (any OS)
┌──────────────────────────────────────────────────────┐
│  npx pi-devcontainers up --workspace-folder <project>│
│                                                      │
│  1. Read ~/.pi/devcontainers.json (user prefs)       │
│  2. Read <project>/.devcontainer/devcontainer.json   │
│  3. Detect npm-linked extensions in pi's node_modules│
│  4. npm pack each linked extension → staging dir     │
│  5. Merge devcontainer.json:                         │
│     - Project base (features, Dockerfile, etc.)      │
│     - + pi feature (adds /opt/pi with node + pi)     │
│     - + mounts (RO ~/.pi, volumes for writable dirs, │
│       extension tarballs)                             │
│     - + remoteEnv (broker creds, copied env vars)    │
│     - + postCreateCommand (chained with project's):  │
│       unpack extension tarballs, copy config          │
│  6. Write merged json to temp file                   │
│  7. devcontainer up --config <temp> --workspace <prj> │
│  8. devcontainer exec holdpty start pi -- pi          │
│     (or: devcontainer exec pi-server, in the future)  │
└──────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────┐
│  Container (Linux)                                   │
│                                                      │
│  /opt/pi/bin/node     ← isolated Node.js LTS         │
│  /opt/pi/bin/pi       ← pi-coding-agent              │
│  /opt/pi-host-config/ ← ~/.pi RO bind mount          │
│  /opt/pi-ext-staging/ ← packed extension tarballs     │
│                                                      │
│  ~/.pi/               ← built from host config:      │
│    agent/, skills/    ← copied from RO mount          │
│    todos/             ← Docker volume (writable)      │
│    memoria/           ← Docker volume (writable)      │
│    node_modules/      ← extensions installed from     │
│                         unpacked tarballs             │
│                                                      │
│  /workspace/          ← project source (bind mount)   │
│                                                      │
│  holdpty: pi running in detached PTY                  │
└──────────────────────────────────────────────────────┘
```

### Devcontainer Feature: `pi`

The feature is deliberately dumb — it only installs the runtime at build time:

```bash
# install.sh — runs during docker build, no mounts available
PI_HOME=/opt/pi
NODE_VERSION="${VERSION:-22.14.0}"  # from feature options
ARCH=$(dpkg --print-architecture)   # amd64 or arm64

# Download and install Node.js (isolated, not in PATH)
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" \
  | tar -xJ -C $PI_HOME --strip-components=1

# Install pi
$PI_HOME/bin/npm install -g @mariozechner/pi-coding-agent

# Wrapper in PATH
cat > /usr/local/bin/pi << 'WRAPPER'
#!/bin/sh
exec /opt/pi/bin/node /opt/pi/bin/pi "$@"
WRAPPER
chmod +x /usr/local/bin/pi
```

The `setup.sh` (runs at postCreate, mounts ARE available):

```bash
# Copy host config (read-only mount) as base
cp -a /opt/pi-host-config/agent ~/.pi/agent 2>/dev/null || true
cp -a /opt/pi-host-config/skills ~/.pi/skills 2>/dev/null || true
# ... other non-writable dirs

# Install packed extensions
if [ -d /opt/pi-ext-staging ]; then
  for tarball in /opt/pi-ext-staging/*.tgz; do
    /opt/pi/bin/npm install -g "$tarball"
  done
fi
```

### User Config: `~/.pi/devcontainers.json`

```jsonc
{
  // Node.js version for the isolated pi install
  "nodeVersion": "22.14.0",
  
  // pi version (npm semver or "latest")
  "piVersion": "latest",
  
  // How to run pi inside the container
  "mode": "holdpty",     // "holdpty" | "pi-server" (future)
  
  // Dirs under ~/.pi that should be writable (Docker volumes)
  // Relative to ~/.pi, or absolute paths
  "writable": ["todos", "memoria"],
  
  // How to handle npm-linked extensions
  // "pack" = npm pack on host, install tarballs in container
  // "registry" = install published versions from npm
  // "skip" = don't install any extensions
  "extensions": "pack",
  
  // Environment variables to inject
  // With value: set explicitly
  // Without value (null): copy from host environment
  "env": {
    "CREDENTIAL_BROKER_URL": null,
    "CREDENTIAL_BROKER_TOKEN": null,
    "CUSTOM_VAR": "explicit-value"
  }
}
```

### CLI Interface

```
npx pi-devcontainers up [options]
  --workspace-folder <path>    Project path (required, or cwd)
  --mode <holdpty|pi-server>   Override mode from config
  --writable <path>            Additional writable path (repeatable)
  --env <KEY=VALUE|KEY>        Env var: with value = set, without = copy from host (repeatable)
  --no-extensions              Skip extension packing/installation
  --rebuild                    Force rebuild of container image

npx pi-devcontainers attach [name]
  Attach to a running pi holdpty session inside a container.
  Name is derived from workspace folder (or explicit).

npx pi-devcontainers down [name]
  Stop and remove the dev container.

npx pi-devcontainers status
  List running pi devcontainers and their status.
```

### Merge Strategy

The merge is **additive only** on the project's devcontainer.json:

1. **`features`**: Add `"ghcr.io/our-org/pi:1": { options }` to existing features
2. **`mounts`**: Append pi mounts to existing mounts array
3. **`remoteEnv`**: Merge pi env vars into existing (pi vars don't overwrite project vars)
4. **`postCreateCommand`**: Chain with existing:
   - If project has string: `"existing-cmd && /opt/pi/setup.sh"`
   - If project has object: add `"pi-setup": "/opt/pi/setup.sh"` key
   - If project has array: append
5. **Everything else**: Untouched (image, Dockerfile, build, ports, etc.)
6. **No project config**: Generate a minimal devcontainer.json with just pi's needs + a base image

## Phases / Priority

### Phase 1: Core CLI + Feature (MVP)
- [ ] Repo setup (TypeScript, monorepo if needed)
- [ ] Dev Container Feature: install isolated node + pi
- [ ] CLI: `up` command — config reading, merge, devcontainer up
- [ ] CLI: `attach` command — holdpty attach
- [ ] CLI: `down` command — stop container
- [ ] Basic `~/.pi/devcontainers.json` support
- [ ] Test: credential-broker project (Rust project, needs Linux)

### Phase 2: Extensions + Polish
- [ ] npm pack flow for linked extensions
- [ ] Extension install from registry
- [ ] RO mount + writable volume overlay
- [ ] `status` command
- [ ] Error handling and user-friendly messages

### Phase 3: pi-server mode
- [ ] pi-server integration when available
- [ ] Mode switching (holdpty ↔ pi-server)
- [ ] Port forwarding for pi-server

### Phase 4: Publishing
- [ ] Publish feature to GHCR
- [ ] Publish CLI to npm
- [ ] Documentation

## Constraints

- **Cross-platform**: CLI must work on Windows (Git Bash, PowerShell, CMD), macOS, Linux
- **TypeScript**: All CLI code in TypeScript
- **npm**: Published as npm package, usable via `npx`
- **No project modification**: Never writes to the project's devcontainer.json or any project file
- **Isolated Node.js**: Pi's node inside container must not interfere with project's node
- **devcontainers CLI**: We delegate all container lifecycle to `@devcontainers/cli`, we don't talk to Docker directly
- **Single repo**: Feature + CLI + tests in one repo
- **Testing**: Integration tests using docker-in-docker

## Risks

1. **`--override-config` semantics**: Need to verify if it merges or replaces. If it replaces, we must use `--config` with our merged file. *(Mitigated: we generate a merged temp file regardless)*
2. **holdpty inside container**: `devcontainer exec` may not forward TTY properly for holdpty attach. *(Mitigated: test early, fallback to plain exec)*
3. **Extension packing latency**: `npm pack` for many extensions on every `up` could be slow. *(Mitigated: cache tarballs, check mtimes)*
4. **Feature caching**: Dev Container Features are cached in the image layer. Version bumps need `--rebuild`. *(Mitigated: document, add `--rebuild` flag)*
5. **Secrets in transit**: Env vars with broker credentials are visible in `docker inspect`. *(Mitigated: use `--secrets-file` for sensitive vars, which the CLI supports)*
6. **postCreateCommand chaining**: Different formats (string, array, object) make merging complex. *(Mitigated: handle all three formats explicitly)*

## Open Questions

1. **Feature distribution**: GHCR (standard for features) or bundled in the npm package? GHCR requires a registry. Could we embed the feature in the CLI and copy it to a temp dir?
2. **Container naming**: How to name/label containers so `attach` and `down` can find them? The devcontainers CLI uses workspace-folder-based labels by default.
3. **Multiple pi sessions**: Should we support multiple concurrent pi sessions in the same container? Probably not for MVP.
4. **Config file watching**: Should `up` detect config changes and suggest rebuild? Nice to have, not MVP.
5. **holdpty installation**: holdpty needs to be available inside the container. Ship it with the feature? Or as a separate feature?
6. **Project without devcontainer.json**: What base image to use? Ubuntu? The devcontainers universal image? Configurable?
