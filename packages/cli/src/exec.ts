/**
 * Shell execution helpers for devcontainers CLI and Docker.
 *
 * Uses devcontainer CLI for `up` (image build + feature install),
 * but Docker directly for exec/stop/rm (no config file needed).
 */

import { execSync, spawn } from "node:child_process";
import { normalizePath } from "./paths.js";

// ─── devcontainer CLI ───────────────────────────────────────────────

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
  /** Show full devcontainer build output (--verbose flag) */
  verbose?: boolean;
}

/**
 * Run `devcontainer up` with the given config.
 * Returns the container ID.
 *
 * Build logs are captured and only shown on error.
 * A progress indicator shows the last meaningful line.
 */
export function devcontainerUp(opts: DevcontainerUpOptions): DevcontainerUpResult {
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

  // Verbose mode: inherit stderr directly (all build logs visible)
  if (opts.verbose) {
    let result: string;
    try {
      result = execSync(`npx ${args.join(" ")}`, {
        encoding: "utf-8",
        timeout: 600000,
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string };
      result = execErr.stdout ?? "";
      if (!result) {
        throw new Error(
          `devcontainer up failed: ${execErr.stderr?.substring(0, 500) ?? "unknown error"}`
        );
      }
    }
    return parseDevcontainerUpResult(result);
  }

  // Quiet mode: capture everything, only show stderr on error
  let result: string;
  let stderrOutput = "";
  try {
    result = execSync(`npx ${args.join(" ")}`, {
      encoding: "utf-8",
      timeout: 600000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    stderrOutput = execErr.stderr ?? "";
    result = execErr.stdout ?? "";
    if (!result) {
      const lastLines = stderrOutput.split("\n").filter(Boolean).slice(-20).join("\n");
      throw new Error(`devcontainer up failed:\n${lastLines}`);
    }
  }

  return parseDevcontainerUpResult(result);
}


export interface DevcontainerUpResult {
  containerId: string;
  remoteWorkspaceFolder?: string;
}

/**
 * Extract the JSON object from devcontainer CLI output.
 *
 * The CLI always writes a single JSON object to stdout, but when lifecycle
 * hooks (postCreateCommand, etc.) run, their log output may be interleaved
 * on previous lines.  We find the last line that looks like a JSON object
 * and parse that — falling back to the full string for clean output.
 */
export function extractJson(raw: string): unknown | null {
  // Fast path: entire output is valid JSON (no lifecycle hook output)
  try {
    return JSON.parse(raw);
  } catch {
    // Fall through to line-by-line extraction
  }

  // Find the last line that starts with '{' — the CLI JSON is always last
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function parseDevcontainerUpResult(result: string): DevcontainerUpResult {
  const output = extractJson(result) as Record<string, unknown> | null;

  if (output && output.containerId) {
    if (output.outcome !== "success") {
      console.warn(
        `  ⚠ Container started but postCreateCommand failed (non-fatal)`
      );
    }
    return {
      containerId: output.containerId as string,
      remoteWorkspaceFolder: output.remoteWorkspaceFolder as string | undefined,
    };
  }

  // Last resort: regex extraction when JSON parsing failed entirely
  const idMatch = result.match(/"containerId":\s*"([^"]+)"/);
  if (idMatch) {
    const wsMatch = result.match(/"remoteWorkspaceFolder":\s*"([^"]+)"/);
    return {
      containerId: idMatch[1],
      remoteWorkspaceFolder: wsMatch?.[1],
    };
  }

  const message = (output as Record<string, unknown>)?.message ?? "no container ID in output";
  throw new Error(
    `devcontainer up failed: ${message}`
  );
}

// ─── Docker direct (for exec/stop/rm) ───────────────────────────────

/** Base env vars to inject into every docker exec for proper TUI rendering. */
const BASE_EXEC_ENV: Record<string, string> = {
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  LANG: "C.UTF-8",
};

/**
 * Build docker exec -e flags from env records.
 * Base TUI env is always included. Additional env vars are merged on top.
 */
function buildExecEnvFlags(extraEnv?: Record<string, string>): string[] {
  const merged = { ...BASE_EXEC_ENV, ...(extraEnv ?? {}) };
  const flags: string[] = [];
  for (const [k, v] of Object.entries(merged)) {
    flags.push("-e", `${k}=${v}`);
  }
  return flags;
}

/**
 * Check if a container is running.
 */
export function isContainerRunning(containerId: string): boolean {
  try {
    const result = execSync(
      `docker inspect --format "{{.State.Running}}" "${containerId}"`,
      { encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    ).trim();
    return result === "true";
  } catch {
    return false;
  }
}

export interface DockerExecOptions {
  user?: string;
  workdir?: string;
  /** Extra env vars to inject via docker exec -e flags */
  env?: Record<string, string>;
}

/**
 * Execute a command inside a running container (non-interactive, captured output).
 * If user is specified, runs as that user; otherwise uses the container's default.
 */
export function dockerExec(
  containerId: string,
  command: string[],
  opts?: DockerExecOptions,
): string {
  const envFlags = buildExecEnvFlags(opts?.env);
  const args = ["exec", ...envFlags];
  if (opts?.user) args.push("-u", opts.user);
  if (opts?.workdir) args.push("-w", opts.workdir);
  args.push(containerId, ...command);
  return execSync(
    `docker ${args.map(a => `"${a}"`).join(" ")}`,
    {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "inherit"],
    }
  );
}

/**
 * Execute a command inside a running container (interactive, inherits stdio).
 * Returns a promise that resolves with the exit code.
 */
export function dockerExecInteractive(
  containerId: string,
  command: string[],
  opts?: DockerExecOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const envFlags = buildExecEnvFlags(opts?.env);
    const args = ["exec", "-it", ...envFlags];
    if (opts?.user) args.push("-u", opts.user);
    if (opts?.workdir) args.push("-w", opts.workdir);
    args.push(containerId, ...command);

    const child = spawn("docker", args, { stdio: "inherit" });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

/**
 * Stop and remove a container.
 */
export function dockerStopAndRemove(containerId: string): void {
  try {
    execSync(`docker stop "${containerId}"`, {
      timeout: 30000,
      stdio: "pipe",
    });
  } catch {
    // Container might already be stopped
  }
  try {
    execSync(`docker rm "${containerId}"`, {
      timeout: 15000,
      stdio: "pipe",
    });
  } catch {
    // Container might already be removed
  }
}

/**
 * Find containers by devcontainer label (fallback for state file).
 */
export function findContainersByLabel(workspaceFolder: string): string[] {
  try {
    const labelValue = normalizePath(workspaceFolder);
    const result = execSync(
      `docker ps -aq --filter "label=devcontainer.local_folder=${labelValue}"`,
      { encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    ).trim();
    return result ? result.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}
