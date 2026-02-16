/**
 * Resolve pi extensions and skills for container use.
 *
 * Reads pi's settings.json (user + project) to find configured extensions
 * and skills. Generates:
 * 1. Bind mounts for each path (RO, at the POSIX equivalent of the host path)
 * 2. A patched settings.json with paths converted to container POSIX paths
 *
 * No npm pack — just mount the source directories directly.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { dockerMountPath } from "./paths.js";

export interface PiSettingsMount {
  /** Host path (as-is from settings.json, resolved) */
  hostPath: string;
  /** Container path (POSIX conversion of host path) */
  containerPath: string;
}

export interface PiSettingsResolution {
  /** Bind mounts needed for extensions + skills */
  mounts: PiSettingsMount[];
  /** Path to patched settings.json (temp file) — null if no patching needed */
  patchedSettingsPath: string | null;
}

/**
 * Convert a host path (possibly Windows) to the container POSIX path.
 *
 * C:/dev/foo → /c/dev/foo
 * C:\dev\foo → /c/dev/foo
 * /home/user/foo → /home/user/foo (unchanged)
 */
function toContainerPath(hostPath: string): string {
  // First normalize to get a clean absolute path
  let p = hostPath.replace(/\\/g, "/");

  // Convert Windows drive letter: C:/... → /c/...
  const driveMatch = p.match(/^([a-zA-Z]):\/(.*)/);
  if (driveMatch) {
    p = `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  }

  return p;
}

/**
 * Read and parse settings.json, returning the raw object.
 */
function readSettings(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Walk up from a directory to find the monorepo root.
 *
 * A monorepo root is a directory with a package.json containing a "workspaces" field.
 * Returns the monorepo root path, or the original path if not inside a monorepo.
 * This ensures node_modules resolution works for hoisted dependencies.
 */
function findMonorepoRoot(dir: string): string {
  let current = resolve(dir);
  const root = resolve(sep); // filesystem root

  while (current !== root) {
    const parent = resolve(current, "..");
    if (parent === current) break; // reached filesystem root

    const pkgPath = join(parent, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) {
          return parent;
        }
      } catch {
        // ignore parse errors
      }
    }
    current = parent;
  }

  return dir; // not in a monorepo
}

/**
 * Collect unique paths from extensions + skills in settings.json.
 * Returns the paths that need mounting and a patched settings object.
 */
export function resolveSettingsForContainer(
  workspaceFolder?: string
): PiSettingsResolution {
  const userSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
  const settings = readSettings(userSettingsPath);

  const extensions: string[] = (settings?.extensions as string[]) ?? [];
  const skills: string[] = (settings?.skills as string[]) ?? [];
  const packages: string[] = (settings?.packages as string[]) ?? [];

  // Also check project-level settings
  let projectExtensions: string[] = [];
  let projectSkills: string[] = [];
  if (workspaceFolder) {
    const projectSettings = readSettings(
      join(workspaceFolder, ".pi", "settings.json")
    );
    if (projectSettings) {
      projectExtensions = (projectSettings.extensions as string[]) ?? [];
      projectSkills = (projectSettings.skills as string[]) ?? [];
    }
  }

  if (!settings && projectExtensions.length === 0 && projectSkills.length === 0) {
    return { mounts: [], patchedSettingsPath: null };
  }

  // Merge all paths (dedupe by resolved path).
  // Skip paths under ~/.pi/ — they're already accessible via the RO bind mount.
  const piDir = resolve(join(homedir(), ".pi"));
  const allPaths = new Map<string, PiSettingsMount>();
  const addPath = (p: string) => {
    const resolved = resolve(p);
    if (!existsSync(resolved)) return;
    if (allPaths.has(resolved)) return;
    if (resolved.startsWith(piDir + sep) || resolved.startsWith(piDir + "/")) return;
    allPaths.set(resolved, {
      hostPath: resolved,
      containerPath: toContainerPath(resolved),
    });
  };

  // Extensions: resolve to monorepo root so hoisted node_modules are accessible
  for (const p of [...extensions, ...projectExtensions]) {
    const resolved = resolve(p);
    if (existsSync(resolved)) {
      addPath(findMonorepoRoot(resolved));
    }
  }
  // Skills: mount as-is (no node_modules deps)
  for (const p of [...skills, ...projectSkills]) addPath(p);
  // Packages: mount as-is
  for (const p of packages) addPath(p);

  if (allPaths.size === 0) {
    return { mounts: [], patchedSettingsPath: null };
  }

  // Only patch settings.json on Windows (paths need conversion).
  // On Linux/macOS, host paths are already valid POSIX — use the original
  // settings.json as-is (preserves live reload on config changes).
  const needsPatching = process.platform === "win32";

  let patchedPath: string | null = null;
  if (needsPatching) {
    const patched = { ...(settings ?? {}) };

    if (extensions.length > 0) {
      // Keep original extension paths in settings (pi needs the package dir,
      // not the monorepo root) — just convert to container POSIX paths
      patched.extensions = extensions
        .filter((p) => {
          const resolved = resolve(p);
          return !(resolved.startsWith(piDir + sep) || resolved.startsWith(piDir + "/"));
        })
        .map((p) => toContainerPath(resolve(p)));
    }

    if (skills.length > 0) {
      // Filter out paths under ~/.pi (already in the RO bind mount)
      // and convert the rest to container POSIX paths
      patched.skills = skills
        .filter((p) => {
          const resolved = resolve(p);
          return !(resolved.startsWith(piDir + sep) || resolved.startsWith(piDir + "/"));
        })
        .map((p) => {
          const resolved = resolve(p);
          return allPaths.get(resolved)?.containerPath ?? toContainerPath(p);
        });
    }

    if (packages.length > 0) {
      patched.packages = packages
        .filter((p) => {
          const resolved = resolve(p);
          return !(resolved.startsWith(piDir + sep) || resolved.startsWith(piDir + "/"));
        })
        .map((p) => toContainerPath(resolve(p)));
    }

    // Windows shell won't exist in Linux container
    if (patched.shellPath) {
      patched.shellPath = "/bin/bash";
    }

    const tempDir = join(tmpdir(), `pi-settings-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    patchedPath = join(tempDir, "settings.json");
    writeFileSync(patchedPath, JSON.stringify(patched, null, 2));
  }

  return {
    mounts: [...allPaths.values()],
    patchedSettingsPath: patchedPath,
  };
}
