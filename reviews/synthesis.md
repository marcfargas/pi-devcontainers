# Synthesis — pi-devcontainers Design Review

3 reviews recovered: 1 architecture (Gemini Pro), 2 implementation (Gemini Pro + Flash).
2 reviews lost to rate limits (parallel Gemini calls on same API key).

## Unanimous Verdicts

All 3 reviewers agree on:

1. **Architecture is sound.** The dumb-feature + smart-host-CLI split is the right design. The additive-only merge strategy is critical and well-conceived.
2. **Use `--config <merged-temp>`, NOT `--override-config`.** The arch reviewer explicitly states `--override-config` replaces top-level keys, not merges. Hard rule: always generate a complete merged temp file and use `--config`.
3. **Cross-platform path handling is the #1 risk.** Windows (Git Bash vs PowerShell vs CMD), drive letters, separators — this will break first and hardest. Need a dedicated path normalization utility tested across all shells.
4. **`postCreateCommand` chaining is the #2 risk.** String/array/object formats, shell escaping, `&&` chaining — high surface area for bugs. Needs dedicated unit tests for every combination.
5. **holdpty must ship with the feature.** Don't leave as an open question. Install it in `install.sh` alongside pi. The "dumb feature" ideal must bend slightly for practical functionality.
6. **Monorepo is appropriate, not overkill.** CLI and feature are tightly coupled. Single repo with npm workspaces is the right call.
7. **Test holdpty + devcontainer exec early.** TTY forwarding through the chain (host → exec → holdpty → pi) is a critical risk. If it doesn't work, the entire attach flow needs rethinking.

## Key Divergences

1. **MVP scope for postCreateCommand**: Gemini Flash impl suggests handling only string/array formats for MVP, deferring object merge. Gemini Pro impl suggests handling all three from the start with thorough unit tests. **Recommendation: handle all three — the object format is common in real devcontainer.json files.**

2. **Projects without devcontainer.json**: Gemini Flash suggests requiring one for MVP. Gemini Pro and arch suggest defaulting to `mcr.microsoft.com/devcontainers/universal:latest`. **Recommendation: generate a minimal one with universal image as default, configurable in `~/.pi/devcontainers.json`.**

3. **Secrets handling depth**: The arch reviewer goes deep on secret security (docker inspect visibility, vault integration). The impl reviewers treat it as a lower priority. **Recommendation: for MVP, use `--remote-env` and `--secrets-file`. True vault integration is Phase 4+. Our threat model is local dev, not production.**

## Critical Issues (Must Address)

### 1. `--config` not `--override-config` (Architecture)
The merged temp file approach is correct but the vision doc still mentions `--override-config` as a possibility. Strike it. Always `--config <temp-merged.json>`.

### 2. holdpty installation strategy (Architecture + Both Impl)
Must be decided before coding starts. **Decision: install holdpty in the feature's `install.sh`.** It's a single binary download, same as node. This keeps the CLI simple (just `devcontainer exec holdpty ...`).

### 3. Architecture detection in install.sh (Impl Pro)
`dpkg --print-architecture` is Debian-specific. Use `uname -m` instead and map:
- `x86_64` → `x64`
- `aarch64` → `arm64`
This works on all Linux distros.

### 4. `npm pack` on host uses host's npm (Impl Flash)
The `npm pack` command runs on the host, using whatever Node.js is available. This is fine — the tarball format is platform-independent. But edge case: if an extension has `prepack` scripts that assume Linux, they'll fail on Windows. **Mitigation: document this, add `--ignore-scripts` to npm pack.**

## Suggestions (Should Address)

| Priority | Suggestion | Source |
|----------|-----------|--------|
| High | Dedicated path normalization utility, tested on Windows/macOS/Linux | All 3 |
| High | npm pack tarball caching by content hash, stored in `~/.pi/devcontainers-cache/` | Both impl |
| Medium | Config precedence: CLI flags > `~/.pi/devcontainers.json` > project defaults | Arch |
| Medium | Default base image configurable in `~/.pi/devcontainers.json` | Arch + Impl Pro |
| Medium | Error handling: capture `devcontainer up` failures, show meaningful messages | Both impl |
| Low | Container naming/labeling strategy for attach/down | Impl Flash |
| Low | Guidance for VS Code Dev Containers users (attach VS Code to same container) | Arch |

## Open Questions Raised by Reviewers

1. **pi-server lifecycle**: How will it manage auth, port forwarding, client connections? (Defer — Phase 3)
2. **Version skew host pi vs container pi**: Should we warn if they differ? (Low priority for MVP)
3. **Container cleanup/GC**: Strategy for orphaned containers beyond `down`? (Nice to have)
4. **GHCR setup for feature publishing**: Auth, naming, CI/CD pipeline? (Phase 4)

## Concrete Next Actions

1. **Resolve open decisions** (this session):
   - holdpty: ship with feature ✓
   - `--config` not `--override-config` ✓
   - `uname -m` not `dpkg` ✓
   - Default base image: `mcr.microsoft.com/devcontainers/universal:latest`

2. **Update vision.md** with decisions, then start building Phase 1:
   - Monorepo setup (TypeScript, npm workspaces)
   - Feature `install.sh` (isolated node + pi + holdpty)
   - CLI `up` command (config read, merge, devcontainer up)
   - CLI `attach` command (holdpty via devcontainer exec)
   - Test: holdpty TTY forwarding ASAP (risk #1 for attach flow)

3. **Test with credential-broker project** as the first real-world case.
