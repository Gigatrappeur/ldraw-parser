// ============================================================
// LDraw Parser – Node.js-compatible filesystem resolver
// ============================================================
//
// Works in both Bun and Node.js (≥18).
// Falls back gracefully when `Bun.file` is unavailable.
// ============================================================

import { join, resolve } from "node:path";
import { readdir, readFile, access } from "node:fs/promises";

// ── Search paths ──────────────────────────────────────────────

const LDRAW_SEARCH_DIRS = [
  "",
  // "models",
  "parts",
  "parts/s",
  "p",
  "p/48",
  "p/8",
  // "unofficial/parts",
  // "unofficial/parts/s",
  // "unofficial/p",
  // "unofficial/p/48",
];

// ── File I/O abstraction ──────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path: string): Promise<string> {
  // Prefer Bun's fast reader when available
  if (typeof Bun !== "undefined") {
    return Bun.file(path).text();
  }
  return readFile(path, "utf-8");
}

// ── Case-insensitive directory index ─────────────────────────

const dirIndexCache = new Map<string, Map<string, string>>();

async function getDirIndex(dir: string): Promise<Map<string, string>> {
  const cached = dirIndexCache.get(dir);
  if (cached) return cached;
  const map = new Map<string, string>();
  try {
    const entries = await readdir(dir);
    for (const e of entries) map.set(e.toLowerCase(), e);
  } catch { /* dir doesn't exist */ }
  dirIndexCache.set(dir, map);
  return map;
}

async function resolveInDir(dir: string, name: string): Promise<string | null> {
  const normalised = name.replace(/\\/g, "/").toLowerCase();
  const segments   = normalised.split("/").filter(Boolean);
  let current = dir;
  for (const seg of segments) {
    const idx  = await getDirIndex(current);
    const real = idx.get(seg);
    if (!real) return null;
    current = join(current, real);
  }
  return (await fileExists(current)) ? current : null;
}

// ── Options ───────────────────────────────────────────────────

export interface NodeResolverOptions {
  libraryRoot?:  string;
  extraPaths?:   string[];
  cacheContent?: boolean;
  noCache?:      boolean;
}

function defaultLibraryRoot(): string {
  if (process.env["LDRAW_LIB"]) return process.env["LDRAW_LIB"];
  if (process.platform === "win32")  return "C:\\LDraw";
  if (process.platform === "darwin") return "/Library/ldraw";
  return "/usr/share/ldraw";
}

// ── Factory ───────────────────────────────────────────────────

/**
 * Create a cross-runtime file resolver (Bun + Node.js).
 *
 * Identical API to `createFilesystemResolver` in `fs-resolver.ts`
 * but does not use any Bun-only APIs.
 */
export function createNodeResolver(
  options: NodeResolverOptions = {},
): (name: string) => Promise<string | null> {
  const root        = resolve(options.libraryRoot ?? defaultLibraryRoot());
  const extraPaths  = (options.extraPaths ?? []).map((p) => resolve(p));
  const useCache    = options.cacheContent ?? true;
  const contentCache = new Map<string, string>();

  const searchDirs = [
    ...extraPaths,
    ...LDRAW_SEARCH_DIRS.map((sub) => sub ? join(root, sub) : root),
  ];

  return async (name: string): Promise<string | null> => {
    const key = name.replace(/\\/g, "/").toLowerCase();
    if (useCache && contentCache.has(key)) return contentCache.get(key)!;
    if (options.noCache) dirIndexCache.clear();

    for (const dir of searchDirs) {
      const fullPath = await resolveInDir(dir, name);
      if (fullPath) {
        const content = await readTextFile(fullPath);
        if (useCache) contentCache.set(key, content);
        return content;
      }
    }
    return null;
  };
}

/**
 * Load `LDConfig.ldr` — works in both Bun and Node.js.
 */
export async function loadLdConfigNode(libraryRoot?: string): Promise<string | null> {
  const root = resolve(libraryRoot ?? defaultLibraryRoot());
  const candidates = ["LDConfig.ldr", "ldconfig.ldr", "LDconfig.ldr"]
    .map((f) => join(root, f));

  for (const p of candidates) {
    if (await fileExists(p)) return readTextFile(p);
  }
  return null;
}

/**
 * Pre-warm directory index caches — works in both runtimes.
 */
export async function warmNodeResolverCache(libraryRoot?: string): Promise<void> {
  const root = resolve(libraryRoot ?? defaultLibraryRoot());
  await Promise.allSettled(
    LDRAW_SEARCH_DIRS.map((sub) => getDirIndex(sub ? join(root, sub) : root)),
  );
}
