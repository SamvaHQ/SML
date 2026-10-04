import type { DocumentChange, EditorDocument, EmailRender } from "@samva/editor/host";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import type { EmailElementSelection } from "@samva/markup/render";

import { emailOutline, type EmailOutline } from "../chrome/email-outline";
import { DOCUMENT_SELECTION, type CheckItem, type EditorSelection } from "./types";

// ── Document derivation ──────────────────────────────────────────────────────
// Everything the editor computes FROM the document, in one pure pass. The store
// runs this inside the transitions that change the document (never in effects or
// render memos), so a single `set()` carries the doc and all its projections.

/** Every document-derived projection, produced together by {@link deriveDocumentState}. */
export interface DerivedDocument {
  /** The tree of the current render; null for a non-email document or an unbuilt entry. */
  readonly outline: EmailOutline | null;
  readonly sizeKb: number;
  /** Host findings for the build, plus the checks the editor derives from the render. */
  readonly checks: ReadonlyArray<CheckItem>;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const kilobytes = (bytes: number): number => Math.max(1, Math.round(bytes / 1024));

/** Payload size in KB (min 1), from whichever body the channel carries. */
export const documentSizeKb = (document: EditorDocument): number => {
  if (document.render === null) return 0;
  if (document.channel === "email") return kilobytes(byteLength(document.render.html));
  if (document.channel === "sms") return kilobytes(byteLength(document.render.text));
  return kilobytes(byteLength(JSON.stringify(document.render)));
};

/** Derive every document projection in one pass — outline, size, checks. */
export const deriveDocumentState = (
  document: EditorDocument,
  hostChecks: ReadonlyArray<CheckItem>,
): DerivedDocument => ({
  outline:
    document.channel === "email" && document.render !== null
      ? emailOutline(document.render.selections)
      : null,
  sizeKb: documentSizeKb(document),
  checks: documentChecks(document, hostChecks),
});

// ── Selection reconciliation ─────────────────────────────────────────────────

const sameOrigins = (left: EmailElementSelection, right: EmailElementSelection): boolean =>
  left.origins.length === right.origins.length &&
  left.origins.every((origin, index) => {
    const other = right.origins[index];
    return (
      other !== undefined &&
      other.fileName === origin.fileName &&
      other.lineNumber === origin.lineNumber &&
      other.columnNumber === origin.columnNumber
    );
  });

/** The same rendered element: same authoring, same tag, same iteration of it. */
const sameElement = (left: EmailElementSelection, right: EmailElementSelection): boolean =>
  left.tag === right.tag &&
  left.authored === right.authored &&
  left.occurrence === right.occurrence &&
  left.occurrences === right.occurrences &&
  sameOrigins(left, right);

/**
 * Rebind a selection to the document in front of it.
 *
 * A selection taken against the render it names stays as it is. One taken
 * against an earlier revision or another fixture is re-resolved only when the
 * same instance path still carries the same authoring, tag and iteration —
 * otherwise it is dropped to document scope rather than pointed at whatever now
 * occupies that path.
 */
export const resolveSelection = (
  selection: EditorSelection,
  document: EditorDocument | null,
  previous: EmailOutline | null,
): EditorSelection => {
  if (selection.kind !== "element") return selection;
  if (document === null || document.channel !== "email") return DOCUMENT_SELECTION;
  const { render, fixture } = document;
  if (render === null || fixture === null) return DOCUMENT_SELECTION;
  const next = render.selections.find(
    (candidate) => candidate.instancePath === selection.instancePath,
  );
  if (next === undefined) return DOCUMENT_SELECTION;
  if (selection.revision === render.revision && selection.fixture === fixture) return selection;
  const before = previous?.index.get(selection.instancePath);
  if (before === undefined || !sameElement(before, next)) return DOCUMENT_SELECTION;
  return {
    kind: "element",
    instancePath: selection.instancePath,
    revision: render.revision,
    fixture,
  };
};

// ── Document merging ─────────────────────────────────────────────────────────

/**
 * Apply a host change to the current document.
 *
 * The host owns every field but the authored TSX: a change replaces the
 * revision and the whole channel payload it carries. `authoredSource` is taken
 * only when the editor holds no newer unsaved edit, so a render arriving for an
 * earlier save never rewinds what the source rail is showing.
 */
export const withDocumentChange = (
  document: EditorDocument,
  change: DocumentChange,
  pendingAuthoredSource: string | null,
): EditorDocument => {
  const authoredSource =
    change.authoredSource !== undefined &&
    (pendingAuthoredSource === null || pendingAuthoredSource === change.authoredSource)
      ? change.authoredSource
      : document.origin.authoredSource;
  const origin = { ...document.origin, authoredSource };
  if (change.channel !== document.channel) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Host contract boundary (not Effect domain): a change for a different channel than the open document is a host defect that must fail loudly rather than half-apply.
    throw new Error(`Host sent a ${change.channel} change for a ${document.channel} document`);
  }
  return {
    ...document,
    rev: change.rev,
    origin,
    fixtures: change.fixtures,
    fixture: change.fixture,
    preview: change.preview,
    render: change.render,
    diagnostics: change.diagnostics,
    ...(change.channel === "email" ? { incompatibilities: change.incompatibilities } : {}),
  } as EditorDocument;
};

// ── Checks ───────────────────────────────────────────────────────────────────

const GMAIL_CLIP_BYTES = 102 * 1024;

const severityOf = (diagnostic: EmailDiagnostic): CheckItem["severity"] =>
  diagnostic.severity === "error" ? "error" : diagnostic.severity === "warning" ? "warn" : "info";

const diagnosticTitle = (code: string): string => {
  if (code === "caniemail/system-ui-ui-serif-ui-sans-serif-ui-rounded-ui-monospace")
    return "System fonts";
  if (code === "caniemail/media") return "Media queries";
  if (code === "caniemail/color-scheme-meta-tag") return "Color scheme metadata";
  return code.startsWith("caniemail/")
    ? code
        .slice("caniemail/".length)
        .replace(/-property$/, "")
        .replace(/-attribute$/, " attribute")
        .replace(/-element$/, " element")
    : code.replaceAll("-", " ");
};

/** Keep distinct client limitations, but combine identical evidence across fixtures. */
const diagnosticChecks = (
  diagnostics: ReadonlyArray<EmailDiagnostic>,
  group: string,
): ReadonlyArray<CheckItem> => {
  const groups = new Map<string, Map<string, EmailDiagnostic>>();
  for (const diagnostic of diagnostics) {
    const variants = groups.get(diagnostic.code) ?? new Map<string, EmailDiagnostic>();
    const key = JSON.stringify([
      diagnostic.severity,
      diagnostic.compatibility?.assessment,
      diagnostic.compatibility?.title,
      diagnostic.message,
      [...(diagnostic.clients ?? [])].sort(),
      diagnostic.notes,
      diagnostic.provenance,
    ]);
    const previous = variants.get(key);
    const occurrences = new Map<string, EmailDiagnostic["origins"]>();
    for (const item of previous === undefined ? [diagnostic] : [previous, diagnostic]) {
      for (const origins of item.occurrences ?? [item.origins]) {
        if (origins.length > 0) occurrences.set(JSON.stringify(origins), origins);
      }
    }
    variants.set(key, {
      ...diagnostic,
      origins: previous?.origins ?? diagnostic.origins,
      fixtures: [
        ...new Set([...(previous?.fixtures ?? []), ...(diagnostic.fixtures ?? [])]),
      ].sort(),
      occurrences: [...occurrences.values()],
    });
    groups.set(diagnostic.code, variants);
  }
  return [...groups].map(([code, variants]) =>
    projectDiagnosticCheck(`${group}:${code}`, [...variants.values()]),
  );
};

/** Project nonempty evidence after grouping or filtering without retaining stale severity. */
export const projectDiagnosticCheck = (
  id: string,
  diagnostics: ReadonlyArray<EmailDiagnostic>,
): CheckItem => {
  const assessmentRank = (item: EmailDiagnostic) =>
    item.compatibility?.assessment === "unverified"
      ? 0
      : item.compatibility?.assessment === "degradation"
        ? 1
        : 2;
  const evidence = [...diagnostics].sort((a, b) => assessmentRank(a) - assessmentRank(b));
  const worst =
    evidence.find((item) => item.severity === "error") ??
    evidence.find((item) => item.severity === "warning") ??
    evidence[0]!;
  const fixtures = new Set(evidence.flatMap((item) => item.fixtures ?? []));
  const clients = new Set(evidence.flatMap((item) => item.clients ?? []));
  return {
    id,
    severity: severityOf(worst),
    label: worst.compatibility?.title ?? diagnosticTitle(worst.code),
    detail: [
      `${evidence.length} finding${evidence.length === 1 ? "" : "s"}`,
      ...(clients.size === 0 ? [] : [`${clients.size} client${clients.size === 1 ? "" : "s"}`]),
      ...(fixtures.size === 0 ? [] : [`${fixtures.size} fixture${fixtures.size === 1 ? "" : "s"}`]),
    ].join(" · "),
    diagnostics: evidence,
  };
};

const clippingCheck = (render: EmailRender): CheckItem => {
  const bytes = byteLength(render.html);
  return bytes <= GMAIL_CLIP_BYTES
    ? {
        id: "size:gmail-clip",
        severity: "ok",
        label: "Gmail clipping",
        detail: `HTML is ${Math.ceil(bytes / 1024)} KB, under Gmail's 102 KB clipping threshold.`,
      }
    : {
        id: "size:gmail-clip",
        severity: "warn",
        label: "Gmail clipping risk",
        detail: `HTML is ${Math.ceil(bytes / 1024)} KB, above Gmail's 102 KB clipping threshold.`,
      };
};

/** A build with no render and nothing to say about it is still a failure the editor must show. */
const UNBUILT: CheckItem = {
  id: "build:no-render",
  severity: "error",
  label: "No render",
  detail: "The template entry did not produce a render at this revision.",
};

/** Every check for one document: the build's findings, the render's own checks, then the host's. */
export const documentChecks = (
  document: EditorDocument,
  hostChecks: ReadonlyArray<CheckItem>,
): ReadonlyArray<CheckItem> => {
  const findings = [
    ...diagnosticChecks(document.diagnostics, "diagnostic"),
    ...(document.channel === "email" ? diagnosticChecks(document.incompatibilities, "compat") : []),
  ];
  if (document.render === null)
    return [...(findings.length === 0 ? [UNBUILT] : findings), ...hostChecks];
  return document.channel === "email"
    ? [...findings, clippingCheck(document.render), ...hostChecks]
    : [...findings, ...hostChecks];
};

/** Checks partitioned by tier for the badge (error + warn) and the panel groups. */
export interface ChecksSummary {
  /** Error + warn, in that priority — the badge-counted, "needs attention" set. */
  readonly actionable: ReadonlyArray<CheckItem>;
  /** Graceful-degradation notes, shown muted under their own panel group. */
  readonly info: ReadonlyArray<CheckItem>;
  /** Passing notes (e.g. under the Gmail clip threshold). */
  readonly ok: ReadonlyArray<CheckItem>;
  readonly errorCount: number;
  readonly warnCount: number;
  /** What the statusbar badge shows: error + warn only, never info/ok. */
  readonly badgeCount: number;
}

/**
 * Partition checks for display. `error` sorts ahead of `warn` in `actionable` so
 * the panel leads with the most severe; `info` and `ok` are split off and never
 * counted toward the badge.
 */
export const summarizeChecks = (checks: ReadonlyArray<CheckItem>): ChecksSummary => {
  const errors: CheckItem[] = [];
  const warns: CheckItem[] = [];
  const info: CheckItem[] = [];
  const ok: CheckItem[] = [];
  for (const check of checks) {
    if (check.severity === "error") errors.push(check);
    else if (check.severity === "warn") warns.push(check);
    else if (check.severity === "info") info.push(check);
    else ok.push(check);
  }
  return {
    actionable: [...errors, ...warns],
    info,
    ok,
    errorCount: errors.length,
    warnCount: warns.length,
    badgeCount: errors.length + warns.length,
  };
};
