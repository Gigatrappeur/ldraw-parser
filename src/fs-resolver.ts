// ============================================================
// LDraw Parser – Filesystem resolver for Bun backends
// ============================================================
//
// Handles the official LDraw library search-path order:
//   models/  → parts/  → p/  → p/48/  → p/8/
//   + unofficial variants
//   + case-insensitive fallback (important on Linux)
// ============================================================

import { join, dirname, resolve } from "node:path";
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

/**
 * Resolve `name` inside `dir`, case-insensitively.
 * Returns the full path if found, null otherwise.
 */
async function resolveInDir(dir: string, name: string): Promise<string | null> {
  const normalised = name.replace(/\\/g, "/").toLowerCase();

  // If the name itself contains sub-directory components (e.g. "s/stud4.dat")
  // we need to handle each segment.
  const segments = normalised.split("/");

  let current = dir;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const idx = await getDirIndex(current);
    const real = idx.get(seg);
    if (!real) return null;
    current = join(current, real);
  }

  // Verify it's actually a file (not a directory)
  const f = Bun.file(current);
  return (await f.exists()) ? current : null;
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

/**
 * Build a `resolveFile` callback suitable for `LDrawParserOptions`.
 *
 * @example
 * ```ts
 * const resolver = createFilesystemResolver({ libraryRoot: "/usr/share/ldraw" });
 * const parser = new LDrawParser({ resolveFile: resolver });
 * ```
 */
export function createFilesystemResolver(
  options: LDrawLibraryOptions = {},
): (name: string) => Promise<string | null> {
  const root        = resolve(options.libraryRoot ?? defaultLibraryRoot());
  const extraPaths  = (options.extraPaths ?? []).map((p) => resolve(p));
  const useCache    = options.cacheContent ?? true;
  const contentCache = new Map<string, string>();

  // Build the ordered list of directories to search
  const searchDirs = [
    ...extraPaths,
    ...LDRAW_SEARCH_DIRS.map((sub) => sub ? join(root, sub) : root),
  ];

  return async (name: string): Promise<string | null> => {
    const cacheKey = name.replace(/\\/g, "/").toLowerCase();

    if (useCache && contentCache.has(cacheKey)) {
      return contentCache.get(cacheKey)!;
    }

    if (options.noCache) dirIndexCache.clear();

    for (const dir of searchDirs) {
      const fullPath = await resolveInDir(dir, name);
      if (fullPath) {
        const content = await Bun.file(fullPath).text();
        if (useCache) contentCache.set(cacheKey, content);
        return content;
      }
    }

    return null;
  };
}

// ── LDConfig.ldr loader ───────────────────────────────────────

/**
 * Load LDConfig.ldr from the library root and return its content,
 * or null if not found.
 */
export async function loadLdConfig(
  libraryRoot?: string,
): Promise<string | null> {
  const root = resolve(libraryRoot ?? defaultLibraryRoot());
  const candidates = [
    join(root, "LDConfig.ldr"),
    join(root, "ldconfig.ldr"),
    join(root, "LDconfig.ldr"),
  ];
  for (const p of candidates) {
    const f = Bun.file(p);
    if (await f.exists()) return f.text();
  }
  return null;
}

// ── Directory resolver (for MPD projects) ───────────────────

/**
 * Create a resolver that first looks in a specific project directory
 * (for MPD files that reference local parts) before falling back to
 * the LDraw library.
 *
 * @param projectDir  Directory containing the MPD/LDR file
 * @param libOptions  LDraw library options
 */
export function createProjectResolver(
  projectDir: string,
  libOptions: LDrawLibraryOptions = {},
): (name: string) => Promise<string | null> {
  const libResolver = createFilesystemResolver(libOptions);
  const projectAbs  = resolve(projectDir);

  return async (name: string): Promise<string | null> => {
    // 1. Look in the project directory first (relative references)
    const local = await resolveInDir(projectAbs, name);
    if (local) return Bun.file(local).text();

    // 2. Fall back to the library
    return libResolver(name);
  };
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
