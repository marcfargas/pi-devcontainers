/**
 * Detect pi extensions and pack them as tarballs for container use.
 *
 * Reads pi's settings.json (user-level and project-level) to find
 * configured extensions. Extensions are local paths that won't resolve
 * inside a container, so we npm-pack them into tarballs.
 */

import { execSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

export interface PackedExtension {
  name: string;
  sourcePath: string;
  tarballPath: string;
  cached: boolean;
}

/**
 * Read pi's configured extensions from settings.json (user + project).
 *
 * Pi stores extensions as paths in:
 * - User: ~/.pi/agent/settings.json → "extensions"
 * - Project: <workspace>/.pi/settings.json → "extensions"
 *
 * Project extensions are merged with (and override) user extensions.
 */
export function readPiExtensions(
  workspaceFolder?: string
): Array<{ name: string; sourcePath: string }> {
  const extPaths = new Map<string, string>(); // resolved path → deduped

  // 1. User-level settings
  const userSettings = join(homedir(), ".pi", "agent", "settings.json");
  collectExtensionsFromSettings(userSettings, extPaths);

  // 2. Project-level settings (if workspace provided)
  if (workspaceFolder) {
    const projectSettings = join(workspaceFolder, ".pi", "settings.json");
    collectExtensionsFromSettings(projectSettings, extPaths);
  }

  // Resolve to { name, sourcePath }
  const results: Array<{ name: string; sourcePath: string }> = [];
  for (const sourcePath of extPaths.values()) {
    const pkgJsonPath = join(sourcePath, "package.json");
    if (!existsSync(pkgJsonPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      results.push({ name: pkg.name || basename(sourcePath), sourcePath });
    } catch {
      results.push({ name: basename(sourcePath), sourcePath });
    }
  }

  return results;
}

function collectExtensionsFromSettings(
  settingsPath: string,
  into: Map<string, string>
): void {
  if (!existsSync(settingsPath)) return;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const extensions: string[] = settings.extensions ?? [];

    for (const extPath of extensions) {
      const resolved = resolve(extPath);
      if (existsSync(resolved)) {
        into.set(resolved, resolved);
      }
    }
  } catch {
    // Malformed settings — skip silently
  }
}

/**
 * Get the cache directory for packed extension tarballs.
 */
function cacheDir(): string {
  const dir = join(homedir(), ".pi", "devcontainers-cache", "packed-extensions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get a hash key for cache invalidation based on package.json mtime.
 */
function getCacheKey(sourcePath: string): string {
  try {
    const pkgJsonPath = join(sourcePath, "package.json");
    const stat = statSync(pkgJsonPath);
    return `${stat.mtimeMs}`;
  } catch {
    return Date.now().toString();
  }
}

/**
 * Pack a single extension. Returns the tarball path.
 * Uses cache if package.json hasn't changed.
 */
function packExtension(
  name: string,
  sourcePath: string,
  stagingDir: string
): PackedExtension {
  const cache = cacheDir();
  const safeName = name.replace(/\//g, "-").replace(/^@/, "");
  const cacheKey = getCacheKey(sourcePath);
  const cacheMetaPath = join(cache, `${safeName}.meta.json`);
  const cacheTarballPattern = join(cache, `${safeName}-*.tgz`);

  // Check cache
  if (existsSync(cacheMetaPath)) {
    try {
      const meta = JSON.parse(readFileSync(cacheMetaPath, "utf-8"));
      if (meta.cacheKey === cacheKey && existsSync(meta.tarballPath)) {
        // Cache hit — copy to staging
        const destPath = join(stagingDir, basename(meta.tarballPath));
        execSync(
          `cp "${meta.tarballPath}" "${destPath}"`,
          { timeout: 5000 }
        );
        return {
          name,
          sourcePath,
          tarballPath: destPath,
          cached: true,
        };
      }
    } catch {
      // Cache corrupted, repack
    }
  }

  // Pack the extension
  const result = execSync(
    `npm pack --ignore-scripts --pack-destination "${stagingDir}" 2>/dev/null`,
    {
      cwd: sourcePath,
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    }
  ).trim();

  // npm pack outputs the tarball filename
  const tarballName = result.split("\n").pop()!.trim();
  const tarballPath = join(stagingDir, tarballName);

  // Save to cache
  const cachedTarball = join(cache, tarballName);
  try {
    copyFileSync(tarballPath, cachedTarball);
    writeFileSync(
      cacheMetaPath,
      JSON.stringify({ cacheKey, tarballPath: cachedTarball })
    );
  } catch {
    // Cache write failure is non-fatal
  }

  return {
    name,
    sourcePath,
    tarballPath,
    cached: false,
  };
}

/**
 * Find and pack all pi extensions (from user + project settings).
 * Returns the staging directory path and list of packed extensions.
 */
export function packLinkedExtensions(
  workspaceFolder?: string,
  stagingDir?: string
): {
  stagingDir: string;
  extensions: PackedExtension[];
} {
  const staging =
    stagingDir ?? join(tmpdir(), `pi-ext-staging-${Date.now()}`);
  mkdirSync(staging, { recursive: true });

  const piExtensions = readPiExtensions(workspaceFolder);
  if (piExtensions.length === 0) {
    return { stagingDir: staging, extensions: [] };
  }

  const extensions: PackedExtension[] = [];

  for (const ext of piExtensions) {
    try {
      const packed = packExtension(ext.name, ext.sourcePath, staging);
      extensions.push(packed);
    } catch (err) {
      console.error(
        `Warning: Failed to pack extension ${ext.name}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  return { stagingDir: staging, extensions };
}
