// A diagnostic carries a source span and a message that names the fix.
// Spans are absolute character offsets into the source; line/column rendering
// is derived on demand via a newline-offset line map + binary search (the same
// model as the TypeScript scanner), so tokens and nodes stay (start, end) pairs.

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface DiagnosticRepair {
  readonly kind: "replace-class" | "remove-class" | "rewrite-node" | "use-primitive";
  readonly raw?: string | undefined;
  readonly suggestions: ReadonlyArray<string>;
  readonly explanation: string;
}

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly span: Span;
  readonly repair?: DiagnosticRepair | undefined;
}

/** Newline-offset line map. Build once per source, query with `lineColumn`. */
export const buildLineMap = (source: string): ReadonlyArray<number> => {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (
      code === 10 /* \n */ ||
      (code === 13 /* \r */ && source.charCodeAt(index + 1) !== 10) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      lineStarts.push(index + 1);
    }
  }
  return lineStarts;
};

/** 1-based line/column for an absolute offset, via binary search. */
export const lineColumn = (
  lineMap: ReadonlyArray<number>,
  offset: number,
): { readonly line: number; readonly column: number } => {
  let low = 0;
  let high = lineMap.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineMap[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - lineMap[low]! + 1 };
};

/** Build one formatter for a batch of diagnostics against the same source. */
export const createDiagnosticFormatter = (source: string): ((diagnostic: Diagnostic) => string) => {
  const lineMap = buildLineMap(source);
  return (diagnostic) => {
    const { line, column } = lineColumn(lineMap, diagnostic.span.start);
    return `line ${line}:${column} ${diagnostic.message}`;
  };
};

/** "line 12:8 unknown class ..." — the shape agents iterate on. */
export const formatDiagnostic = (source: string, diagnostic: Diagnostic): string =>
  createDiagnosticFormatter(source)(diagnostic);
