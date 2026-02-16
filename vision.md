# pi-devcontainers — Simplification Review

## Problem — What exists and why it's too much

`pidc` is a ~1650-line TypeScript CLI that wraps `@devcontainers/cli` to launch
dev containers with the [pi coding agent](https://github.com/nicepkg/pi) pre-installed.

It has grown to take on responsibilities that the standard devcontainer runtime already
handles, leading to 11 documented deviations from standard behaviour and a steady stream of
bugs (the current one: CWD breaks when a project has `postCreateCommand`).

### What pidc currently does (source files, LOC)

| File | LOC | Responsibility |
|------|-----|----------------|
| `index.ts` | 190 | CLI arg parser + command dispatch |
| `commands/up.ts` | 195 | Main orchestration: read configs → merge → devcontainer up → holdpty |
| `merge.ts` | 235 | Additive merge of project devcontainer.json with pi's needs |
| `exec.ts` | 299 | Shell-out to devcontainer CLI, docker exec helpers, JSON output parsing |
| `extensions.ts` | 220 | Resolve pi extensions/skills → bind mounts + patched settings.json |
| `config.ts` | 144 | 3-layer config: defaults ← user ← project ← CLI flags |
| `paths.ts` | 69 | Cross-platform path normalization (Git Bash ↔ Windows ↔ POSIX) |
| `state.ts` | 72 | Persist container state to `~/.pi/devcontainers-state.json` |
| `commands/attach.ts` | 66 | `docker exec -it holdpty attach` |
| `commands/down.ts` | 69 | `docker stop` + `rm` + temp dir cleanup |
| `commands/run.ts` | 50 | `up` + `attach` + `down` |
| `commands/status.ts` | 43 | List tracked containers |

### The 11 deviations (from DEVIATIONS.md)

1. **Docker exec instead of devcontainer exec** — because our merged config is in a temp dir
2. **Terminal env injected explicitly** — because remoteEnv is invisible to docker exec
3. **Temporary merged config** — project's devcontainer.json is never modified
4. **State file for lifecycle** — because devcontainer CLI has no down/status
5. **Symlink fixup on Windows** (`/mnt/host/`) — Docker Desktop rewrites symlink targets
6. **Monorepo root mounts for extensions** — walk up to find workspace root
7. **Paths under `~/.pi` skip individual mounting** — parent mount covers them
8. **Settings.json path patching (Windows)** — convert Windows paths to POSIX
9. **Container user resolution** — manual `-u` on docker exec
10. **Pi runtime isolation** — isolated Node.js in `/opt/pi/`
11. **Writable volume overlays on RO mounts** — RO bind for `~/.pi`, writable overlays for `todos/` and `memoria/`

### The CWD bug (current trigger for this review)

When a project's devcontainer.json has `postCreateCommand`, pi starts with CWD `/` instead of
the project workspace. Root cause: pidc parses the `devcontainer up` JSON output to get
`remoteWorkspaceFolder`, but the output can contain log lines that break `JSON.parse`, and the
regex fallback doesn't extract the workspace path. **This entire class of bug exists because
we parse CLI output instead of letting the devcontainer runtime handle CWD.**

## Goal — What we want instead

A minimal CLI that:
1. Generates a merged devcontainer.json (the one thing we MUST do ourselves)
2. Delegates everything else to the devcontainer CLI / runtime
3. Is small enough that bugs are obvious and rare

### Core question: what MUST pidc do vs what can the devcontainer runtime do?

**MUST do ourselves:**
- Merge pi feature + mounts + env into a temp devcontainer.json (project file stays untouched)
- Resolve which host paths need bind-mounting (extensions, skills, `~/.pi`)

**Can the devcontainer runtime handle:**
- Working directory (CWD) — it's `workspaceFolder` in the config
- Environment variables — `remoteEnv` in the config
- User context — `remoteUser` in the config
- Lifecycle hooks — `postCreateCommand` etc.
- Container exec — `devcontainer exec --config <temp>`

**Currently doing ourselves unnecessarily:**
- Parsing JSON output from `devcontainer up` to extract `remoteWorkspaceFolder` — could pass `--config` to `devcontainer exec` instead
- Maintaining a state file — could use `devcontainer exec --config <temp>` with the temp config
- Injecting TERM/COLORTERM/LANG via docker exec flags — could use `remoteEnv`
- Manual docker exec for attach — `devcontainer exec` handles user + env + CWD

## Current State — The architecture

```
Host (Windows/Linux/macOS)
  └─ pidc CLI
       ├─ Reads: project devcontainer.json, ~/.pi/devcontainers.json, 
       │         project .pi/devcontainers.json, ~/.pi/agent/settings.json
       ├─ Writes: temp dir with merged devcontainer.json (+patched settings.json on Win)
       ├─ Calls: npx @devcontainers/cli up --workspace-folder <project> --config <temp>
       ├─ Parses: JSON output → containerId, remoteWorkspaceFolder
       ├─ Saves: state to ~/.pi/devcontainers-state.json
       ├─ Calls: docker exec <container> holdpty launch --bg --name pi -- pi
       └─ Later: docker exec <container> holdpty attach pi
```

The temp config is the root cause of most deviations: once the config lives outside the
project, `devcontainer exec` can't find it, so we fall back to raw `docker exec` and must
manually handle everything `devcontainer exec` normally provides.

## Proposed Simplification — Key question

**Can we keep the temp config path around and pass `--config <temp>` to `devcontainer exec`?**

If yes, we eliminate deviations 1, 2, 4, 9 and the CWD bug class entirely. The devcontainer
CLI handles user, env, CWD for us.

The flow would become:
```
pidc up:
  1. Read configs
  2. Resolve extension/skill mounts
  3. Merge → write temp devcontainer.json
  4. devcontainer up --workspace-folder <project> --config <temp>
  5. Save: temp config path (that's all we need in state)
  6. devcontainer exec --config <temp> --workspace-folder <project> holdpty launch --bg --name pi -- pi

pidc attach:
  7. devcontainer exec --config <temp> --workspace-folder <project> holdpty attach pi

pidc down:
  8. devcontainer down --config <temp> --workspace-folder <project>  (or docker-based if not available)
  9. Cleanup temp dir
```

### What this eliminates

- **exec.ts**: No more JSON output parsing, no docker exec helpers, no env injection
- **state.ts**: Shrinks to just "temp config path per workspace"
- **Deviations 1, 2, 4, 9**: Gone — devcontainer exec handles user, env, CWD
- **The CWD bug**: Gone — devcontainer runtime sets CWD from config

### What remains necessary

- `merge.ts` — Still need to merge configs additively
- `extensions.ts` — Still need to resolve bind mounts + patch settings on Windows
- `config.ts` — Still need multi-layer config
- `paths.ts` — Still need cross-platform path handling
- Deviation 5 (symlink fixup) — Still needed on Windows
- Deviation 10 (pi isolation) — Handled by the feature, not the CLI
- Deviation 11 (writable overlays) — Handled in merge, minimal code

## Constraints

- **Windows + Git Bash is the primary host** — cross-platform paths are unavoidable
- **Project's devcontainer.json must never be modified** — the temp config approach must stay
- **pi agent ecosystem** — holdpty for session management, `~/.pi` for config
- **`devcontainer exec --config <temp>`** — need to verify this actually works reliably

## Risks

- `devcontainer exec --config <path>` might not work as expected from a temp directory
- The devcontainer CLI might not support `devcontainer down` (it doesn't have one — we'd keep docker stop/rm)
- Migration: existing running containers would break (acceptable — just rebuild)

## Open Questions

1. Does `devcontainer exec --config <temp> --workspace-folder <project>` correctly resolve
   user, env, CWD? Has anyone verified this?
2. Can we use `devcontainer exec` for interactive sessions (holdpty attach needs a real TTY)?
3. What's the minimum viable state we need to persist between up/attach/down?
4. Should extensions.ts be a separate tool rather than built into the CLI?
5. How much of the config layer (3-way merge) is actually used? Could we simplify to just
   `~/.pi/devcontainers.json` + CLI flags?
