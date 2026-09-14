// ============================================================
// LDraw Parser – Built-in colour table
// Sourced from LDConfig.ldr (LDraw standard)
// ============================================================

import type { LDrawColor, LDrawColorFinish, LDrawMaterial } from "./types";



export class ColorTable {
  private colors: Map<number, LDrawColor>
  private resolve: (name: string) => Promise<string | null | undefined>

  constructor(resolve: (name: string) => Promise<string | null | undefined>) {
    this.resolve = resolve;
    this.colors = new Map<number, LDrawColor>();
  }

  private async load() {
    if (this.colors.size > 0) return;

    const ldconfigContent = await this.resolve('../LDConfig.ldr')
    if (ldconfigContent) {
      for (const line of ldconfigContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^0\s+!COLOUR\b/i.test(trimmed)) {
          const color = parseColorDefinition(trimmed);
          if (color) this.colors.set(color.code, color);
        }
      }
    } else {
      throw new Error("LDConfig.ldr not found in library root");
    }
  }
  add(color: LDrawColor): void {
    if (!this.colors.has(color.code)) { 
      this.colors.set(color.code, color);
    }
  }

  async get(code: number): Promise<LDrawColor> {
    await this.load()
    if (this.colors.has(code)) {
      return this.colors.get(code)!;
    }
    throw new Error(`Color not found: ${code}`);
  }

  async getTable(): Promise<Map<number, LDrawColor>> {
    await this.load();
    return this.colors;
  }

  async resolveColor(
    code: number,
    parentColor: LDrawColor,
  ): Promise<LDrawColor> {
    if (code === MAIN_COLOR_CODE) {
      return parentColor
    } else if (code === EDGE_COLOR_CODE) {
      // Edge colour = the edge colour of the parent
      return {
        ...parentColor,
        value: parentColor.edge,
        rgba: parentColor.edgeRgba,
      };
    }
    return this.colors.get(code) ?? fallbackColor(code);
  }
}



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
    hex: value
  };
}

// ── Special codes ────────────────────────────────────────────

/** Colour 16 = inherit current colour (main colour) */
const MAIN_COLOR_CODE = 16;
/** Colour 24 = edge colour */
const EDGE_COLOR_CODE = 24;

// /** Returns true if the colour code is a "meta" colour (16 or 24) */
// function isMetaColorCode(code: number): boolean {
//   return code === MAIN_COLOR_CODE || code === EDGE_COLOR_CODE;
// }

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

// ── Fallback ──────────────────────────────────────────────────

function fallbackColor(code: number): LDrawColor {
  return makeColor(code, `Unknown_${code}`, "808080", "595959");
}
