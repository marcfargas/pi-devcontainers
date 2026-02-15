# pi-devcontainers — Vision v2 (Post-Review)

## Decisions from Design Review

1. **Always `--config <merged-temp>`, never `--override-config`** — `--override-config` replaces top-level keys, doesn't merge. The CLI always generates a complete merged temp file.

2. **holdpty ships with the feature** — Installed in `install.sh` alongside pi. The "dumb feature" bends slightly for practical functionality.

3. **`uname -m` for architecture detection** — Not `dpkg --print-architecture`. Works on all Linux distros (Debian, Alpine, Fedora, etc.).

4. **Default base image**: `mcr.microsoft.com/devcontainers/universal:latest` — for projects without devcontainer.json. Configurable in `~/.pi/devcontainers.json`.

5. **Config precedence**: CLI flags > `~/.pi/devcontainers.json` > defaults. Never the project's devcontainer.json for pi-specific settings.

6. **npm pack with `--ignore-scripts`** — Prevents prepack scripts that assume Linux from failing on Windows host.

7. **Monorepo with npm workspaces** — CLI + feature in single repo. No Lerna/Nx needed.

8. **Tarball caching** — `~/.pi/devcontainers-cache/packed-extensions/` with package.json mtime-based invalidation.

## Status

### Phase 1: Core CLI + Feature ✅ Structure Complete
- [x] Monorepo setup (TypeScript, npm workspaces, vitest)
- [x] Dev Container Feature: install.sh (isolated node + pi + holdpty)
- [x] Feature: setup.sh (postCreate config + extension install)
- [x] CLI: config reading (`~/.pi/devcontainers.json`)
- [x] CLI: merge logic (additive-only, all postCreateCommand formats)
- [x] CLI: up command (full flow)
- [x] CLI: attach command (holdpty)
- [x] CLI: down command (container stop/remove)
- [x] CLI: status command
- [x] CLI: --env with and without values
- [x] Unit tests: 55 passing (paths, config, merge, extensions, fixtures)
- [x] Integration test structure (feature-install, setup-sh)
- [ ] Integration tests running (need Docker)
- [ ] End-to-end test with credential-broker project

### Phase 2: Extensions + Polish
- [x] npm pack flow (with --ignore-scripts)
- [x] Tarball caching with mtime invalidation
- [x] RO mount + writable volume overlay
- [ ] Test extension packing end-to-end
- [ ] Error handling polish
- [ ] Cross-platform path testing (macOS, Linux)

### Phase 3: pi-server mode
- [ ] pi-server integration
- [ ] Mode switching (holdpty ↔ pi-server)

### Phase 4: Publishing
- [ ] Publish feature to GHCR
- [ ] Publish CLI to npm
- [ ] GitHub Actions CI
- [ ] Documentation

## Open Items (from review)
- Container naming strategy for attach/down (using devcontainers CLI labels for now)
- VS Code integration guidance (users who want both CLI and VS Code)
- Container cleanup/GC for orphaned containers
- Secrets: using remoteEnv for now, --secrets-file for later
