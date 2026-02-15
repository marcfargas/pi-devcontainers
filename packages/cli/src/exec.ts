/**
 * Shell execution helpers for devcontainers CLI.
 */

import { execSync, spawn, type SpawnOptions } from "node:child_process";
import { normalizePath } from "./paths.js";

/**
 * Check that devcontainers CLI is available.
 */
export function ensureDevcontainersCli(): void {
  try {
    execSync("npx @devcontainers/cli --version", {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
    });
  } catch {
    throw new Error(
      "devcontainers CLI not found. Install it with: npm install -g @devcontainers/cli"
    );
  }
}

export interface DevcontainerUpOptions {
  workspaceFolder: string;
  configPath: string;
  rebuild?: boolean;
}

/**
 * Run `devcontainer up` with the given config.
 * Returns the container ID.
 */
export function devcontainerUp(opts: DevcontainerUpOptions): string {
  const args = [
    "@devcontainers/cli",
    "up",
    "--workspace-folder",
    opts.workspaceFolder,
    "--config",
    opts.configPath,
  ];

  if (opts.rebuild) {
    args.push("--remove-existing-container");
    args.push("--build-no-cache");
  }

  const result = execSync(`npx ${args.join(" ")}`, {
    encoding: "utf-8",
    timeout: 600000, // 10 min for image build
    stdio: ["pipe", "pipe", "inherit"],
  });

  // Parse the JSON output to get container ID
  try {
    const output = JSON.parse(result);
    if (output.outcome === "success") {
      return output.containerId;
    }
    throw new Error(
      `devcontainer up failed: ${output.message || "unknown error"}`
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      // Not JSON — might still have succeeded, try to extract ID
      const match = result.match(/"containerId":\s*"([^"]+)"/);
      if (match) return match[1];
      throw new Error(`devcontainer up returned unexpected output: ${result.substring(0, 200)}`);
    }
    throw err;
  }
}

export interface DevcontainerExecOptions {
  workspaceFolder: string;
  command: string[];
  /** If true, inherit stdio for interactive use */
  interactive?: boolean;
}

/**
 * Run `devcontainer exec` inside the container.
 */
export function devcontainerExec(opts: DevcontainerExecOptions): string {
  const args = [
    "@devcontainers/cli",
    "exec",
    "--workspace-folder",
    opts.workspaceFolder,
  ];

  if (opts.interactive) {
    const child = spawn("npx", [...args, ...opts.command], {
      stdio: "inherit",
      shell: true,
    });

    // For interactive, we just wait for exit
    // This is synchronous-ish via spawnSync, but we need to return
    return "";
  }

  return execSync(
    `npx ${args.join(" ")} ${opts.command.join(" ")}`,
    {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "inherit"],
    }
  );
}

/**
 * Run `devcontainer exec` with an interactive spawn (for attach).
 * Returns a promise that resolves when the process exits.
 */
export function devcontainerExecInteractive(
  workspaceFolder: string,
  command: string[]
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      "@devcontainers/cli",
      "exec",
      "--workspace-folder",
      workspaceFolder,
      ...command,
    ];

    const child = spawn("npx", args, {
      stdio: "inherit",
      shell: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

/**
 * Stop a devcontainer.
 */
export function devcontainerDown(workspaceFolder: string): void {
  // devcontainers CLI doesn't have a 'down' command.
  // We need to find the container and stop it via Docker.
  try {
    const result = execSync(
      `npx @devcontainers/cli up --workspace-folder "${workspaceFolder}" --expect-existing-container`,
      {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const output = JSON.parse(result);
    if (output.containerId) {
      execSync(`docker stop "${output.containerId}"`, {
        timeout: 30000,
        stdio: "pipe",
      });
      execSync(`docker rm "${output.containerId}"`, {
        timeout: 15000,
        stdio: "pipe",
      });
    }
  } catch {
    // Try to find by label
    const labelValue = normalizePath(workspaceFolder);
    try {
      const containers = execSync(
        `docker ps -aq --filter "label=devcontainer.local_folder=${labelValue}"`,
        { encoding: "utf-8", timeout: 10000 }
      ).trim();
      if (containers) {
        for (const id of containers.split("\n").filter(Boolean)) {
          execSync(`docker stop "${id}" && docker rm "${id}"`, {
            timeout: 30000,
            stdio: "pipe",
          });
        }
      }
    } catch {
      throw new Error(
        `Could not find or stop devcontainer for ${workspaceFolder}`
      );
    }
  }
}
