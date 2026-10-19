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

/**
 * A numbered point on the email an author drops in pin mode, for the host's assistant to attach
 * to the next message. It names one rendered instance the way a selection does, pinned to the
 * render and fixture it was dropped on, plus what the author sees: the element's label and, when
 * the template wrote it, where.
 */
export interface EditorPin {
  /** Stable for the pin's lifetime; numbers move when an earlier pin is removed. */
  readonly id: string;
  /** 1-based position in the tray, which is the number drawn on the email. */
  readonly number: number;
  readonly instancePath: string;
  readonly revision: RevisionToken;
  readonly fixture: string;
  /** The rendered tag, such as `h1` or `a`. */
  readonly tag: string;
  /** What the author sees on the pin's chip, such as "Button" or "td 2 of 3". */
  readonly label: string;
  /** Where the template wrote the element, when it did. */
  readonly origin: {
    readonly fileName: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  } | null;
  /** The author's note on this pin; empty until they write one. */
  readonly note: string;
}
