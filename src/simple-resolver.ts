
import { join } from "node:path";

export class SimpleFileResolver {
  private cache: Map<string, string> = new Map();
  private paths: string[];
  constructor(libraryRoot: string) {
    this.paths = [
      libraryRoot + '/parts',
      libraryRoot + '/p'
    ];

    this.resolve = this.resolve.bind(this);
  }

  async resolve(name: string): Promise<string | null> {
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }
    for (let i = 0; i < this.paths.length; i++) {
      const currentPath = join(this.paths[i]!, ...name.split(/\\|\//g)).replace(/\\/g, '/');
      const file = Bun.file(currentPath)
      if (await file.exists()) {
        const content = await Bun.file(currentPath).text();
        this.cache.set(name, currentPath)
        return content
      }
    }
    return null
  }
}