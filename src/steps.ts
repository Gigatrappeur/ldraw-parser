// ============================================================
// LDraw Parser – STEP / ROTSTEP support
// ============================================================
//
// LDraw models can include build steps via `0 STEP` (standard)
// and `0 ROTSTEP` (MLCad extension) comments.
//
// This module:
//   • Extracts individual build steps from a parsed LDrawFile
//   • Resolves the cumulative camera rotation per step (ROTSTEP)
//   • Generates per-step FlatGeometry (for thumbnails / animations)
//
// STEP spec:
//   0 STEP               — end of a build step
//
// ROTSTEP spec (MLCad):
//   0 ROTSTEP <x> <y> <z> [ABS|REL|ADD|END]
//   Positive X = tilting top backward, Y = rotating right, Z = rolling right
//   ABS = absolute rotation, REL = relative (default), END = reset
// ============================================================

import type { LDrawFile, LDrawCommand, FlatGeometry, LDrawComment } from "./types";
import type { ResolverContext } from "./types";
import { flattenGeometry } from "./resolver";
import { IDENTITY, multiplyMatrices } from "./utils";
import type { Matrix4 } from "./types";

// ── Types ─────────────────────────────────────────────────────

export interface StepRotation {
  x: number;  // degrees
  y: number;
  z: number;
  type: "ABS" | "REL" | "ADD" | "END";
}

export interface BuildStep {
  /** 0-based step index */
  index:    number;
  /** Commands belonging to this step (all sub-file refs, geometry) */
  commands: LDrawCommand[];
  /**
   * Cumulative camera rotation for this step (from ROTSTEP).
   * undefined = no camera override (use default view).
   */
  rotation?: StepRotation;
}

export interface StepGeometry {
  step:       BuildStep;
  /** Geometry for just this step's new parts */
  stepGeo:    FlatGeometry;
  /** Cumulative geometry up to and including this step */
  cumulativeGeo: FlatGeometry;
}

// ── Parse ROTSTEP ─────────────────────────────────────────────

function parseRotstep(line: string): StepRotation | null {
  const m = line.match(/^0\s+ROTSTEP\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(ABS|REL|ADD|END))?/i);
  if (!m) {
    // Bare "0 ROTSTEP END"
    if (/^0\s+ROTSTEP\s+END/i.test(line)) {
      return { x: 0, y: 0, z: 0, type: "END" };
    }
    return null;
  }
  return {
    x:    parseFloat(m[1]!),
    y:    parseFloat(m[2]!),
    z:    parseFloat(m[3]!),
    type: (m[4]?.toUpperCase() ?? "REL") as StepRotation["type"],
  };
}

// ── Extract steps ─────────────────────────────────────────────

/**
 * Split a parsed LDrawFile into its build steps.
 *
 * A file with no `0 STEP` commands is treated as a single step
 * containing all commands.
 *
 * @param file The parsed LDrawFile (including MPD root files).
 * @returns    Array of BuildStep, one per step.
 */
export function extractSteps(file: LDrawFile): BuildStep[] {
  const steps: BuildStep[] = [];
  let current: LDrawCommand[] = [];
  let rotation: StepRotation | undefined;
  let stepIdx = 0;

  for (const cmd of file.commands) {
    if (cmd.type !== 0) {
      current.push(cmd);
      continue;
    }

    const comment = cmd as LDrawComment;
    const raw = comment.raw.trim();

    // STEP marker
    if (/^0\s+STEP\s*$/i.test(raw)) {
      steps.push({ index: stepIdx++, commands: current, rotation });
      current  = [];
      rotation = undefined;
      continue;
    }

    // ROTSTEP
    const rot = parseRotstep(raw);
    if (rot) {
      // Preserve END as an explicit marker; computeCameraRotations handles it.
      // Setting undefined here would lose the END signal (treated as "no change").
      rotation = rot;
      continue;
    }

    // All other type-0 lines are kept as comments in the current step
    current.push(cmd);
  }

  // Trailing commands after the last STEP (or the whole file if no STEP)
  if (current.length > 0 || steps.length === 0) {
    steps.push({ index: stepIdx, commands: current, rotation });
  }

  return steps;
}

/**
 * True if the file contains any `0 STEP` commands.
 */
export function hasSteps(file: LDrawFile): boolean {
  return file.commands.some(
    (c) => c.type === 0 && /^0\s+STEP\s*$/i.test((c as LDrawComment).raw.trim()),
  );
}

// ── Step geometry ─────────────────────────────────────────────

/**
 * Generate FlatGeometry for each build step.
 *
 * Returns both the per-step geometry (only new parts) and the
 * cumulative geometry (all parts up to and including that step).
 *
 * This is the main entry point for building step-by-step
 * construction animations or thumbnails.
 *
 * @param file  The parsed LDrawFile.
 * @param ctx   Resolver context (for sub-file resolution).
 */
export async function generateStepGeometries(
  file: LDrawFile,
  ctx: ResolverContext,
): Promise<StepGeometry[]> {
  const steps = extractSteps(file);
  const results: StepGeometry[] = [];

  // Build cumulative command list step-by-step
  const cumulativeCommands: LDrawCommand[] = [];

  for (const step of steps) {
    // Per-step file (only this step's commands)
    const stepFile: LDrawFile = {
      ...file,
      commands: step.commands,
    };

    // Cumulative file (all commands so far)
    cumulativeCommands.push(...step.commands);
    const cumulativeFile: LDrawFile = {
      ...file,
      commands: [...cumulativeCommands],
    };

    const [stepGeo, cumulativeGeo] = await Promise.all([
      flattenGeometry(stepFile, ctx),
      flattenGeometry(cumulativeFile, ctx),
    ]);

    results.push({ step, stepGeo, cumulativeGeo });
  }

  return results;
}

// ── ROTSTEP → view matrix ─────────────────────────────────────

function degToRad(d: number): number { return (d * Math.PI) / 180; }

/**
 * Convert a StepRotation to a 4×4 view matrix (column-major).
 *
 * ROTSTEP rotation order: X then Y then Z (Euler XYZ).
 * The resulting matrix can be applied to a camera direction vector.
 *
 * Returns IDENTITY when rotation is undefined or type=END.
 */
export function rotationToMatrix(rot: StepRotation | undefined): Matrix4 {
  if (!rot || rot.type === "END") return IDENTITY;

  const rx = degToRad(rot.x);
  const ry = degToRad(rot.y);
  const rz = degToRad(rot.z);

  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Rx — column-major: col0=[1,0,0,0], col1=[0,cx,sx,0], col2=[0,-sx,cx,0]
  const Rx: Matrix4 = [
    1,   0,   0,  0,
    0,  cx,  sx,  0,
    0, -sx,  cx,  0,
    0,   0,   0,  1,
  ];

  // Ry — column-major: col0=[cy,0,-sy,0], col1=[0,1,0,0], col2=[sy,0,cy,0]
  const Ry: Matrix4 = [
    cy,  0, -sy,  0,
     0,  1,   0,  0,
    sy,  0,  cy,  0,
     0,  0,   0,  1,
  ];

  // Rz — column-major: col0=[cz,sz,0,0], col1=[-sz,cz,0,0], col2=[0,0,1,0]
  const Rz: Matrix4 = [
    cz,  sz,  0,  0,
   -sz,  cz,  0,  0,
     0,   0,  1,  0,
     0,   0,  0,  1,
  ];

  // Combined: Rz * Ry * Rx (applied in X, Y, Z order)
  return multiplyMatrices(multiplyMatrices(Rz, Ry), Rx);
}

/**
 * Compute the cumulative camera rotation across steps.
 *
 * REL / ADD rotations accumulate, ABS resets to that rotation,
 * END resets to identity.
 */
export function computeCameraRotations(steps: BuildStep[]): Array<StepRotation | undefined> {
  const result: Array<StepRotation | undefined> = [];
  let current: StepRotation | undefined;

  for (const step of steps) {
    const rot = step.rotation;
    if (!rot) {
      result.push(current);
      continue;
    }

    switch (rot.type) {
      case "END":
        current = undefined;
        break;
      case "ABS":
        current = rot;
        break;
      case "REL":
      case "ADD":
        if (!current) {
          current = rot;
        } else {
          current = {
            x:    current.x + rot.x,
            y:    current.y + rot.y,
            z:    current.z + rot.z,
            type: "ABS",
          };
        }
        break;
    }

    result.push(current);
  }

  return result;
}