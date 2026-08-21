# AGENTS.md

## Runtime
- **Bun** : `bun` (runtime + package manager)

## Commands
| Task | Command |
|------|---------|
| Run tests | `bun test` |
| Type check | `bun run tsc` |
| Build (bundle) | `bun run build` → `dist/index.js`, `dist/cli.js` |
| CLI example | `bun run src/cli.ts -f svg,glb --lib <ldraw-path> <file.ldr>` |

## Architecture
- **Public API** : `LDrawParser` class in `src/index.ts`
- **Core modules** :
  - `parser.ts` — line-by-line LDraw parser (types 0–5)
  - `resolver.ts` — sub-file resolution + geometry flattening
  - `fs-resolver.ts` — Bun filesystem resolver with cache (case-insensitive)
  - `node-resolver.ts` — Node.js alternative resolver
  - `colors.ts` — colour table (200+ official LDraw codes)
  - `postprocess.ts` — unit conversion, merge, stats, LOD
  - `svg.ts` — isometric SVG thumbnail generation
  - `glb.ts` — glTF 2.0 binary export (no deps)
  - `obj.ts` — Wavefront OBJ export
  - `serialise.ts` — LDraw file serialization
  - `steps.ts` — STEP assembly step generation
  - `utils.ts` — 4x4 matrix, Vec3/Vec2, AABB helpers
  - `normals.ts` — smooth mesh normal computation
  - `weld.ts` — vertex welding utilities
  - `errors.ts` — custom error classes (`LDrawError`, `LDrawParseError`, etc.)

## Key Patterns
- Imports use **no extension** (e.g., `./types` not `./types.ts`) — works with `moduleResolution: "bundler"` in tsconfig
- No runtime dependencies — zero `node_modules` required at runtime
- `FlatGeometry` output: meshes + edges + colorTable (filtered) + AABB
- Sub-file resolution is async (`resolveFile: (name: string) => Promise<string | null>`)
- LDraw units: 1 LDU = 0.4 mm; GLB defaults to meters

## Tests
- Location: `test/*.test.ts`
- Framework: `bun:test`
- Coverage: parser, colours, geometry, BFC, TEXMAP, MPD, SVG, GLB, serialisation
- Run single test: `bun test test/parser.test.ts`

## Build Quirks
- `bun run build` uses `bun build` with splitting + minification
- Output goes to `dist/` (excluded from git via `.gitignore`)
- CLI is bundled as `dist/cli.js` with shebang
