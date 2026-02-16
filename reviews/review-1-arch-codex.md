## Summary Verdict
The simplification direction is **sound** and should be pursued, but the current proposal is incomplete in two critical areas: (a) proving `devcontainer exec --config` behavior across your real target matrix (Windows + Git Bash + TTY + `postCreateCommand`), and (b) defining a robust config-path lifecycle so attach/down don’t depend on fragile temp dirs. Right now, most complexity is self-inflicted by falling back to raw `docker exec`; removing that path is the right move.

## Strengths
- Clear diagnosis of the root problem: the complexity explosion is centered in `packages/cli/src/exec.ts` + `state.ts` + manual lifecycle handling.
- Good architectural instinct: keep only the merge concern (`packages/cli/src/merge.ts`) and delegate runtime behavior to devcontainer CLI.
- Additive merge approach is sensible and low-risk for project compatibility.
- You already isolated most moving parts into separate files, so deletion/refactor is feasible without a rewrite.

## Critical Issues

1. **Core assumption is unproven (`devcontainer exec --config`)**
   - **What’s wrong:** The proposal hinges on this, but there’s no hard validation matrix yet.
   - **Why it matters:** If this fails on Windows Git Bash or interactive attach, you’re back to dual execution paths (complexity returns).
   - **Do instead:** Add a short acceptance suite before refactor:
     - `remoteUser` respected
     - `remoteEnv` visible
     - CWD correct with/without `postCreateCommand`
     - interactive TTY works for `holdpty attach`
     - works with config outside workspace

2. **Temp config lifecycle is underspecified**
   - **What’s wrong:** If attach/down require `--config <temp>`, OS temp cleanup or reboot can strand running containers.
   - **Why it matters:** Reliability regression vs current containerId-based fallback.
   - **Do instead:** Use deterministic persisted generated config path (e.g. `~/.pi/devcontainers/<workspace-hash>/devcontainer.json`), not random `/tmp/pidc-*`.

3. **Deviation inventory is partially stale and masking true complexity**
   - **What’s wrong:** `DEVIATIONS.md` #11 says named volumes; code in `packages/cli/src/merge.ts` uses bind overlays. Also config supports `extensions: pack|registry|skip`, but `packages/cli/src/extensions.ts` only does source mounting logic.
   - **Why it matters:** You can’t simplify what you haven’t accurately modeled.
   - **Do instead:** First align docs to code, then cut dead modes/options before migration.

4. **Extension handling is over-coupled to host layout**
   - **What’s wrong:** Monorepo root mounting (`extensions.ts`) and Windows path patching are doing too much for MVP.
   - **Why it matters:** This is a second complexity hotspot after exec/state.
   - **Do instead:** For MVP, default to mounting only `~/.pi` + optional explicit extra mounts. Make external extension mounting opt-in, not default.

## Suggestions

### (1) Is `devcontainer exec --config` simplification sound? Risks?
**Yes, sound.** Biggest risks:
- CLI behavior differences by version/platform
- interactive TTY quirks
- config path persistence
- relative-path semantics when config is external

Mitigation: pin/test CLI version + deterministic generated config path + one fallback only (not full docker-exec subsystem).

---

### (2) Which deviations are necessary vs self-inflicted?
**Mostly self-inflicted by docker-exec path.**

- **Self-inflicted (remove):** 1, 2, 9  
- **Mostly self-inflicted / can shrink heavily:** 4  
- **Necessary by product constraint:** 3, 10  
- **Conditionally necessary (depends on extension strategy / Windows):** 5, 8, 11  
- **Optional optimization, not architectural need:** 7  
- **Self-inflicted by “mount source dirs” strategy:** 6

---

### (3) Minimum viable CLI (what can be deleted entirely)?
MVP should be:
1. Generate merged config
2. `devcontainer up --config ...`
3. `devcontainer exec --config ...` for launch/attach
4. `docker stop/rm` by devcontainer label for down (until/unless down exists)

**Delete entirely (or defer):**
- `packages/cli/src/commands/status.ts`
- most of `packages/cli/src/state.ts` (or all, if config path deterministic + label lookup)
- docker exec helpers and JSON parsing fallback logic in `packages/cli/src/exec.ts`
- `extensions` mode complexity (`pack|registry`) not actually implemented

---

### (4) Simpler alternatives you may be missing
- **Generated sidecar config in stable location** (best practical simplification).
- **Write generated config inside workspace `.pi/`** (not touching project devcontainer.json; better relative-path behavior).
- **Ephemeral-only mode as default (`run`)**: remove persistent lifecycle concerns for most users.
- **Opt-in host extension mounting**: keep default behavior simple and predictable.

## Questions for the Author
1. Do you actually need persistent sessions (`up` then later `attach`), or would `run` cover most usage?
2. What percentage of users rely on extensions/skills outside `~/.pi`? (This determines whether `extensions.ts` complexity is worth it.)
3. Which exact `@devcontainers/cli` versions must be supported?
4. Is writing generated config under workspace `.pi/` acceptable, since it does not modify `.devcontainer/devcontainer.json`?
5. Is partial write access to `~/.pi` a hard security requirement, or just preference? (Impacts whether deviation #11 is worth keeping.)