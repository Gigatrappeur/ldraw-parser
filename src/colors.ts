// ============================================================
// LDraw Parser – Built-in colour table
// Sourced from LDConfig.ldr (LDraw standard)
// ============================================================

import type { LDrawColor, LDrawColorFinish, LDrawMaterial } from "./types";

// ── Helpers ──────────────────────────────────────────────────

function hexToInt(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16);
}

function intToRgba(
  value: number,
  alpha: number,
): [number, number, number, number] {
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
    alpha / 255,
  ];
}

function makeColor(
  code: number,
  name: string,
  value: string,
  edge: string,
  alpha = 255,
  luminance = 0,
  finish: LDrawColorFinish = "NORMAL",
  material?: LDrawMaterial,
): LDrawColor {
  const v = hexToInt(value);
  const e = hexToInt(edge);
  return {
    code,
    name,
    value: v,
    edge: e,
    alpha,
    luminance,
    finish,
    material,
    isTransparent: alpha < 255,
    rgba: intToRgba(v, alpha),
    edgeRgba: intToRgba(e, 255),
  };
}

// ── Special codes ────────────────────────────────────────────

/** Colour 16 = inherit current colour (main colour) */
export const MAIN_COLOR_CODE = 16;
/** Colour 24 = edge colour */
export const EDGE_COLOR_CODE = 24;

/** Returns true if the colour code is a "meta" colour (16 or 24) */
export function isMetaColorCode(code: number): boolean {
  return code === MAIN_COLOR_CODE || code === EDGE_COLOR_CODE;
}

// ── Parse a !COLOUR meta-command ─────────────────────────────

/**
 * Parse a `0 !COLOUR …` definition line.
 *
 * Format:
 *   0 !COLOUR <name>
 *     CODE <code>
 *     VALUE #<rrggbb>
 *     EDGE #<rrggbb>|<code>
 *     [ALPHA <0-255>]
 *     [LUMINANCE <0-255>]
 *     [CHROME | PEARLESCENT | RUBBER | MATTE_METALLIC | METAL]
 *     [MATERIAL GLITTER|SPECKLE VALUE #<hex> ALPHA <n> LUMINANCE <n> FRACTION <f> VFRACTION <f> SIZE <n> ...]
 */
export function parseColorDefinition(line: string): LDrawColor | null {
  // Strip leading "0 !COLOUR" prefix
  const body = line.replace(/^\s*0\s+!COLOUR\s+/i, "");
  if (!body) return null;

  const get = (token: string): string | undefined => {
    const m = new RegExp(`\\b${token}\\s+(\\S+)`, "i").exec(body);
    return m ? m[1] : undefined;
  };

  const namePart = body.split(/\s+/)[0] ?? "";
  const codeStr = get("CODE");
  const valueStr = get("VALUE");
  const edgeStr = get("EDGE");

  if (!codeStr || !valueStr || !edgeStr) return null;

  const name = namePart;
  const code = parseInt(codeStr, 10);
  const value = valueStr.replace(/^#/, "");
  const edgeRaw = edgeStr.replace(/^#/, "");
  // EDGE can be either a hex colour or a colour code integer
  const edge = /^[0-9A-Fa-f]{6}$/.test(edgeRaw) ? edgeRaw : "595959";

  const alpha = parseInt(get("ALPHA") ?? "255", 10);
  const luminance = parseInt(get("LUMINANCE") ?? "0", 10);

  let finish: LDrawColorFinish = "NORMAL";
  for (const f of [
    "CHROME",
    "PEARLESCENT",
    "RUBBER",
    "MATTE_METALLIC",
    "METAL",
  ] as LDrawColorFinish[]) {
    if (new RegExp(`\\b${f}\\b`, "i").test(body)) {
      finish = f;
      break;
    }
  }

  // MATERIAL sub-block
  let material: LDrawMaterial | undefined;
  const matM = /\bMATERIAL\s+(GLITTER|SPECKLE)\s+VALUE\s+#([0-9A-Fa-f]{6})(.*)/i.exec(
    body,
  );
  if (matM) {
    const matType = (matM[1] ?? "GLITTER").toUpperCase() as "GLITTER" | "SPECKLE";
    const rest = matM[3] ?? "";
    const mg = (t: string) => {
      const mm = new RegExp(`\\b${t}\\s+(\\S+)`, "i").exec(rest);
      return mm ? mm[1] : undefined;
    };
    material = {
      type: matType,
      value: matM[2] ?? "808080",
      alpha: parseInt(mg("ALPHA") ?? "255", 10),
      luminance: parseInt(mg("LUMINANCE") ?? "0", 10),
      fraction: parseFloat(mg("FRACTION") ?? "0.5"),
      vfraction: parseFloat(mg("VFRACTION") ?? "0.5"),
      size: mg("SIZE") ? parseInt(mg("SIZE")!, 10) : undefined,
      minsize: mg("MINSIZE") ? parseInt(mg("MINSIZE")!, 10) : undefined,
      maxsize: mg("MAXSIZE") ? parseInt(mg("MAXSIZE")!, 10) : undefined,
    };
    finish = "MATERIAL";
  }

  return makeColor(code, name, value, edge, alpha, luminance, finish, material);
}

// ── Built-in colour table (LDraw standard colours) ───────────
// This covers the ~200+ official codes. Consumers can extend it
// by calling buildColorTable() with an LDConfig.ldr content.

const BUILTIN_COLORS: LDrawColor[] = [
  // ── Solid colours ──────────────────────────────────────────
  makeColor(0, "Black", "1B2A34", "545454"),
  makeColor(1, "Blue", "1E5AA8", "1B2A34"),
  makeColor(2, "Green", "00852B", "184632"),
  makeColor(3, "Dark_Turquoise", "069D9F", "1B2A34"),
  makeColor(4, "Red", "C91A09", "6B0F02"),
  makeColor(5, "Dark_Pink", "C870A0", "1B2A34"),
  makeColor(6, "Brown", "583927", "1B2A34"),
  makeColor(7, "Light_Grey", "9BA19D", "1B2A34"),
  makeColor(8, "Dark_Grey", "6D6E5C", "1B2A34"),
  makeColor(9, "Light_Blue", "B4D2E3", "1B2A34"),
  makeColor(10, "Bright_Green", "58AB41", "184632"),
  makeColor(11, "Light_Turquoise", "73DDE0", "1B2A34"),
  makeColor(12, "Salmon", "F06D61", "1B2A34"),
  makeColor(13, "Pink", "F6A9BB", "1B2A34"),
  makeColor(14, "Yellow", "FAC80A", "1B2A34"),
  makeColor(15, "White", "FFFFFF", "9BA19D"),
  // 16 = main colour (special)
  makeColor(17, "Light_Green", "9DD291", "1B2A34"),
  makeColor(18, "Light_Yellow", "FAE27A", "1B2A34"),
  makeColor(19, "Tan", "E4CD9E", "1B2A34"),
  makeColor(20, "Light_Violet", "C9CAE2", "1B2A34"),
  makeColor(21, "Phosphor_White", "E0FFB0", "1B2A34"),
  makeColor(22, "Violet", "81007B", "1B2A34"),
  makeColor(23, "Violet_Blue", "2032B0", "1B2A34"),
  // 24 = edge colour (special)
  makeColor(25, "Orange", "FE8A18", "1B2A34"),
  makeColor(26, "Magenta", "923978", "1B2A34"),
  makeColor(27, "Lime", "BBE90B", "1B2A34"),
  makeColor(28, "Dark_Tan", "958A73", "1B2A34"),
  makeColor(29, "Bright_Pink", "E4ADC8", "1B2A34"),
  makeColor(30, "Medium_Lavender", "AC78BA", "1B2A34"),
  makeColor(31, "Lavender", "E1D5ED", "1B2A34"),
  makeColor(32, "Very_Light_Orange", "F9D2A1", "1B2A34"),
  makeColor(33, "Very_Light_Bluish_Grey", "E6E3DA", "1B2A34"),
  makeColor(34, "Yellowish_Green", "9BC400", "1B2A34"),
  makeColor(36, "Bright_Red", "F5251C", "1B2A34"),
  makeColor(37, "Medium_Blue_Violet", "6874CA", "1B2A34"),
  makeColor(38, "Dark_Brown", "352100", "1B2A34"),
  makeColor(39, "Sand_Blue", "7988A1", "1B2A34"),
  makeColor(40, "Sand_Green", "A0BCAC", "1B2A34"),
  makeColor(41, "Dark_Blue", "1A3441", "1B2A34"),
  makeColor(42, "Medium_Green", "73DCA1", "1B2A34"),
  makeColor(43, "Light_Blue-Violet", "6BABE4", "1B2A34"),
  makeColor(45, "Light_Orange_Brown", "DF956F", "1B2A34"),
  makeColor(46, "Sand_Yellow", "D3BE96", "1B2A34"),
  makeColor(47, "Earth_Orange", "DF8135", "1B2A34"),
  makeColor(52, "Medium_Violet", "6B629B", "1B2A34"),
  makeColor(54, "Copper", "AE7A59", "1B2A34"),
  makeColor(57, "Maersk_Blue", "54A9C8", "1B2A34"),
  makeColor(65, "Gold", "DCA93A", "1B2A34"),
  makeColor(66, "Dark_Yellow", "C7AF02", "1B2A34"),
  makeColor(67, "Clear", "FFFFFF", "9BA19D", 128),
  makeColor(68, "Medium_Orange", "FFA70B", "1B2A34"),
  makeColor(69, "Bright_Purple", "CD6298", "1B2A34"),
  makeColor(70, "Reddish_Brown", "582A12", "1B2A34"),
  makeColor(71, "Light_Bluish_Grey", "A0A5A9", "1B2A34"),
  makeColor(72, "Dark_Bluish_Grey", "6C6E68", "1B2A34"),
  makeColor(73, "Medium_Blue", "5B9AD1", "1B2A34"),
  makeColor(74, "Medium_Green", "73DCA1", "1B2A34"),
  makeColor(75, "Speckle_Black_Copper", "000000", "595959", 255, 0, "MATERIAL", { type: "SPECKLE", value: "AE7A59", fraction: 0.4, vfraction: 0.4 }),
  makeColor(76, "Speckle_DBGray_Silver", "635F52", "595959", 255, 0, "MATERIAL", { type: "SPECKLE", value: "FFFFFF", fraction: 0.4, vfraction: 0.4 }),
  makeColor(77, "Bright_Pink", "F6A9BB", "1B2A34"),
  makeColor(78, "Light_Nougat", "F3C988", "1B2A34"),
  makeColor(79, "Milky_White", "FFFFFF", "9BA19D", 240, 20),
  makeColor(80, "Metallic_Silver", "A5A9B4", "1B2A34", 255, 0, "METAL"),
  makeColor(81, "Metallic_Green", "899B5F", "1B2A34", 255, 0, "METAL"),
  makeColor(82, "Metallic_Gold", "DBAC34", "1B2A34", 255, 0, "METAL"),
  makeColor(83, "Metallic_Black", "1B2A34", "545454", 255, 0, "METAL"),
  makeColor(84, "Nougat", "CC702A", "1B2A34"),
  makeColor(85, "Dark_Purple", "3F3691", "1B2A34"),
  makeColor(86, "Dark_Flesh", "7C503A", "1B2A34"),
  makeColor(87, "Dark_Metallic_Grey", "595959", "1B2A34", 255, 0, "METAL"),
  makeColor(89, "Royal_Blue", "4C61DB", "1B2A34"),
  makeColor(92, "Flesh", "D09168", "1B2A34"),
  makeColor(100, "Light_Salmon", "FEBABD", "1B2A34"),
  makeColor(110, "Violet", "4354A3", "1B2A34"),
  makeColor(112, "Medium_Violet", "6874CA", "1B2A34"),
  makeColor(115, "Medium_Lime", "C7D23C", "1B2A34"),
  makeColor(118, "Aqua", "B3D7D1", "1B2A34"),
  makeColor(120, "Light_Lime", "D9E4A7", "1B2A34"),
  makeColor(125, "Light_Orange", "F9D28E", "1B2A34"),
  makeColor(128, "Dark_Nougat", "AD6140", "1B2A34"),
  makeColor(134, "Pearl_Copper", "9E5B00", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(135, "Pearl_Grey", "9BA19D", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(137, "Pearl_Sand_Blue", "7988A1", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(142, "Pearl_Gold", "AA7F2E", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(147, "Pearl_Dark_Grey", "575857", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(148, "Pearl_Very_Light_Grey", "BBBDBC", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(150, "Very_Light_Grey", "BBBDBC", "1B2A34"),
  makeColor(151, "Very_Light_Bluish_Grey", "C0C5C2", "1B2A34"),
  makeColor(178, "Flat_Silver", "898788", "1B2A34", 255, 0, "METAL"),
  makeColor(179, "Flat_Tan", "B4AC98", "1B2A34"),
  makeColor(183, "Pearl_White", "FDEEE4", "1B2A34", 255, 0, "PEARLESCENT"),
  makeColor(184, "Chrome_Blue", "1D4C8C", "1B2A34", 255, 0, "CHROME"),
  makeColor(185, "Chrome_Green", "3D6B43", "1B2A34", 255, 0, "CHROME"),
  makeColor(186, "Chrome_Pink", "AA4D8E", "1B2A34", 255, 0, "CHROME"),
  makeColor(187, "Chrome_Black", "1B2A34", "545454", 255, 0, "CHROME"),
  makeColor(189, "Reddish_Gold", "AC8247", "1B2A34"),
  makeColor(191, "Bright_Light_Orange", "F8BB3D", "1B2A34"),
  makeColor(212, "Light_Royal_Blue", "9FC3E9", "1B2A34"),
  makeColor(216, "Rust", "872B17", "1B2A34"),
  makeColor(217, "Tan", "DEC69C", "1B2A34"),
  makeColor(226, "Cool_Yellow", "FFFF99", "1B2A34"),
  makeColor(230, "Teal", "008F9B", "1B2A34"),
  makeColor(232, "Light_Blue", "68C3E2", "1B2A34"),
  makeColor(236, "Bright_Light_Yellow", "FFF03A", "1B2A34"),
  makeColor(272, "Dark_Blue", "1A3441", "1B2A34"),
  makeColor(273, "Blue", "1E5AA8", "1B2A34"),
  makeColor(288, "Dark_Green", "184632", "1B2A34"),
  makeColor(295, "Flamingo_Pink", "FF94C2", "1B2A34"),
  makeColor(299, "Medium_Stone_Grey", "9BA19D", "1B2A34"),
  makeColor(308, "Dark_Brown", "352100", "1B2A34"),
  makeColor(313, "Maersk_Blue", "54A9C8", "1B2A34"),
  makeColor(320, "Dark_Red", "720E0F", "1B2A34"),
  makeColor(321, "Dark_Azure", "469BC3", "1B2A34"),
  makeColor(322, "Medium_Azure", "68C3E2", "1B2A34"),
  makeColor(323, "Light_Aqua", "D3F2EA", "1B2A34"),
  makeColor(324, "Yellowish_Green", "DFEEA5", "1B2A34"),
  makeColor(325, "Olive_Green", "9B9A5A", "1B2A34"),
  makeColor(326, "Lime_Green", "79C052", "1B2A34"),
  makeColor(330, "Olive_Green", "9B9A5A", "1B2A34"),
  makeColor(335, "Sand_Red", "A97C5B", "1B2A34"),
  makeColor(351, "Medium_Dark_Pink", "F785B1", "1B2A34"),
  makeColor(353, "Coral", "FF6D77", "1B2A34"),
  makeColor(366, "Earth_Orange", "D37F19", "1B2A34"),
  makeColor(373, "Sand_Purple", "845E84", "1B2A34"),
  makeColor(375, "Sand_Blue_Metallic", "7988A1", "1B2A34", 255, 0, "METAL"),
  makeColor(378, "Sand_Green_Metallic", "A0BCAC", "1B2A34", 255, 0, "METAL"),
  makeColor(379, "Sand_Blue", "7988A1", "1B2A34"),
  makeColor(383, "Chrome_Silver", "E0E0E0", "1B2A34", 255, 0, "CHROME"),
  makeColor(406, "Dark_Blue", "0D325B", "1B2A34"),
  makeColor(449, "Purple", "81007B", "1B2A34"),
  makeColor(450, "Fabuland_Brown", "B67B50", "1B2A34"),
  makeColor(462, "Medium_Orange", "FFA70B", "1B2A34"),
  makeColor(484, "Dark_Orange", "A95500", "1B2A34"),
  makeColor(494, "Electric_Contact", "D0D0D0", "1B2A34", 255, 0, "METAL"),
  makeColor(495, "Light_Yellow", "FAE27A", "1B2A34"),
  makeColor(496, "Teal", "008F9B", "1B2A34"),
  makeColor(503, "Very_Light_Grey", "BBBDBC", "1B2A34"),
  makeColor(504, "Light_Tan", "E4CD9E", "1B2A34"),
  makeColor(505, "Lemon_Metallic", "CFC800", "1B2A34", 255, 0, "METAL"),
  makeColor(507, "Light_Orange_Brown", "DF956F", "1B2A34"),
  // ── Transparent colours ────────────────────────────────────
  makeColor(32, "Trans-Black", "635F52", "595959", 128),
  makeColor(33, "Trans-Dark_Blue", "0020A0", "1B2A34", 128),
  makeColor(34, "Trans-Green", "237841", "1B2A34", 128),
  makeColor(35, "Trans-Bright_Green", "56E646", "1B2A34", 128),
  makeColor(36, "Trans-Red", "C91A09", "1B2A34", 128),
  makeColor(40, "Trans-Dark_Pink", "DF6695", "1B2A34", 128),
  makeColor(41, "Trans-Neon_Orange", "FF800D", "1B2A34", 128),
  makeColor(42, "Trans-Very_Lt_Blue", "C1DFF0", "1B2A34", 128),
  makeColor(43, "Trans-Dark_Turquoise", "008F9B", "1B2A34", 128),
  makeColor(44, "Trans-Medium_Blue", "CFE2F7", "1B2A34", 128),
  makeColor(45, "Trans-Yellow", "F5CD2F", "1B2A34", 128),
  makeColor(46, "Trans-Yellow", "CAB000", "1B2A34", 128),
  makeColor(47, "Trans-Clear", "FFFFFF", "9BA19D", 128),
  makeColor(52, "Trans-Purple", "400052", "1B2A34", 128),
  makeColor(54, "Trans-Neon_Green", "C0FF00", "1B2A34", 128),
  makeColor(57, "Trans-Neon_Orange", "FF800D", "1B2A34", 128),
  // Using proper LDraw trans codes (285+)
  makeColor(285, "Trans-Light_Blue", "68BCC5", "1B2A34", 128),
  makeColor(293, "Trans-Dark_Blue", "0020A0", "1B2A34", 128),
  makeColor(294, "Trans-Neon_Yellow", "DAB000", "1B2A34", 128),
  makeColor(297, "Trans-Flame_Yellowish_Orange", "CF8A47", "1B2A34", 128),
  makeColor(298, "Trans-Reddish_Lilac", "EE9DC3", "1B2A34", 128),
  makeColor(311, "Trans-Clear", "FFFFFF", "9BA19D", 128),
  makeColor(315, "Trans-Orange", "F08010", "1B2A34", 128),
  makeColor(329, "Trans-White", "FFFFFF", "9BA19D", 240),
  makeColor(339, "Trans-Light_Purple", "96709F", "1B2A34", 128),
  makeColor(340, "Trans-Bright_Purple", "CF6BA9", "1B2A34", 128),
  makeColor(341, "Trans-Pink", "FC97AC", "1B2A34", 128),
  makeColor(342, "Trans-Neon_Green", "C0FF00", "1B2A34", 128),
  makeColor(343, "Trans-Very_Light_Blue", "C1DFF0", "1B2A34", 128),
  makeColor(349, "Trans-Flame_Reddish_Orange", "E96F01", "1B2A34", 128),
  makeColor(351, "Trans-Bright_Reddish_Violet", "FF007F", "1B2A34", 128),
  makeColor(360, "Trans-Earth_Blue", "193E4F", "1B2A34", 128),
  makeColor(362, "Trans-Bright_Green", "56E646", "1B2A34", 128),
  makeColor(363, "Trans-Neon_Red", "FF3232", "1B2A34", 128),
  makeColor(364, "Trans-Dark_Red", "720E0F", "1B2A34", 128),
  makeColor(365, "Trans-Dark_Pink", "DF6695", "1B2A34", 128),
  makeColor(367, "Trans-Dark_Orange", "A95500", "1B2A34", 128),
  makeColor(368, "Trans-Dark_Blue_Violet", "0040A0", "1B2A34", 128),
  makeColor(369, "Trans-Yellow_Orange", "F08010", "1B2A34", 128),
  makeColor(370, "Trans-Bright_Reddish_Orange", "C0381B", "1B2A34", 128),
  makeColor(371, "Trans-Bright_Blue_Violet", "4040FF", "1B2A34", 128),
  makeColor(372, "Trans-Dark_Green", "006400", "1B2A34", 128),
];

// ── Build map ─────────────────────────────────────────────────

export function buildColorTable(
  ldconfigContent?: string,
): Map<number, LDrawColor> {
  const map = new Map<number, LDrawColor>();

  // Seed with built-ins
  for (const c of BUILTIN_COLORS) {
    map.set(c.code, c);
  }

  // Override / extend with parsed LDConfig content
  if (ldconfigContent) {
    for (const line of ldconfigContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^0\s+!COLOUR\b/i.test(trimmed)) {
        const color = parseColorDefinition(trimmed);
        if (color) map.set(color.code, color);
      }
    }
  }

  return map;
}

/** Resolve a colour code, considering meta codes 16/24 */
export function resolveColor(
  code: number,
  table: Map<number, LDrawColor>,
  parentColor?: LDrawColor,
): LDrawColor {
  if (code === MAIN_COLOR_CODE) {
    return parentColor ?? table.get(0) ?? fallbackColor(code);
  }
  if (code === EDGE_COLOR_CODE) {
    if (parentColor) {
      // Edge colour = the edge colour of the parent
      return {
        ...parentColor,
        value: parentColor.edge,
        rgba: parentColor.edgeRgba,
      };
    }
    return table.get(0) ?? fallbackColor(code);
  }
  return table.get(code) ?? fallbackColor(code);
}

function fallbackColor(code: number): LDrawColor {
  return makeColor(code, `Unknown_${code}`, "808080", "595959");
}

/** Default (singleton) colour table – lazily initialised */
let defaultTable: Map<number, LDrawColor> | null = null;
export function getDefaultColorTable(): Map<number, LDrawColor> {
  if (!defaultTable) defaultTable = buildColorTable();
  return defaultTable;
}
