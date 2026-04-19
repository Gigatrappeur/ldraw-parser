# ldraw-parser

Parser TypeScript complet pour les fichiers LDraw (.ldr / .mpd / .dat), conçu pour les backends **Bun**.  
Aucune dépendance runtime. Génère directement des fichiers **GLB** (glTF 2.0) et des **thumbnails SVG**.

---

## Fonctionnalités

| Domaine | Détail |
|---|---|
| **Types 0–5** | Commentaires, sub-file refs, lignes, triangles, quads, optional lines |
| **Métadonnées** | `description`, `name`, `author`, `!LDRAW_ORG`, `!CATEGORY`, `!KEYWORDS`, `!LICENSE`, `!HISTORY`, `!HELP`, `!CMDLINE` |
| **Couleurs** | Table complète 200+ codes officiels, transparence (alpha < 255), finitions CHROME / METAL / PEARLESCENT / RUBBER / MATTE_METALLIC / MATERIAL (GLITTER/SPECKLE) |
| **BFC** | Certification CW/CCW, `INVERTNEXT`, `CLIP`/`NOCLIP`, propagation aux enfants, inversion sur réflexion matricielle |
| **TEXMAP** | Projections PLANAR / CYLINDRICAL / SPHERICAL, pile de TEXMAP imbriqués, calcul des UVs |
| **MPD** | Extraction et parsing des sous-fichiers `0 FILE`, résolution externe async |
| **Résolveur FS** | Résolution case-insensitive, ordre de recherche LDraw standard, cache mémoire |
| **Post-process** | Conversion d'unités (LDU→m/mm/cm/in/studs), merge de meshes, statistiques, palette de couleurs |
| **GLB** | glTF 2.0 binaire pur, matériaux PBR, normales flat, UVs, transparence BLEND/MASK |
| **SVG** | Projection isométrique paramétrable, Lambert shading, painter's algorithm, transparence |

---

## Installation

```bash
# Copier la librairie dans votre projet
cp -r ldraw-parser/ your-project/libs/

# Ou avec npm link / workspace
```

### Prérequis

- **Bun** ≥ 1.0 (pour le résolveur filesystem et les exemples)
- **TypeScript** ≥ 5.0 (pour la compilation)

---

## Démarrage rapide

```ts
import { LDrawParser, createFilesystemResolver, loadLdConfig } from "./ldraw-parser/src/index.js";

// 1. Créer le résolveur (pointe vers votre installation LDraw)
const resolver = createFilesystemResolver({ libraryRoot: "/usr/share/ldraw" });

// 2. Charger la table de couleurs officielle
const ldconfig = await loadLdConfig("/usr/share/ldraw");

// 3. Créer le parser
const parser = new LDrawParser({ resolveFile: resolver });
if (ldconfig) parser.loadColorTable(ldconfig);

// 4. Parser un modèle
const content = await Bun.file("mon-modele.ldr").text();
const { file, geometry } = await parser.parse(content, "mon-modele.ldr");

// 5. Lire les métadonnées
console.log(file.meta.description);   // "Voiture Rouge"
console.log(file.meta.keywords);      // ["vehicle", "car", "red"]
console.log(file.meta.category);      // "Vehicle"

// 6. Générer un thumbnail SVG
const svg = parser.toSvg(geometry!, { azimuth: 45, elevation: 30, width: 512 });
await Bun.write("thumbnail.svg", svg);

// 7. Générer un fichier GLB (unités en mètres, Y-up pour glTF)
const glb = parser.toGlb(geometry!, {}, "m");
await Bun.write("model.glb", glb);
```

---

## API

### `LDrawParser`

Classe principale, point d'entrée de haut niveau.

```ts
const parser = new LDrawParser(options?: LDrawParserOptions);
```

#### `LDrawParserOptions`

| Propriété | Type | Défaut | Description |
|---|---|---|---|
| `resolveFile` | `(name: string) => Promise<string \| null>` | `() => null` | Callback de résolution des sous-fichiers |
| `colorTable` | `Map<number, LDrawColor>` | table intégrée | Table de couleurs personnalisée |
| `processBFC` | `boolean` | `true` | Traiter les directives BFC |
| `flatten` | `boolean` | `true` | Aplatir la géométrie récursivement |
| `keepRawLines` | `boolean` | `false` | Conserver les lignes brutes dans `LDrawFile.rawLines` |
| `maxDepth` | `number` | `64` | Profondeur de récursion max pour les sous-fichiers |

#### Méthodes

```ts
// Parser + résoudre un modèle complet
parse(content: string, name?: string): Promise<{ file: LDrawFile; geometry?: FlatGeometry }>

// Parser uniquement (pas de résolution de sous-fichiers)
parseOnly(content: string, name?: string): LDrawFile

// Générer SVG
toSvg(geometry: FlatGeometry, options?: SvgCameraOptions): string

// Générer GLB (unit: "ldu"|"mm"|"cm"|"m"|"in"|"studs", défaut "m")
toGlb(geometry: FlatGeometry, options?: GlbOptions, unit?: LengthUnit, merge?: boolean): Uint8Array

// Statistiques géométriques
stats(geometry: FlatGeometry): GeometryStats

// Palette de couleurs utilisées
palette(geometry: FlatGeometry): ColorUsage[]

// Textures référencées via TEXMAP
textures(geometry: FlatGeometry): string[]

// Charger LDConfig.ldr
loadColorTable(ldconfigContent: string): void

// Vider le cache de résolution
clearCache(): void
```

---

### Résolveur filesystem

```ts
import { createFilesystemResolver, createProjectResolver, loadLdConfig, warmResolverCache } from "./ldraw-parser/src/index.js";

// Résolveur standard (cherche dans parts/, p/, p/48/, etc.)
const resolver = createFilesystemResolver({
  libraryRoot: "/usr/share/ldraw",    // ou variable LDRAW_LIB
  extraPaths:  ["./my-unofficial"],   // dossiers additionnels en tête de liste
  cacheContent: true,                 // cache mémoire du contenu (défaut: true)
});

// Résolveur projet (cherche d'abord dans le dossier du MPD)
const projectResolver = createProjectResolver(
  "./models/my-project/",             // dossier contenant le .mpd
  { libraryRoot: "/usr/share/ldraw" }
);

// Pré-chauffer les index de répertoires au démarrage
await warmResolverCache("/usr/share/ldraw");

// Charger LDConfig.ldr
const ldconfig = await loadLdConfig("/usr/share/ldraw");
```

L'ordre de recherche standard est :
1. Chemins `extraPaths` (dans l'ordre)
2. `<root>/` (racine)
3. `<root>/models/`
4. `<root>/parts/`
5. `<root>/parts/s/` (sub-parts)
6. `<root>/p/`
7. `<root>/p/48/`
8. `<root>/p/8/`
9. `<root>/unofficial/parts/`
10. `<root>/unofficial/p/`

La résolution est **case-insensitive** (important sous Linux où `stud.dat` et `Stud.dat` sont différents).

---

### Post-processing

```ts
import {
  transformGeometry,
  mergeGeometry,
  cullSmallTriangles,
  computeStats,
  extractColorPalette,
  collectTextures,
  lduToUnitScale,
} from "./ldraw-parser/src/index.js";

// Convertir en mètres + Y-up (pour glTF)
const geo = transformGeometry(geometry, lduToUnitScale("m"), true);

// Fusionner les meshes de même couleur (réduit les draw calls)
const merged = mergeGeometry(geometry);

// Supprimer les micro-triangles (LOD)
const lod = cullSmallTriangles(geometry, 0.1); // minArea en LDU²

// Statistiques
const stats = computeStats(geometry);
// { triangleCount, vertexCount, edgeCount, colorCount, estimatedBytes, aabb }

// Palette triée par usage
const palette = extractColorPalette(geometry);
// [{ color, triangleCount, isTransparent }, ...]

// Textures TEXMAP
const textures = collectTextures(geometry);
// ["texture.png", "gloss.png"]
```

---

### Types principaux

#### `LDrawFile`

```ts
interface LDrawFile {
  name:      string;
  meta:      LDrawFileMeta;       // description, keywords, BFC, etc.
  commands:  LDrawCommand[];      // type 0–5
  subFiles?: Map<string, LDrawFile>; // fichiers MPD embarqués
  rawLines?: string[];
}

interface LDrawFileMeta {
  description?: string;
  name?:        string;
  author?:      string;
  fileType?:    LDrawFileType;
  license?:     string;
  category?:    string;
  keywords?:    string[];
  help?:        string[];
  history?:     Array<{ date: string; author: string; description: string }>;
  colors?:      LDrawColor[];
  bfcCertified?: boolean;
  bfcWinding?:   "CW" | "CCW";
}
```

#### `LDrawColor`

```ts
interface LDrawColor {
  code:          number;
  name:          string;
  value:         number;         // 0xRRGGBB
  edge:          number;         // 0xRRGGBB
  alpha:         number;         // 0-255
  luminance:     number;         // 0-255
  finish:        LDrawColorFinish;
  isTransparent: boolean;
  rgba:          [number, number, number, number]; // 0-1
  edgeRgba:      [number, number, number, number]; // 0-1
  material?:     LDrawMaterial;  // GLITTER / SPECKLE
}
```

#### `FlatGeometry`

```ts
interface FlatGeometry {
  meshes: GeometryMesh[];   // triangles par couleur/texmap
  edges:  GeometryEdges[];  // segments de ligne par couleur
  aabb: {
    min: Vec3; max: Vec3;
    center: Vec3; size: Vec3;
    radius: number;
  };
}

interface GeometryMesh {
  colorCode: number;
  color:     LDrawColor;
  triangles: Array<{ a: GeometryVertex; b: GeometryVertex; c: GeometryVertex }>;
  texmap?:   TexmapDefinition;
}
```

---

### Serveur HTTP Bun (exemple)

```ts
import { LDrawParser, createFilesystemResolver } from "./ldraw-parser/src/index.js";

const parser = new LDrawParser({
  resolveFile: createFilesystemResolver({ libraryRoot: process.env.LDRAW_LIB }),
});

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // POST /parse  → JSON avec métadonnées + stats
    if (req.method === "POST" && url.pathname === "/parse") {
      const body = await req.text();
      const { file, geometry } = await parser.parse(body, url.searchParams.get("name") ?? "model.ldr");
      return Response.json({ meta: file.meta, stats: geometry ? parser.stats(geometry) : null });
    }

    // POST /thumbnail.svg  → image SVG
    if (req.method === "POST" && url.pathname === "/thumbnail.svg") {
      const { geometry } = await parser.parse(await req.text());
      const svg = parser.toSvg(geometry!, {
        azimuth:   parseFloat(url.searchParams.get("az")   ?? "45"),
        elevation: parseFloat(url.searchParams.get("el")   ?? "30"),
        width:     parseInt(  url.searchParams.get("size") ?? "512"),
        height:    parseInt(  url.searchParams.get("size") ?? "512"),
      });
      return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
    }

    // POST /model.glb  → binaire GLB
    if (req.method === "POST" && url.pathname === "/model.glb") {
      const { geometry } = await parser.parse(await req.text());
      const glb = parser.toGlb(geometry!, { normals: true }, "m");
      return new Response(glb, { headers: { "Content-Type": "model/gltf-binary" } });
    }

    return new Response("Not found", { status: 404 });
  },
});
```

---

## Structure des fichiers

```
src/
├── types.ts          Toutes les interfaces TypeScript
├── colors.ts         Table 200+ couleurs + parsing !COLOUR
├── utils.ts          Matrices 4×4, Vec3, AABB, projection TEXMAP UV
├── parser.ts         Parser ligne par ligne (types 0–5)
├── resolver.ts       Résolution récursive async + aplatissement géométrie
├── fs-resolver.ts    Résolveur filesystem Bun avec cache
├── postprocess.ts    Conversion unités, merge, stats, LOD
├── svg.ts            Thumbnail SVG (projection, shading, painter's algo)
├── glb.ts            GLB/glTF 2.0 binaire (sans dépendances)
└── index.ts          Exports publics + classe LDrawParser
```

---

## Unités LDraw

| Unité | Valeur | Usage |
|---|---|---|
| 1 LDU | 0.4 mm | Unité native LDraw |
| 1 stud | 20 LDU = 8 mm | Pas des tenons LEGO |
| 1 plaque | 8 LDU = 3.2 mm | Hauteur d'une plaque |
| 1 brique | 24 LDU = 9.6 mm | Hauteur d'une brique |

Le GLB est généré en **mètres** par défaut (`unit: "m"`) pour respecter la convention glTF 2.0.

---

## CLI

exemple phare rouge : 6513963
```bash
bun run src/cli -f svg,glb --el 150 --lib <path>\ldraw\ -v --no-smooth --color 36 <path>\ldraw\parts\3024.dat
bun run src/cli -f svg --lib <path>\ldraw\ -v --no-smooth --color 15 --el -20 --az -30  <path>>\ldraw\parts\105162p02.dat
```

## Tests

```bash
bun test
```

35 tests couvrant : parser, couleurs, géométrie, BFC, TEXMAP, MPD, SVG et GLB.

---

## Licence

MIT
