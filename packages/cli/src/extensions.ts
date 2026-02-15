/**
 * Detect npm-linked pi extensions and pack them as tarballs.
 *
 * On the host, pi's global node_modules may contain symlinked extensions
 * (from `npm link`). These won't resolve inside a container.
 * This module:
 * 1. Finds linked extensions in pi's node_modules
 * 2. Runs `npm pack --ignore-scripts` for each
 * 3. Outputs tarballs to a staging directory
 */

import { execSync } from "node:child_process";
import {
  readdirSync,
  lstatSync,
  readlinkSync,
  mkdirSync,
  existsSync,
  realpathSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";

export interface PackedExtension {
  name: string;
  sourcePath: string;
  tarballPath: string;
  cached: boolean;
}

/**
 * Find the directory where pi is globally installed.
 * Returns the node_modules directory containing pi's dependencies.
 */
function findPiGlobalDir(): string | null {
  try {
    // `npm root -g` gives us the global node_modules
    const globalRoot = execSync("npm root -g", {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();

    // Check if pi is installed there
    const piDir = join(globalRoot, "@mariozechner", "pi-coding-agent");
    if (existsSync(piDir)) {
      return globalRoot;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect npm-linked packages in a node_modules directory.
 * A linked package is one whose entry in node_modules is a symlink/junction.
 */
export function findLinkedExtensions(
  nodeModulesDir: string
): Array<{ name: string; linkTarget: string }> {
  const linked: Array<{ name: string; linkTarget: string }> = [];

  if (!existsSync(nodeModulesDir)) return linked;

  const entries = readdirSync(nodeModulesDir);

  for (const entry of entries) {
    const entryPath = join(nodeModulesDir, entry);

    if (entry.startsWith("@")) {
      // Scoped package — look inside
      if (!existsSync(entryPath)) continue;
      const scopedEntries = readdirSync(entryPath);
      for (const scopedEntry of scopedEntries) {
        const scopedPath = join(entryPath, scopedEntry);
        if (isLinkedPackage(scopedPath)) {
          const realPath = realpathSync(scopedPath);
          linked.push({
            name: `${entry}/${scopedEntry}`,
            linkTarget: realPath,
          });
        }
      }
    } else {
      if (isLinkedPackage(entryPath)) {
        const realPath = realpathSync(entryPath);
        linked.push({ name: entry, linkTarget: realPath });
      }
    }
  }

  return linked;
}

/**
 * Check if a path is a symlink or junction (Windows).
 */
function isLinkedPackage(p: string): boolean {
  try {
    const stat = lstatSync(p);
    return stat.isSymbolicLink();
  } catch {
    return false;
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
    execSync(`cp "${tarballPath}" "${cachedTarball}"`, { timeout: 5000 });
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
 * Find and pack all linked pi extensions.
 * Returns the staging directory path and list of packed extensions.
 */
export function packLinkedExtensions(stagingDir?: string): {
  stagingDir: string;
  extensions: PackedExtension[];
} {
  const staging =
    stagingDir ?? join(tmpdir(), `pi-ext-staging-${Date.now()}`);
  mkdirSync(staging, { recursive: true });

  const globalDir = findPiGlobalDir();
  if (!globalDir) {
    return { stagingDir: staging, extensions: [] };
  }

  const linked = findLinkedExtensions(globalDir);
  const extensions: PackedExtension[] = [];

  for (const ext of linked) {
    try {
      const packed = packExtension(ext.name, ext.linkTarget, staging);
      extensions.push(packed);
    } catch (err) {
      console.error(
        `Warning: Failed to pack extension ${ext.name}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  return { stagingDir: staging, extensions };
}
