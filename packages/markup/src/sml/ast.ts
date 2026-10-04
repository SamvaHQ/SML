import { parse } from "@babel/parser";

import { buildLineMap, lineColumn } from "../diagnostic-model";
import { isObject } from "../internal/guards";

// A thin, typed view over the Babel AST. The static profile reads source; it never evaluates it,
// so every access here is a structural question about a node ("is this an identifier?"), never a
// call into the code being read.

/** A Babel node, addressed structurally. */
export interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  isObject(value) &&
  typeof value.type === "string" &&
  typeof value.start === "number" &&
  typeof value.end === "number";

/** The child node under `key`, or `undefined`. */
export const child = (node: Node, key: string): Node | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};

/** The child nodes under `key`; array holes and non-nodes are dropped. */
export const children = (node: Node, key: string): readonly Node[] => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};

export const text = (node: Node, key: string): string | undefined => {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
};

/** The name a property key spells: an identifier or a string literal. */
export const keyName = (key: Node | undefined): string | undefined => {
  if (key === undefined) return undefined;
  if (key.type === "Identifier") return text(key, "name");
  if (key.type === "StringLiteral") return text(key, "value");
  return undefined;
};

/** Strip wrappers that carry no runtime meaning: parentheses and TypeScript assertions. */
export const unwrap = (node: Node): Node => {
  let current = node;
  for (;;) {
    if (
      current.type === "ParenthesizedExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TypeCastExpression"
    ) {
      const inner = child(current, "expression");
      if (inner === undefined) return current;
      current = inner;
      continue;
    }
    return current;
  }
};

/** One parsed source file with its line map. */
export interface ParsedSource {
  readonly path: string;
  readonly source: string;
  readonly program: Node;
  readonly position: (offset: number) => { readonly line: number; readonly column: number };
}

export class SourceSyntaxError extends Error {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  constructor(path: string, message: string, line: number, column: number) {
    super(message);
    this.name = "SourceSyntaxError";
    this.path = path;
    this.line = line;
    this.column = column;
  }
}

/** Parse a TSX/TS project file. Throws `SourceSyntaxError` on a syntax error. */
export const parseSource = (path: string, source: string): ParsedSource => {
  const lines = buildLineMap(source);
  const position = (offset: number) => lineColumn(lines, offset);
  let program: unknown;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Babel throws on a syntax error; the compiler reports it as a located diagnostic.
  try {
    program = parse(source, {
      plugins: ["typescript", "jsx"],
      sourceType: "module",
    }).program;
  } catch (error) {
    const at = isObject(error) && isObject(error.loc) ? error.loc : undefined;
    const line = typeof at?.line === "number" ? at.line : 1;
    const column = typeof at?.column === "number" ? at.column + 1 : 1;
    const message = error instanceof Error ? error.message.replace(/\s*\(\d+:\d+\)\s*$/, "") : "";
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Re-raised as the typed syntax error the project loader converts to a diagnostic.
    throw new SourceSyntaxError(path, message, line, column);
  }
  if (!isNode(program)) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Babel always returns a Program node; this guards the structural read.
    throw new SourceSyntaxError(path, "The file did not parse to a program.", 1, 1);
  }
  return { path, source, program, position };
};
