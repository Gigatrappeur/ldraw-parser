// ============================================================
// LDraw Parser – Filesystem resolver for Bun backends
// ============================================================
//
// Handles the official LDraw library search-path order:
//   models/  → parts/  → p/  → p/48/  → p/8/
//   + unofficial variants
//   + case-insensitive fallback (important on Linux)
// ============================================================

import { join, resolve } from "node:path";
import { readdir } from "node:fs/promises";

// ── Search-path spec ──────────────────────────────────────────

/**
 * Standard sub-directories searched in order when resolving a
 * type-1 file reference.  Mirrors the LDraw spec §1.
 */
const LDRAW_SEARCH_DIRS = [
  "",           // bare root (for absolute / already-rooted paths)
  // "models",
  "parts",
  "parts/s",    // sub-parts
  "p",
  "p/48",
  "p/8",
  // "unofficial/parts",
  // "unofficial/parts/s",
  // "unofficial/p",
  // "unofficial/p/48",
];

// ── Case-insensitive dir index ────────────────────────────────

/**
 * On case-sensitive filesystems (Linux) a file reference like
 * `stud.dat` can live on disk as `Stud.dat`.  We build a
 * lower-case → real-name map per directory on first access.
 */
const dirIndexCache = new Map<string, Map<string, string>>();

async function getDirIndex(dir: string): Promise<Map<string, string>> {
  const cached = dirIndexCache.get(dir);
  if (cached) return cached;

  const map = new Map<string, string>();
  try {
    const entries = await readdir(dir);
    for (const e of entries) map.set(e.toLowerCase(), e);
  } catch {
    // directory doesn't exist – empty map is fine
  }
  dirIndexCache.set(dir, map);
  return map;
}

// ── Main resolver factory ─────────────────────────────────────

export interface LDrawLibraryOptions {
  /**
   * Root of the LDraw library installation.
   * Defaults to the LDRAW_LIB environment variable, then
   * common install paths for each OS.
   */
  libraryRoot?: string;

  /**
   * Extra directories to search before the standard ones.
   * Useful for project-local unofficial parts.
   */
  extraPaths?: string[];

  /**
   * Cache resolved file contents in memory (default: true).
   * Significantly speeds up repeated parsing of the same model.
   */
  cacheContent?: boolean;

  /**
   * If true, invalidate the directory index caches on every call.
   * Useful during development when the library folder may change.
   * Default: false.
   */
  noCache?: boolean;
}

function defaultLibraryRoot(): string {
  if (process.env["LDRAW_LIB"]) return process.env["LDRAW_LIB"];
  // Common install locations
  if (process.platform === "win32")  return "C:\\LDraw";
  if (process.platform === "darwin") return "/Library/ldraw";
  return "/usr/share/ldraw";
}

// ── Batch pre-warming ─────────────────────────────────────────

/**
 * Warm the directory index caches for all standard LDraw search
 * directories.  Call once at startup to eliminate first-request
 * latency spikes.
 */
export async function warmResolverCache(
  libraryRoot?: string,
): Promise<void> {
  const root = resolve(libraryRoot ?? defaultLibraryRoot());
  await Promise.allSettled(
    LDRAW_SEARCH_DIRS.map((sub) =>
      getDirIndex(sub ? join(root, sub) : root),
    ),
  );
}
