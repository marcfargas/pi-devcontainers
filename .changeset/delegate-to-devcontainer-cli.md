---
"@marcfargas/pi-devcontainers": patch
---

Delegate container runtime to `devcontainer exec` instead of direct `docker exec`. Containers are now resolved by label (`--id-label`) for reliable attach and exec, independent of ephemeral config files.

Mount `~/.pi` into all common user homes (`/root`, `/home/vscode`, `/home/node`) so pi data is accessible regardless of the project's `remoteUser` setting.

Fix Windows argument quoting for `devcontainer exec` — compound shell commands (`bash -c "..."`) with spaces, `&&`, and variable expansion now work correctly on cmd.exe.

Prefer locally installed `devcontainer` CLI over `npx @devcontainers/cli` fallback.

Switch JSONC parsing from regex to `jsonc-parser` library.
