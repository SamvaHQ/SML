/**
 * The source payload a JSX transform may attach to an element. The transform may omit any field
 * for synthetic calls; only a complete payload can identify a source origin safely.
 */
export interface JsxSource {
  readonly fileName?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly columnNumber?: number | undefined;
}

/** A complete, normalized source origin for a JSX element. */
export interface JsxSourceLocation {
  readonly fileName: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

/** The JSX prop that carries a {@link JsxSource} to the email JSX runtime. */
export const JSX_SOURCE_LOCATION_PROP = "__samva_source_location" as const;

/** Normalize the optional payload a JSX transform attaches. */
export const completeJsxSourceLocation = (
  source: JsxSource | null | undefined,
): JsxSourceLocation | undefined => {
  if (
    source?.fileName === undefined ||
    source.lineNumber === undefined ||
    source.columnNumber === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    fileName: source.fileName,
    lineNumber: source.lineNumber,
    columnNumber: source.columnNumber,
  });
};
