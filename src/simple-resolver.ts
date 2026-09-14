
import { join } from "node:path";

/**
 * Bun-only file resolver using Bun.file() API.
 * Not compatible with Node.js.
 *
 * @example
 * ```ts
 * const resolver = new SimpleFileResolver("/path/to/ldraw");
 * const content = await resolver.resolve("3626b.dat");
 * ```
 */
export class SimpleFileResolver {
  private paths: string[];
  private cache: Map<string, string> = new Map();

  private texturesPath;
  private texturesCache: Map<string, Uint8Array> = new Map();

  constructor(libraryRoot: string) {
    this.paths = [
      libraryRoot + '/parts',
      libraryRoot + '/p'
    ];
    this.texturesPath = libraryRoot + '/parts/textures'

    this.resolvePart = this.resolvePart.bind(this);
    this.resolveTexture = this.resolveTexture.bind(this);
  }

  async resolvePart(name: string): Promise<string | null> {
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }
    for (let i = 0; i < this.paths.length; i++) {
      const currentPath = join(this.paths[i]!, ...name.split(/\\|\//g)).replace(/\\/g, '/');
      const file = Bun.file(currentPath)
      if (await file.exists()) {
        const content = await Bun.file(currentPath).text();
        this.cache.set(name, content)
        return content
      }
    }
    return null
  }

  async resolveTexture(name: string): Promise<Uint8Array | null> {
    console.log('resolveTexture', name)
    if (this.texturesCache.has(name)) {
      return this.texturesCache.get(name)!;
    }

    const currentPath = join(this.texturesPath, name).replace(/\\/g, '/');
    const file = Bun.file(currentPath)
    if (await file.exists()) {
      const content = await Bun.file(currentPath).bytes();
      this.texturesCache.set(name, content)
      return content
    }
    return null
  }

  // listResolver(): [(name: string) => Promise<string | null>,  (name: string) => Promise<Uint8Array | null>] {
  //   return [
  //     this.resolvePart,
  //     this.resolveTexture
  //   ]
  // }
}