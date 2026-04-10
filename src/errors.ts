// ============================================================
// LDraw Parser – Typed error classes
// ============================================================

/** Base class for all ldraw-parser errors */
export class LDrawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LDrawError";
  }
}

/** Thrown when a line cannot be parsed */
export class LDrawParseError extends LDrawError {
  readonly fileName: string;
  readonly lineNumber: number;
  readonly rawLine: string;

  constructor(fileName: string, lineNumber: number, rawLine: string, reason: string) {
    super(`[${fileName}:${lineNumber}] ${reason}\n  → "${rawLine.trim()}"`);
    this.name = "LDrawParseError";
    this.fileName = fileName;
    this.lineNumber = lineNumber;
    this.rawLine = rawLine;
  }
}

/** Thrown when a sub-file cannot be resolved */
export class LDrawResolveError extends LDrawError {
  readonly referencedBy: string;
  readonly missingFile: string;

  constructor(referencedBy: string, missingFile: string) {
    super(`Cannot resolve "${missingFile}" (referenced from "${referencedBy}")`);
    this.name = "LDrawResolveError";
    this.referencedBy = referencedBy;
    this.missingFile = missingFile;
  }
}

/** Thrown when the recursion depth limit is exceeded */
export class LDrawDepthError extends LDrawError {
  readonly depth: number;
  readonly file: string;

  constructor(file: string, depth: number) {
    super(`Max recursion depth (${depth}) exceeded while resolving "${file}"`);
    this.name = "LDrawDepthError";
    this.depth = depth;
    this.file = file;
  }
}

/** Non-fatal warning collected during parsing */
export interface LDrawWarning {
  type: "missing_file" | "unknown_color" | "malformed_line" | "texmap_syntax";
  fileName: string;
  lineNumber?: number;
  message: string;
}

/** Result carrying both a value and any non-fatal warnings */
export interface ParseResult<T> {
  value: T;
  warnings: LDrawWarning[];
}
