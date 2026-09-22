# ldraw-parser

Parser TypeScript pour fichiers LDraw (.dat / .ldr / .mpd), avec export **GLB** (glTF 2.0), **GLTF** et **SVG**. Aucune dépendance runtime.

<!-- toc -->

- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Utilisation](#utilisation)
- [API](#api)
  - [`LDrawParser`](#ldrawparser)
  - [`LDrawPart`](#ldrawpart)
  - [`SimpleFileResolver`](#simplefileresolver)
- [CLI](#cli)
- [Types principaux](#types-principaux)
- [Unités LDraw](#unités-ldraw)
- [Tests](#tests)
- [Structure du projet](#structure-du-projet)
- [Licence](#licence)

<!-- tocstop -->

---

## Fonctionnalités

- Parsing complet des types LDraw **0–5** (commentaires, références, triangles, quads, lignes optionnelles)
- Métadonnées : `description`, `name`, `author`, `!LDRAW_ORG`, `!CATEGORY`, `!KEYWORDS`, `!LICENSE`, `!HISTORY`, `!HELP`, `!CMDLINE`
- Table de couleurs **200+ codes officiels** LDraw, avec transparence (alpha < 255) et finitions (CHROME, METAL, PEARLESCENT, RUBBER, MATTE_METALLIC, GLITTER, SPECKLE)
- Support **BFC** : certification CW/CCW, `INVERTNEXT`, `CLIP`/`NOCLIP`, inversion sur réflexion matricielle
- Support **TEXMAP** : projections PLANAR / CYLINDRICAL / SPHERICAL, piles imbriquées, calcul UVs
- Support **MPD** : sous-fichiers `0 FILE`, résolution externe async
- Résolution de sous-fichiers **case-insensitive** avec cache mémoire
- Export **GLB** (glTF 2.0 binaire) avec matériaux PBR, normales lissées ou flat, UVs, transparence, textures
- Export **GLTF** (JSON + images)
- Export **SVG** : thumbnail isométrique avec Lambert shading, painter's algorithm, transparence
- Post-processing : conversion d'unités (LDU → m/mm/cm/in/studs), merge de meshes, statistiques, palette de couleurs

---

## Installation

```bash
# Avec npm (dev dependency uniquement, pour TypeScript)
npm install --save-dev typescript @types/node @types/bun

# Ou avec bun
bun add -d typescript @types/node @types/bun
```

Le parser lui-même n'a **aucune dépendance runtime** — il suffit de copier les fichiers `src/` dans votre projet.

---

## Utilisation

```ts
import LDrawParser from "./src/index";

// 1. Créer le parser avec la racine de la bibliothèque LDraw
const parser = new LDrawParser({ libraryRoot: "/usr/share/ldraw" });

// 2. Parser un fichier (résout automatiquement les sous-fichiers)
const part = await parser.parse("3024.dat");

// 3. Lire les métadonnées
console.log(part.file.meta.description);  // "Brick 2 x 4"
console.log(part.file.meta.author);       // "The LEGO Group"

// 4. Statistiques géométriques
const stats = part.stats();
console.log(`Triangles: ${stats.triangleCount}, Couleurs: ${stats.colorCount}`);

// 5. Export GLB (par défaut en mètres, Y-up glTF)
const glb = await part.toGlb();
await Bun.write("model.glb", glb);

// 6. Export SVG thumbnail
const svg = part.toSvg({ azimuth: 45, elevation: 30, width: 512 });
await Bun.write("thumbnail.svg", svg);

// 7. Palette de couleurs utilisée
const palette = part.palette();
// [{ color, triangleCount, isTransparent }, ...]
```

### Résolution personnalisée

Si vous ne pouvez pas utiliser un dossier LDraw local, fournissez votre propre résolveur :

```ts
const parser = new LDrawParser({
  resolveFile: async (name: string) => {
    // Récupérer depuis un serveur distant, une base de données, etc.
    const response = await fetch(`https://example.com/parts/${name}`);
    return await response.text();
  },
  resolveTexture: async (name: string) => {
    const response = await fetch(`https://example.com/textures/${name}`);
    return new Uint8Array(await response.arrayBuffer());
  },
});

const part = await parser.parse("3024.dat");
```

---

## API

### `LDrawParser`

Classe principale, point d'entrée pour parser les fichiers LDraw.

```ts
const parser = new LDrawParser(options?: LDrawParserOptions);
```

#### `LDrawParserOptions`

| Propriété | Type | Défaut | Description |
|---|---|---|---|
| `libraryRoot` | `string` | — | Racine du dossier LDraw (recherche dans `parts/` et `p/`) |
| `resolveFile` | `(name: string) => Promise<string>` | — | Callback personnalisé pour lire les sous-fichiers |
| `resolveTexture` | `(name: string) => Promise<Uint8Array>` | — | Callback personnalisé pour lire les textures |
| `defaultColor` | `number` | `71` | Couleur par défaut pour les parties qui héritent du parent (code 16) |
| `maxDepth` | `number` | `64` | Profondeur max de récursion pour les sous-fichiers |

#### Méthodes

```ts
// Parser + résoudre un modèle complet (avec géométrie aplatie)
parse(name: string, ctxOverride?: { defaultColor?: number }): Promise<LDrawPart>

// Parser uniquement, sans résolution des sous-fichiers
parseOnly(name: string, ctxOverride?: { defaultColor?: number }): Promise<LDrawFile>

// Vider le cache interne des sous-fichiers
clearCache(): void

// Accéder à la table de couleurs
get colorTable(): ColorTable
```

---

### `LDrawPart`

Résultat d'un parsing complet. Contient le fichier parsé et la géométrie aplatie.

```ts
const part = await parser.parse("3024.dat");
```

| Méthode | Retour | Description |
|---|---|---|
| `toGlb(options?, unit?, merge?)` | `Promise<Uint8Array>` | Export GLB binaire (glTF 2.0) |
| `toGltf(options?)` | `Promise<{ gltf: string; images: Map<string, Uint8Array> }>` | Export GLTF JSON + textures |
| `toSvg(options?)` | `string` | Thumbnail SVG isométrique |
| `stats()` | `GeometryStats` | Statistiques géométriques |
| `palette()` | `ColorUsage[]` | Palette de couleurs triée par usage |
| `textures()` | `string[]` | Fichiers textures référencés via TEXMAP |

#### Options d'export GLB

```ts
await part.toGlb(
  {
    normals: true,           // normales lissées (default: true)
    weld: true | { smoothNormals: true, creasAngle: 45 },
    merge: true,             // fusionner les meshes par couleur (default: true)
  },
  "m",                     // unité: "ldu" \| "mm" \| "cm" \| "m" \| "in" \| "studs"
  true                     // merge (default: true)
);
```

#### Options SVG

```ts
part.toSvg({
  azimuth: 45,             // angle azimutal en degrés (default: 45)
  elevation: 30,           // angle d'élévation en degrés (default: 30)
  width: 512,              // largeur en pixels (default: 512)
  height: 512,             // hauteur en pixels (default: 512)
  showEdges: false,        // afficher les arêtes (default: false)
});
```

---

### `SimpleFileResolver`

Résolveur de fichiers basé sur l'API `Bun.file()`. Non compatible Node.js.

```ts
import { SimpleFileResolver } from "./src/simple-resolver";

const resolver = new SimpleFileResolver("/usr/share/ldraw");
const content = await resolver.resolvePart("3024.dat");
const texture = await resolver.resolveTexture("some_texture.png");
```

---

## CLI

Convertisseur batch LDraw → GLB / SVG / JSON via la CLI.

```bash
# Conversion avec la bibliothèque LDraw
bun run src/cli.ts --lib <path-to-ldraw> -f glb,svg model.ldr

# Analyse d'un fichier GLB
bun run src/cli.ts --analyse-glb model.glb
bun run src/cli.ts --analyse-glb --json model.glb

# Stats uniquement
bun run src/cli.ts --lib <path-to-ldraw> --stats model.ldr

# Options disponibles
bun run src/cli.ts --help
```

| Option | Description |
|---|---|
| `-o, --out <dir>` | Répertoire de sortie (default: `./out`) |
| `-f, --format <list>` | Formats : `glb,gltf,svg,json` (default: `glb,svg`) |
| `--unit <unit>` | Unité de sortie : `ldu\|mm\|cm\|m\|in\|studs` (default: `m`) |
| `--lib, --library <p>` | Racine de la bibliothèque LDraw (`env: LDRAW_LIB`) |
| `--svg-size <px>` | Taille du thumbnail SVG (default: `512`) |
| `--az <deg>` | Azimut de la caméra SVG (default: `45`) |
| `--el <deg>` | Élévation de la caméra SVG (default: `30`) |
| `--crease <deg>` | Angle de crête pour normales lissées (default: `45`) |
| `--no-smooth` | Désactiver les normales lissées |
| `--no-merge` | Ne pas fusionner les meshes par couleur |
| `--stats` | Afficher les statistiques uniquement, sans sortie |
| `--color <spec>` | Forcer la couleur principale (code LDraw, hex, ou nom) |
| `--analyse-glb` | Analyser un fichier GLB au lieu de parser du LDraw |
| `--json` | Sortie JSON (pour `--analyse-glb`) |
| `-v, --verbose` | Log détaillé |

Exemples :

```bash
# Convertir un fichier avec une couleur personnalisée
bun run src/cli.ts --lib /usr/share/ldraw --color 4 model.dat

# Convertir avec une couleur hexadécimale
bun run src/cli.ts --lib /usr/share/ldraw --color "#FF6600" -f glb,svg model.ldr

# Analyser un GLB
bun run src/cli.ts --analyse-glb model.glb
```

---

## Types principaux

#### `LDrawFile`

```ts
interface LDrawFile {
  name: string;
  meta: LDrawFileMeta;
  commands: LDrawCommand[];
  subFiles?: Map<string, LDrawFile>;
}

interface LDrawFileMeta {
  description?: string;
  name?: string;
  author?: string;
  fileType?: LDrawFileType;
  license?: string;
  category?: string;
  keywords?: string[];
  help?: string[];
  history?: Array<{ date: string; author: string; description: string }>;
  colors?: LDrawColor[];
  bfcCertified?: boolean;
  bfcWinding?: "CW" | "CCW";
}
```

#### `LDrawColor`

```ts
interface LDrawColor {
  code: number;
  name: string;
  value: number;        // 0xRRGGBB
  edge: number;         // 0xRRGGBB
  alpha: number;        // 0-255
  luminance: number;    // 0-255
  finish: "CHROME" | "METAL" | "PEARLESCENT" | "RUBBER" | "MATTE_METALLIC" | "NORMAL" | ...;
  isTransparent: boolean;
  rgba: [number, number, number, number];
  edgeRgba: [number, number, number, number];
  material?: { type: "GLITTER" | "SPECKLE"; fraction: number; ... };
}
```

#### `FlatGeometry`

```ts
interface FlatGeometry {
  meshes: GeometryMesh[];
  edges: GeometryEdges[];
  colorTable: Map<number, LDrawColor>;
  aabb: AABB;
}

interface GeometryMesh {
  colorCode: number;
  triangles: Array<{ a: GeometryVertex; b: GeometryVertex; c: GeometryVertex }>;
  texmap?: TexmapDefinition;
}

interface GeometryVertex {
  position: { x: number; y: number; z: number };
  uv?: { u: number; v: number };
}
```

---

## Unités LDraw

| Unité | Valeur | Usage |
|---|---|---|
| 1 LDU | 0.4 mm | Unité native LDraw |
| 1 stud | 20 LDU = 8 mm | Pas des tenons LEGO |
| 1 plaque | 8 LDU = 3.2 mm | Hauteur d'une plaque |
| 1 brique | 24 LDU = 9.6 mm | Hauteur d'une brique |

Le GLB est généré en **mètres** par défaut pour respecter la convention glTF 2.0.

---

## Tests

```bash
bun test
```

Tests couvrant : parser, couleurs, géométrie, BFC, TEXMAP, MPD, SVG, GLB, sérialisation, résolveur et textures.

---

## Structure du projet

```
src/
├── index.ts          Export public + classe LDrawParser
├── ldraw-part.ts     Classe LDrawPart ( géométrie + export)
├── parser.ts         Parser ligne par ligne (types 0–5)
├── resolver.ts       Résolution récursive async + aplatissement
├── simple-resolver.ts Résolveur filesystem Bun avec cache
├── colors.ts         Table 200+ couleurs + parsing !COLOUR
├── types.ts          Interfaces TypeScript
├── glb2.ts           Export GLB / glTF 2.0 (PBR, textures, transmission)
├── glb-analyser.ts   Analyse de fichiers GLB
├── svg.ts            Thumbnail SVG (projection, shading, painter's algo)
├── postprocess.ts    Conversion unités, merge, stats, LOD
├── utils.ts          Matrices 4×4, Vec3, AABB, projection TEXMAP
├── normals.ts        Calcul de normales lissées
├── weld.ts           Outils de soudure de sommets
├── serialise.ts      Sérialisation de fichiers LDraw
└── cli.ts            CLI batch de conversion
```

---

## Licence

MIT
