import { TaggedError } from "better-result";

import type { JsxSourceLocation } from "../source-locations";

// Every finding the email lane produces — compiler, plain-text derivation and
// compatibility checks — is one of these. A finding without a source location
// is not actionable, so origins travel with it from the authoring element out
// through each enclosing component call site.

export type EmailDiagnosticSeverity = "error" | "warning" | "info";

/** What the emitted document establishes beyond the client feature matrix. */
export interface EmailCompatibilityAssessment {
  readonly assessment: "risk" | "degradation" | "unverified" | "not-applicable";
  /** A short description of the consequence or the remaining verification. */
  readonly title: string;
}

export interface EmailDiagnostic {
  /** Stable identifier, e.g. `unsupported-element` or `caniemail/css-border-radius`. */
  readonly code: string;
  readonly severity: EmailDiagnosticSeverity;
  /** States what is wrong and what to write instead. */
  readonly message: string;
  /** Innermost authoring element first, then each enclosing component call site. */
  readonly origins: ReadonlyArray<JsxSourceLocation>;
  /** Target clients a compatibility finding applies to. */
  readonly clients?: ReadonlyArray<string> | undefined;
  /** Partial-support notes and other caveats a client matrix carries. */
  readonly notes?: string | undefined;
  /** Which pinned rule data produced the finding. */
  readonly provenance?: string | undefined;
  /** Declared fixtures whose rendered output produced this finding. */
  readonly fixtures?: ReadonlyArray<string> | undefined;
  /** Source chains for every located emitted occurrence; origins identifies the first. */
  readonly occurrences?: ReadonlyArray<ReadonlyArray<JsxSourceLocation>> | undefined;
  /** Compatibility observations are not automatically defects or proof of client rendering. */
  readonly compatibility?: EmailCompatibilityAssessment | undefined;
}

/** A finding of the static compiler: an `EmailDiagnostic` plus the change that resolves it. */
export interface TemplateDiagnostic extends EmailDiagnostic {
  readonly fix?: string | undefined;
  /** Agent instructions for migrating a template made incompatible by a compiler change. */
  readonly upgrade?: string | undefined;
}

export class EmailCompileError extends TaggedError("EmailCompileError")<{
  readonly diagnostics: ReadonlyArray<EmailDiagnostic>;
  readonly message: string;
}> {
  constructor(args: { readonly diagnostics: ReadonlyArray<EmailDiagnostic> }) {
    super({
      diagnostics: args.diagnostics,
      message: args.diagnostics.map(formatEmailDiagnostic).join("\n"),
    });
  }
}

/** `emails/welcome.tsx:12:3 unsupported-element: …` — the shape agents iterate on. */
export const formatEmailDiagnostic = (diagnostic: TemplateDiagnostic): string => {
  const origin = diagnostic.origins[0];
  const at =
    origin === undefined
      ? "<unknown source>"
      : `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`;
  const head = `${at} ${diagnostic.code}: ${diagnostic.message}`;
  const fixed = diagnostic.fix === undefined ? head : `${head}\n  Fix: ${diagnostic.fix}`;
  return diagnostic.upgrade === undefined ? fixed : `${fixed}\n  Upgrade: ${diagnostic.upgrade}`;
};

/** True when a set of findings must stop the compile or refuse a publication. */
export const hasBlockingDiagnostic = (diagnostics: readonly EmailDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");
