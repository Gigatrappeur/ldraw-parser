// ============================================================
// LDraw Parser – Test resolver helper
// Fournit un resolveFile de test qui renvoie le contenu LDConfig.ldr
// sans dépendre de l'arborescence LDraw réelle.
// ============================================================

import type { LDrawColor } from "./color-table";
import { buildColorTable } from "./color-table";

/**
 * Construit le contenu LDConfig.ldr au format attendu par ColorTable.load().
 * Chaque ligne a la forme:
 *   0 !COLOUR <name> CODE <code> VALUE #<rrggbb> EDGE #<rrggbb> [ALPHA <n>] [FINISH]
 */
export function buildLdConfigContent(colors: Map<number, LDrawColor>): string {
  const lines: string[] = [];
  for (const color of colors.values()) {
    if (color.code === 16 || color.code === 24) continue;
    let line = `0 !COLOUR ${color.name} CODE ${color.code} VALUE #${color.hex} EDGE #${(color.edge >>> 0).toString(16).padStart(6, "0")}`;
    if (color.alpha < 255) line += ` ALPHA ${color.alpha}`;
    if (color.finish !== "NORMAL") line += ` ${color.finish}`;
    if (color.material) {
      line += ` MATERIAL ${color.material.type} VALUE #${color.material.value}`;
    }
    lines.push(line);
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Vérifie si la chaîne ressemble à du contenu LDraw brut
 * (commence par "0 " ou contient des commandes LDraw).
 */
function isLDrawContent(s: string): boolean {
  return /^\s*0\s/.test(s) || /\b[2345]\s+\d+\s/.test(s);
}

/**
 * Crée un resolveFile pour les tests.
 *
 * - Si le "nom" ressemble à du contenu LDraw brut, il est renvoyé tel quel.
 * - Les fichiers subFiles sont retournés par leur nom (case-insensitive).
 * - LDConfig.ldr est servi depuis la table de couleurs intégrée.
 */
export function createTestResolver(
  subFiles: Record<string, string> = {},
  ldconfigOverride?: string,
): (name: string) => Promise<string | null> {
  const colorTable = buildColorTable();
  const defaultLdconfig = ldconfigOverride ?? buildLdConfigContent(colorTable);

  return async (name: string): Promise<string | null> => {
    // Si le "nom" ressemble à du contenu LDraw brut, le renvoyer tel quel
    // (c'est le cas quand les tests appellent parser.parse(content, filename))
    if (isLDrawContent(name)) {
      return name;
    }
    const lower = name.toLowerCase();
    if (/ldconfig\.ldr$/i.test(lower)) {
      return defaultLdconfig;
    }
    return subFiles[lower] ?? null;
  };
}
