import {
  DIAGNOSTIC_CODES,
  type DiagnosticCode,
  type DiagnosticCodeSpec,
} from "../diagnostic-codes";
import type { TemplateDiagnostic } from "../email/diagnostics";
import type { JsxSourceLocation } from "../source-locations";
import type { ParsedSource } from "./ast";

/** Collects the findings of one compile. Every finding carries a code, a location and a fix. */
export class Findings {
  readonly items: TemplateDiagnostic[] = [];

  /** The `file:line:col` of a node. */
  locate(source: ParsedSource, node: { readonly start: number }): JsxSourceLocation {
    const at = source.position(node.start);
    return { fileName: source.path, lineNumber: at.line, columnNumber: at.column };
  }

  add(
    source: ParsedSource,
    node: { readonly start: number },
    code: DiagnosticCode,
    message: string,
    fix?: string,
    severity: TemplateDiagnostic["severity"] = "error",
  ): void {
    this.report({
      code,
      severity,
      message,
      ...(fix === undefined ? {} : { fix }),
      origins: [this.locate(source, node)],
    });
  }

  /** Attach the registry recipe wherever a known template finding enters the collection. */
  report(diagnostic: TemplateDiagnostic & { readonly code: DiagnosticCode }): void {
    const spec: DiagnosticCodeSpec = DIAGNOSTIC_CODES[diagnostic.code];
    this.items.push({
      ...diagnostic,
      ...(spec.upgrade === undefined ? {} : { upgrade: spec.upgrade }),
    });
  }

  get blocking(): boolean {
    return this.items.some((item) => item.severity === "error");
  }
}
