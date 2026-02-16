## Summary Verdict
Yes — the simplification is buildable and should materially improve reliability. The current architecture in `packages/cli/src/exec.ts` + command files is over-owning runtime concerns (`cwd`, `env`, `user`, lifecycle lookup) that `devcontainer exec` already provides. Moving to `devcontainer exec --config <temp> --workspace-folder <project>` should eliminate the current CWD bug class and cut substantial code, with the main implementation risk shifting to cross-platform mount/path logic (`packages/cli/src/extensions.ts`, `packages/cli/src/merge.ts`).

## Hard Problems

### 1) Dead weight currently duplicating devcontainer runtime behavior
The biggest removable surface is code that exists only because commands run via `docker exec`:

- **`packages/cli/src/exec.ts`**
  - `dockerExec`, `dockerExecInteractive`, `buildExecEnvFlags`, `BASE_EXEC_ENV`, `isContainerRunning`, `findContainersByLabel` usage pattern for attach/run.
  - `extractJson` + `parseDevcontainerUpResult` exists only to recover `remoteWorkspaceFolder` for manual `-w`.
- **`packages/cli/src/commands/up.ts`**
  - `execEnv` construction (`TERM`, `COLORTERM`, `LANG`) and manual holdpty launch via Docker.
  - Persists `remoteWorkspaceFolder`/`remoteUser` purely for later Docker exec.
- **`packages/cli/src/commands/attach.ts` + `run.ts`**
  - Manual user/workdir handling on each attach.
- **`packages/cli/src/state.ts`**
  - Fields for Docker exec context become mostly unnecessary (`remoteWorkspaceFolder`, `remoteUser`, likely `containerId` for attach path).

What should remain custom:
- merge temp config (`packages/cli/src/merge.ts`)
- extension/skill mount resolution (`packages/cli/src/extensions.ts`)
- config layering (`packages/cli/src/config.ts`)
- down/status lifecycle glue (since devcontainer CLI still lacks full `down/status` parity).

---

### 2) CWD bug: exact failure path + whether simplification fixes it
**Current failure path (exact):**
1. `commandUp()` (`packages/cli/src/commands/up.ts`) calls `devcontainerUp()` (`packages/cli/src/exec.ts`).
2. With project `postCreateCommand`, `devcontainer up` output is noisy/interleaved.
3. `parseDevcontainerUpResult()` falls back from JSON parse; it may recover `containerId` but return `remoteWorkspaceFolder: undefined`.
4. `commandUp()` stores that in state and launches holdpty via:
   - `dockerExec(..., { workdir: remoteWorkspaceFolder })`
   - `workdir` undefined ⇒ no `-w` passed ⇒ process starts in container default dir (observed `/`).
5. `commandAttach()` / `commandRun()` repeat this from state via `dockerExecInteractive(..., { workdir: state?.remoteWorkspaceFolder })`, so attached session also lands in `/`.

**Does proposed simplification fix it?**  
**Yes, for this bug class.** If launch/attach use:
- `devcontainer exec --config <temp> --workspace-folder <project> ...`
then CWD comes from devcontainer runtime/workspace config, not parsed stdout fields. Even if `up` output parsing fails completely, attach CWD is no longer dependent on `remoteWorkspaceFolder` extraction.

---

### 3) Hidden complexity that remains after simplification
The next hard area is **path/mount correctness across Windows + Git Bash + Linux container**:

- `packages/cli/src/extensions.ts`: monorepo root widening, path conversion, `~/.pi` path-skips, patched settings behavior on Windows.
- `packages/cli/src/merge.ts`: forced `workspaceFolder` heuristic (`/workspaces/<basename>`) can conflict with nonstandard workspace mounts.
- `packages/cli/src/config.ts` and `commands/up.ts`: regex JSONC stripping can corrupt legitimate strings (e.g., URLs/comments-like content) — brittle parser approach.

Approach: keep simplification narrow first, then add a small matrix of integration tests for Windows path cases and workspace mount variants.

## What Will Break First
1. **Today (current code):** `packages/cli/src/exec.ts` output parsing (`extractJson`/regex fallback). It already caused the CWD production issue and is coupled to CLI output format noise.
2. **After simplification:** `packages/cli/src/extensions.ts` mount/path rewriting on Windows (drive-letter/path normalization, monorepo root detection, patched settings assumptions).
3. **Secondary risk:** state drift around temp config lifetime (`state` points to temp dir deleted externally; attach/down behavior becomes confusing unless explicitly handled).

## Scope Reality Check
This is realistic as a focused refactor (not a rewrite). Estimated **source LOC reduction** (based on current LOC in `vision.md` + reviewed code):

| File | Current | Estimated after simplification | Reduction |
|---|---:|---:|---:|
| `packages/cli/src/exec.ts` | 299 | 90–120 | **179–209** |
| `packages/cli/src/commands/up.ts` | 195 | 120–140 | **55–75** |
| `packages/cli/src/commands/attach.ts` | 66 | 25–35 | **31–41** |
| `packages/cli/src/commands/run.ts` | 50 | 20–30 | **20–30** |
| `packages/cli/src/state.ts` | 72 | 25–35 | **37–47** |
| `packages/cli/src/commands/down.ts` | 69 | 45–55 | **14–24** |
| `packages/cli/src/commands/status.ts` | 43 | 20–30 | **13–23** |

**Total estimated reduction: ~349 to ~449 LOC** in CLI source (roughly **21%–27%** of current ~1650 LOC).

Nice-to-have (not MVP): reduce/remove parser-focused tests in `test/unit/exec.test.ts` once parsing logic is deleted, replace with behavior tests around exec path.

## Implementation Sequence
1. **Add `devcontainerExec` wrappers** in `packages/cli/src/exec.ts` (interactive + non-interactive) using `--config` + `--workspace-folder`.
2. **Refactor `commandUp`** (`packages/cli/src/commands/up.ts`) to:
   - keep merge/temp config/up flow
   - launch holdpty via `devcontainer exec` (not Docker)
   - stop persisting `remoteWorkspaceFolder`/`remoteUser`.
3. **Refactor `commandAttach` + `commandRun`** to use `devcontainer exec` against saved temp config path.
4. **Shrink `state.ts` schema** to minimal workspace → temp config metadata (plus timestamp).
5. **Keep `down` Docker-based** (label lookup + cleanup) unless a reliable devcontainer down path is confirmed.
6. **Delete dead helpers and parser code** in `exec.ts`; remove now-unused state fields/usages.
7. **Add/adjust tests**:
   - unit: new exec wrapper argument construction + state schema
   - integration: one explicit regression for postCreate + correct CWD.

## Missing from the Design
Before implementation starts, specify these precisely:

1. **State contract**: exact fields persisted after simplification (at minimum temp config path + workspace key; define stale-entry behavior).
2. **Attach behavior when temp config is missing**: auto-rebuild vs hard error.
3. **Down strategy**: Docker label-only vs hybrid; what happens if multiple containers share workspace label.
4. **TTY guarantee for `devcontainer exec`** with `holdpty attach` (must be explicitly validated in integration).
5. **`workspaceFolder` policy in merge**: keep heuristic or trust runtime inference; this affects future CWD correctness beyond current bug.