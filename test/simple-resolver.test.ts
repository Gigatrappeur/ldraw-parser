// ============================================================
// LDraw Parser – SimpleFileResolver tests
// ============================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SimpleFileResolver } from "../src/simple-resolver";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

// ── Helpers ───────────────────────────────────────────────────

let tmpDir: string;

async function createTmpDir(): Promise<string> {
  const base = await mkdir(join(os.tmpdir(), `ldraw-resolver-test-${Date.now()}`), { recursive: true });
  if (!base) {
	throw 'Erreur create tmp dir'
  }
  return base;
}

async function writePart(dir: string, name: string, content: string): Promise<void> {
  const subDir = join(dir, "parts");
  await mkdir(subDir, { recursive: true });
  const filePath = join(subDir, name);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content);
}

async function writeTexture(dir: string, name: string, bytes: Uint8Array): Promise<void> {
  const texDir = join(dir, "parts", "textures");
  await mkdir(texDir, { recursive: true });
  const filePath = join(texDir, name);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, bytes);
}

// ── Tests ─────────────────────────────────────────────────────

describe("SimpleFileResolver", () => {
  let resolver: SimpleFileResolver;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    resolver = new SimpleFileResolver(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("resolvePart returns content for existing part", async () => {
    await writePart(tmpDir, "test.dat", "0 Test\n3 4 0 0 0 10 0 0 0 10 0");
    const content = await resolver.resolvePart("test.dat");
    expect(content).toContain("0 Test");
    expect(content).toContain("3 4");
  });

  test("resolvePart searches both parts/ and p/ directories", async () => {
    const pDir = join(tmpDir, "p");
    await mkdir(pDir, { recursive: true });
    await writeFile(join(pDir, "alt.dat"), "0 Alt Part");
    const content = await resolver.resolvePart("alt.dat");
    expect(content).toBe("0 Alt Part");
  });

  test("resolvePart throws when file not found", async () => {
    await expect(resolver.resolvePart("nonexistent.dat")).rejects.toThrow("not found");
  });

  test("resolvePart caches results", async () => {
    await writePart(tmpDir, "cached.dat", "0 Cached");
    const first = await resolver.resolvePart("cached.dat");
    const second = await resolver.resolvePart("cached.dat");
    expect(first).toBe(second);
  });

  test("resolvePart handles sub-directory paths", async () => {
    await writePart(tmpDir, "sub/deep.dat", "0 Deep Part");
    const content = await resolver.resolvePart("sub/deep.dat");
    expect(content).toBe("0 Deep Part");
  });

  test("resolvePart handles backslash separators", async () => {
    await writePart(tmpDir, "sub/deep.dat", "0 Backslash Part");
    const content = await resolver.resolvePart("sub\\deep.dat");
    expect(content).toBe("0 Backslash Part");
  });

  test("resolveTexture returns bytes for existing texture", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    await writeTexture(tmpDir, "test.png", png);
    const bytes = await resolver.resolveTexture("test.png");
    expect(bytes).toEqual(png);
  });

  test("resolveTexture throws when texture not found", async () => {
    await expect(resolver.resolveTexture("missing.png")).rejects.toThrow("not found");
  });

  test("resolveTexture caches results", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await writeTexture(tmpDir, "cached.png", png);
    const first = await resolver.resolveTexture("cached.png");
    const second = await resolver.resolveTexture("cached.png");
    expect(first).toBe(second);
  });

  test("resolvePart returns same content for case differences", async () => {
    await writePart(tmpDir, "MixedCase.dat", "0 Mixed");
    const content = await resolver.resolvePart("MixedCase.dat");
    expect(content).toBe("0 Mixed");
  });
});
