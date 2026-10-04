import { caniemail, rawData } from "caniemail";

// caniemail does not export its client-id union, so the matrix states the ids it
// accepts and the call site is checked against the option type.
type CaniemailClient = Parameters<typeof caniemail>[0]["clients"][number];

import type { EmittedPosition } from "../preview";
import type { JsxSourceLocation } from "../source-locations";
import { assessCompatibility } from "./compatibility-assessment";
import { compatibilityContext } from "./compatibility-context";
import type { EmailCompatibilityAssessment, EmailDiagnostic } from "./diagnostics";

// Compatibility findings come from caniemail's rules applied to the document the
// recipient will actually receive — the emitted HTML and the retained head CSS —
// not to the authoring source. Authored source cannot answer "does Outlook drop
// this", because what Outlook sees is what the compiler produced.
//
// The rules engine is the `caniemail` package, pinned exactly, so the data
// revision is pinned by the lockfile rather than by a hand-run refresh. Its
// bundled revision travels on every finding, because a compatibility claim is
// only meaningful next to the date it was true.

/** One client this compiler makes claims about. */
export interface EmailClientTarget {
  readonly id: CaniemailClient;
  readonly label: string;
}

/**
 * The pinned matrix. Every finding is reported per client, and a client absent
 * from this list is a client Samva makes no claim about.
 */
export const EMAIL_CLIENT_MATRIX: readonly EmailClientTarget[] = [
  { id: "gmail.desktop-webmail", label: "Gmail web" },
  { id: "gmail.ios", label: "Gmail iOS" },
  { id: "gmail.android", label: "Gmail Android" },
  { id: "apple-mail.macos", label: "Apple Mail macOS" },
  { id: "apple-mail.ios", label: "Apple Mail iOS" },
  { id: "yahoo.desktop-webmail", label: "Yahoo web" },
  { id: "outlook.outlook-com", label: "Outlook web and new Windows" },
  { id: "outlook.windows", label: "Outlook classic Windows" },
];

const LABELS = new Map(EMAIL_CLIENT_MATRIX.map((target) => [target.id, target.label]));

export interface CompatibilityProvenance {
  /** The exact rules package a finding came from. */
  readonly rules: string;
  readonly apiVersion: string;
  /** The day caniemail last changed the data this build was checked against. */
  readonly lastUpdate: string;
}

export const COMPATIBILITY_PROVENANCE: CompatibilityProvenance = {
  rules: "caniemail@2.0.2",
  apiVersion: rawData.api_version,
  lastUpdate: rawData.last_update_date,
};

/**
 * The constructs whose loss actually breaks a message: the recipient reads
 * something different, in a different order, follows a link that does not work,
 * or sees a layout that has collapsed. A target client dropping one of these
 * blocks publication.
 *
 * The list is deliberately short and enumerated, because the contract is to
 * block *known* failures. Nonessential differences require an assessment of
 * emitted values: a concrete risk warns, expected differences and unverified
 * behavior remain compatibility observations.
 */
export const ESSENTIAL_CONSTRUCTS: ReadonlySet<string> = new Set([
  // Structure. Losing one of these collapses the document's shape.
  "<table> element",
  "<div> element",
  "<p> element",
  "<span> element",
  "<ul>, <ol> and <dl>",
  "<h1> to <h6> elements",
  "HTML5 doctype",
  // Table geometry. Columns stop being columns without these.
  "width attribute",
  "height attribute",
  "align attribute",
  "valign attribute",
  // Content the recipient would otherwise never see, or would wrongly see: a
  // dropped image is missing content, and a dropped `display` un-hides the
  // preheader into the top of the message.
  "<img> element",
  "display",
  // Links that do not go anywhere.
  "mailto: links",
  "Local anchors",
]);

const KNOWN_TITLES: ReadonlySet<string> = new Set(rawData.data.map((feature) => feature.title));

export interface CompatibilityInput {
  /** The document the recipient receives. */
  readonly html: string;
  /** The declared fixture checked by this invocation. */
  readonly fixture?: string | undefined;
  /** Retained head rules, when they are not already inside the HTML. */
  readonly css?: string | undefined;
  /** Emitted-offset ranges with the origins of the node that produced them. */
  readonly positions?: readonly EmittedPosition[] | undefined;
  readonly clients?: readonly EmailClientTarget[] | undefined;
}

/** The innermost recorded node containing an offset, so a finding names its element. */
const originsAt = (
  positions: readonly EmittedPosition[],
  offset: number,
): readonly JsxSourceLocation[] => {
  let best: EmittedPosition | undefined;
  for (const position of positions) {
    if (offset < position.start || offset >= position.end) continue;
    if (best === undefined || position.end - position.start < best.end - best.start)
      best = position;
  }
  return best?.origins ?? [];
};

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

interface RawIssue {
  readonly title: string;
  readonly support: string;
  readonly notes: readonly string[];
}

/**
 * Check the emitted document against the pinned matrix.
 *
 * Findings are grouped by construct rather than repeated per client, so one
 * unsupported property is one diagnostic naming every client that drops it.
 */
export const checkEmailCompatibility = (input: CompatibilityInput): readonly EmailDiagnostic[] => {
  const targets = input.clients ?? EMAIL_CLIENT_MATRIX;
  const context = compatibilityContext(input.html, input.css);
  const targetClients = targets.map((target) => target.id);
  // The pinned engine replaces its standalone CSS input when HTML is supplied.
  // Check both documents explicitly so retained external rules are not skipped.
  const reports = [
    caniemail({ clients: targetClients, html: input.html }),
    ...(input.css === undefined ? [] : [caniemail({ clients: targetClients, css: input.css })]),
  ];
  const grouped = new Map<
    string,
    {
      title: string;
      support: string;
      clients: Set<string>;
      notes: Set<string>;
      compatibility: EmailCompatibilityAssessment;
      explanation: string;
      blocking: boolean;
      offsets: readonly number[];
    }
  >();
  for (const bucket of reports.flatMap((report) => [
    report.issues.errors,
    report.issues.warnings,
  ])) {
    for (const [client, issues] of bucket) {
      const label = LABELS.get(client) ?? client;
      for (const raw of issues as readonly RawIssue[]) {
        const hiddenContentFailure =
          client === "outlook.windows" &&
          raw.support === "partial" &&
          (raw.title === "display" || raw.title === "display:none") &&
          context.hiddenContentOffsets.length > 0;
        const blocking =
          hiddenContentFailure ||
          (raw.support !== "partial" && ESSENTIAL_CONSTRUCTS.has(raw.title));
        const { explanation, ...compatibility } = assessCompatibility(
          raw.title,
          client,
          raw.support,
          context,
          blocking,
        );
        const key = JSON.stringify([raw.title, raw.support, compatibility, explanation]);
        const offsets = hiddenContentFailure
          ? context.hiddenContentOffsets
          : context.offsets(raw.title);
        const entry = grouped.get(key);
        if (entry === undefined)
          grouped.set(key, {
            title: raw.title,
            support: raw.support,
            clients: new Set([label]),
            notes: new Set(raw.notes),
            explanation,
            compatibility,
            blocking,
            offsets,
          });
        else {
          entry.clients.add(label);
          for (const note of raw.notes) entry.notes.add(note);
        }
      }
    }
  }

  const findings: EmailDiagnostic[] = [];
  for (const entry of grouped.values()) {
    const severity = entry.blocking
      ? "error"
      : entry.compatibility.assessment === "risk"
        ? "warning"
        : "info";
    const occurrences = entry.offsets
      .map((offset) => originsAt(input.positions ?? [], offset))
      .filter((origins) => origins.length > 0);
    const clients = [...entry.clients].sort();
    const dropped =
      entry.support === "partial"
        ? clients.length === 1
          ? "partially supports"
          : "partially support"
        : clients.length === 1
          ? "does not support"
          : "do not support";
    findings.push({
      code: `caniemail/${slug(entry.title)}`,
      severity,
      message: `${clients.join(", ")} ${dropped} ${entry.title}. ${entry.explanation}`,
      compatibility: entry.compatibility,
      origins: occurrences[0] ?? [],
      ...(occurrences.length === 0 ? {} : { occurrences }),
      ...(input.fixture === undefined ? {} : { fixtures: [input.fixture] }),
      clients,
      ...(entry.notes.size === 0 ? {} : { notes: [...entry.notes].join(" ") }),
      provenance: `${COMPATIBILITY_PROVENANCE.rules} (caniemail data ${COMPATIBILITY_PROVENANCE.apiVersion}, updated ${COMPATIBILITY_PROVENANCE.lastUpdate})`,
    });
  }
  return findings.sort((left, right) => left.code.localeCompare(right.code));
};

/**
 * Constructs the pinned data says nothing about for a target client. These are
 * reported so "we did not check that" is never mistaken for "that works".
 */
export const unknownCoverage = (titles: Iterable<string>): readonly EmailDiagnostic[] =>
  [...titles]
    .filter((title) => !KNOWN_TITLES.has(title))
    .sort()
    .map((title) => ({
      code: "caniemail/unknown-coverage",
      severity: "info" as const,
      message: `The pinned rules say nothing about ${title}, so no client claim is made about it. Verify it in a real client before relying on it.`,
      origins: [],
      provenance: `${COMPATIBILITY_PROVENANCE.rules} (caniemail data ${COMPATIBILITY_PROVENANCE.apiVersion}, updated ${COMPATIBILITY_PROVENANCE.lastUpdate})`,
    }));

/** A publication carrying one of these is refused; the message would arrive broken. */
export const hasBlockingCompatibility = (findings: readonly EmailDiagnostic[]): boolean =>
  findings.some((finding) => finding.severity === "error");
