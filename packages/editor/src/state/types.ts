import type { RevisionToken } from "@samva/editor/host";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";

/**
 * Check tiers, most to least severe. The statusbar badge counts `error` + `warn`
 * only; `info` (graceful degradation) and `ok` (a passing note) never alarm.
 *  - `error` — the entry did not build, or a finding the compiler refuses.
 *  - `warn`  — an applicable or unresolved client limitation needs attention.
 *  - `info`  — a limitation does not apply to these values, a fallback is supplied,
 *              or coverage is unknown; details retain the evidence and caveats.
 *  - `ok`    — a check that passed, surfaced as reassurance.
 */
export type CheckSeverity = "ok" | "info" | "warn" | "error";

/** One lint result shown in the statusbar summary and the document inspector. */
export interface CheckItem {
  readonly id: string;
  readonly severity: CheckSeverity;
  readonly label: string;
  readonly detail: string;
  /** Distinct limitations with merged fixture and occurrence evidence. */
  readonly diagnostics?: ReadonlyArray<EmailDiagnostic>;
}

/**
 * What the rails and canvas are pointed at.
 *
 * An element selection names one rendered instance, and it is only meaningful
 * against the render it was taken from: `revision` and `fixture` pin it there,
 * so a selection the document has moved past is recognized as stale rather than
 * silently applied to whatever now sits at that path.
 */
export type EditorSelection =
  | { readonly kind: "document" }
  | { readonly kind: "envelope" }
  | {
      readonly kind: "element";
      readonly instancePath: string;
      readonly revision: RevisionToken;
      readonly fixture: string;
    };

/** The document scope — theme, checks, and everything not bound to one element. */
export const DOCUMENT_SELECTION: EditorSelection = { kind: "document" };
/** The envelope scope — sender defaults, subject, and preheader. */
export const ENVELOPE_SELECTION: EditorSelection = { kind: "envelope" };
