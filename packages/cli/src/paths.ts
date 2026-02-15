/**
 * Cross-platform path normalization.
 *
 * Handles Windows (Git Bash, PowerShell, CMD), macOS, and Linux paths.
 * Converts to the format expected by the devcontainers CLI and Docker.
 */

import { resolve, sep } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

/**
 * Normalize a path to an absolute POSIX-style path.
 * Handles:
 * - Git Bash paths: /c/dev/project → C:\dev\project (resolved) → C:/dev/project
 * - Windows paths: C:\dev\project → C:/dev/project
 * - Relative paths: ./project → <cwd>/project → normalized
 * - ~ paths: ~/foo → <homedir>/foo
 */
export function normalizePath(inputPath: string): string {
  let p = inputPath;

  // Expand ~
  if (p.startsWith("~/") || p === "~") {
    p = p.replace(/^~/, homedir());
  }

  // Git Bash /c/... style → C:/...
  const gitBashMatch = p.match(/^\/([a-zA-Z])\/(.*)/);
  if (gitBashMatch) {
    p = `${gitBashMatch[1].toUpperCase()}:/${gitBashMatch[2]}`;
  }

  // Resolve to absolute
  p = resolve(p);

  // Normalize separators to forward slash (for Docker/Linux compat)
  return p.split(sep).join("/");
}

/**
 * Get the path to ~/.pi directory.
 */
export function piConfigDir(): string {
  return normalizePath(`${homedir()}/.pi`);
}

/**
 * Get a path suitable for Docker bind mount source on the current OS.
 * On Windows, Docker Desktop needs Windows-style paths (C:/dev/...).
 * The normalizePath output already handles this.
 */
export function dockerMountPath(inputPath: string): string {
  return normalizePath(inputPath);
}

/**
 * Check if a path looks like it exists and is accessible.
 */
export function pathExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
