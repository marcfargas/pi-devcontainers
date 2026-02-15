## Summary Verdict
This design is largely sound and well-thought-out, addressing a clear and pressing problem for Windows ARM users and reproducible environments. The separation of concerns between the host CLI and the "dumb" container feature is excellent. The proposed merge strategy and `~/.pi` handling are robust. It avoids direct Docker interaction, leveraging the `devcontainers` CLI effectively. However, there are areas for simplification and a few critical omissions.

## Strengths
*   **Clear Problem Statement & Solution:** The document clearly articulates the problem (Windows ARM, environment inconsistencies) and proposes a direct, established solution (Dev Containers).
*   **Leveraging `devcontainers` CLI:** Delegating container lifecycle management to `@devcontainers/cli` is a wise choice, reducing complexity and avoiding direct Docker interaction. This adheres to the "don't reinvent the wheel" principle.
*   **Dumb Feature, Smart CLI:** The separation of the `pi` feature (build-time install of Node.js and `pi`) from the `pi-devcontainers` CLI (orchestration, configuration, extension handling) is a strong architectural decision. It keeps the container image lean and reusable.
*   **Additive-Only Merge Strategy:** The `devcontainer.json` merge strategy being additive-only is crucial. It ensures the host CLI can inject `pi` without destructively altering a project's existing devcontainer configuration, promoting non-invasiveness.
*   **Robust `~/.pi` Handling:** The approach of a Read-Only bind mount for `~/.pi/` (for static config like agents, skills) combined with Docker volumes for writable directories (`todos`, `memoria`) is excellent. This provides persistence for critical data while ensuring the base configuration is consistent and cannot be accidentally modified within the container.
*   **npm-pack for Extensions:** Using `npm pack` for npm-linked extensions is a practical solution to get local development extensions into the container.
*   **Explicit Constraints & Risks:** The document clearly lists constraints and risks, showing a good understanding of potential pitfalls. The mitigation strategies for risks are also noted.
*   **TypeScript Monorepo:** Using TypeScript for the CLI and a monorepo structure is good for maintainability and code quality.

## Critical Issues
1.  **`holdpty` Installation Strategy:** The vision states "holdpty needs to be available inside the container. Ship it with the feature? Or as a separate feature?". This is a critical dependency for the `attach` command and the `holdpty` mode.
    *   **What's wrong:** Leaving this as an open question for an MVP feature means the core functionality of running and attaching to `pi` in the container is uncertain. If `holdpty` is a separate feature, it introduces an additional dependency for users, making the `pi` devcontainer setup less seamless. If it's included in the `pi` feature, the `pi` feature is no longer "dumb".
    *   **Why it matters:** Without a clear `holdpty` installation strategy, the MVP `attach` command might not work reliably, impacting the primary user experience.
    *   **What to do instead:**
        *   **Option A (Preferred for MVP):** Include `holdpty` installation directly within the `pi` Dev Container Feature's `install.sh`. This keeps the `pi-devcontainers` CLI self-contained and simplifies the user's setup. The `pi` feature *must* include all components needed for `pi` to run in `holdpty` mode. The "dumb feature" ideal might need to be slightly relaxed for practical functionality.
        *   **Option B:** Explicitly state that `holdpty` is a *prerequisite* feature that the user's `devcontainer.json` must provide, and the `pi-devcontainers` CLI will *add* it if not present, similar to how it adds the `pi` feature. This pushes responsibility to the CLI to ensure `holdpty` is present.

2.  **`--override-config` vs. `--config` Gotcha:** The document states "Need to verify if it merges or replaces. If it replaces, we must use `--config` with our merged file. (Mitigated: we generate a merged temp file regardless)". While generating a merged temp file is a good mitigation, the underlying assumption about `--override-config` is problematic.
    *   **What's wrong:** `--override-config` **replaces**, it does not merge. This is a common misconception. The `devcontainers` CLI documentation explicitly states that `--override-config` "merges/overrides the devcontainer.json that is found for a workspace." but in practice, it often leads to unexpected behavior by overwriting top-level keys if the structure isn't precisely additive. Relying on it for complex merges is risky.
    *   **Why it matters:** If `--override-config` is used with a file that doesn't fully represent the project's original `devcontainer.json` plus the `pi` additions, it can silently drop existing configurations (e.g., `image`, `build`, other `features` if not carefully re-specified).
    *   **What to do instead:** The current mitigation of generating a merged temp file is the *correct* approach. The CLI should *always* generate a complete, merged `devcontainer.json` into a temporary file and pass that file to the `devcontainer up --config <temp>` flag. **Do not use `--override-config` at all for this merging strategy.** This needs to be a hard rule in the architecture.

3.  **Secrets Handling (Visibility):** The risk section mentions "Env vars with broker credentials are visible in `docker inspect`" and suggests "use `--secrets-file` for sensitive vars".
    *   **What's wrong:** While `--secrets-file` is better than `--remote-env` for truly sensitive data, it doesn't entirely mitigate the risk. `--secrets-file` typically mounts secrets into the container filesystem, which is readable by any process inside the container. If the secrets are directly injected as environment variables from that file, they are still visible via `ps -ef` or `docker inspect` for the running process.
    *   **Why it matters:** True secrets should not be visible in `docker inspect` or `ps -ef` within the container. This is a common security vulnerability.
    *   **What to do instead:**
        *   For truly sensitive, runtime-only secrets (e.g., API keys that `pi` uses directly), consider using Docker's built-in [secret management](https://docs.docker.com/engine/swarm/secrets/) (though this might be overkill if `devcontainers` CLI doesn't natively support it without Swarm mode).
        *   Alternatively, for non-Swarm Docker, the most secure approach for secrets is often to load them *on demand* from a secure vault service (e.g., Azure Key Vault, GCP Secret Manager, HashiCorp Vault) *within the container's runtime*. The `devcontainers` CLI can pass minimal credentials or an identity (like a Managed Identity token) to enable this, rather than the secrets themselves.
        *   If direct injection is unavoidable, emphasize using `--secrets-file` and ensure secrets are only exposed to the `pi` process and not generally available (e.g., by ensuring `setup.sh` only processes them for `pi`'s environment). The current plan to simply copy `env` variables (even if from `--secrets-file`) via `remoteEnv` is a risk. `remoteEnv` *also* makes them visible via `docker inspect`. The most secure option for *any* secret is to **not** use `remoteEnv` or directly inject them as process environment variables.

## Suggestions
1.  **Feature Distribution (`pi` feature on GHCR):**
    *   **Recommendation:** Prioritize distributing the `pi` feature via GHCR (e.g., `ghcr.io/our-org/pi:1`). This is the standard and most maintainable approach for Dev Container Features. Bundling it within the npm package and copying to a temp dir is a hack that adds unnecessary complexity and deviates from the Dev Container specification's intent. The registry is designed for this.
    *   **Reasoning:** GHCR provides versioning, caching, and a standard discovery mechanism for features.

2.  **Base Image for Projects Without `devcontainer.json`:**
    *   **Recommendation:** For projects without an existing `devcontainer.json`, default to the `devcontainers/universal:latest` image. This image is robust, well-maintained, and covers a wide range of common development tools.
    *   **Reasoning:** Provides a good "batteries included" default without `pi-devcontainers` needing to guess dependencies or manage multiple base images. Make it configurable in `~/.pi/devcontainers.json`.

3.  **Extension Packing Latency Mitigation (Caching):**
    *   **Suggestion:** Implement a caching mechanism for `npm pack` tarballs by using checksums or modification times (mtimes) of the linked extension directories. Only repack if the source has changed.
    *   **Reasoning:** Addresses the stated risk of slow `npm pack` operations on every `up` command.

4.  **Error Handling and User Feedback:**
    *   **Suggestion:** Place a strong emphasis on user-friendly error messages throughout the CLI. For example, if `holdpty` fails, provide clear instructions or troubleshooting tips.
    *   **Reasoning:** Crucial for a smooth user experience, especially given the complexity of container environments.

5.  **CLI Flag Prioritization:**
    *   **Suggestion:** Explicitly define the precedence for configuration: CLI flags should override `~/.pi/devcontainers.json` which should override project's `devcontainer.json`.
    *   **Reasoning:** This ensures predictability and allows users to fine-tune behavior without modifying files.

## Questions for the Author
1.  **`pi-server` Integration Details (Phase 3):** When `pi-server` becomes available, how will `pi-devcontainers` manage its lifecycle, authentication, and client connections? Will it still use `holdpty` as a fallback, or will `pi-server` be the sole mode?
2.  **Version Skew between Host `pi` and Container `pi`:** Will there be any issues or warnings if the user's host `pi` version differs significantly from the `piVersion` specified for the container? How will `pi-devcontainers` guide the user on managing these versions?
3.  **Workspace Folder Resolution:** How will `--workspace-folder` be resolved across different host OSes (Windows paths in Git Bash vs. PowerShell, WSL, macOS, Linux)? Will it normalize paths to a consistent format for the `devcontainers` CLI?
4.  **`postCreateCommand` Chaining and Exit Codes:** When chaining `postCreateCommand` with `&&`, what is the strategy if the project's original command fails? Will it prevent `/opt/pi/setup.sh` from running? How will `pi-devcontainers` report such failures to the user?
5.  **Integration with VS Code Dev Containers:** While the goal is to *not* modify `devcontainer.json`, will `pi-devcontainers` provide any integration or guidance for users who *do* want to use the standard VS Code Dev Containers UI alongside the `pi-devcontainers` CLI? For instance, to attach VS Code to the same running container?
6.  **Container Cleanup/Garbage Collection:** Beyond `npx pi-devcontainers down`, is there a strategy for cleaning up old, stopped, or orphaned `pi` dev containers? This is a common pain point with long-lived dev containers.
