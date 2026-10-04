import { describe, expect, it } from "@effect/vitest";
import type {
  EditableEmailDocument,
  EditorDocument,
  EmailDocumentChange,
  EmailRender,
  SmsDocumentChange,
} from "@samva/editor/host";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import type { JsxSourceLocation } from "@samva/markup/edit";
import type { EmailElementSelection } from "@samva/markup/render";

import { emailOutline } from "../src/chrome/email-outline";
import {
  deriveDocumentState,
  documentChecks,
  documentSizeKb,
  projectDiagnosticCheck,
  resolveSelection,
  summarizeChecks,
  withDocumentChange,
} from "../src/state/derive";
import { DOCUMENT_SELECTION, ENVELOPE_SELECTION, type CheckItem } from "../src/state/types";

const at = (lineNumber: number, columnNumber: number): JsxSourceLocation => ({
  fileName: "src/Welcome.tsx",
  lineNumber,
  columnNumber,
});

const parentOf = (instancePath: string): string | undefined => {
  const cut = instancePath.lastIndexOf(".");
  return cut === -1 ? undefined : instancePath.slice(0, cut);
};

const element = (
  instancePath: string,
  tag: string,
  overrides: Partial<EmailElementSelection> = {},
): EmailElementSelection => {
  const parentPath = parentOf(instancePath);
  return {
    instancePath,
    tag,
    origins: [at(20, 9)],
    authored: true,
    occurrence: 1,
    occurrences: 1,
    ...(parentPath === undefined ? {} : { parentPath }),
    start: 0,
    end: 1,
    ...overrides,
  };
};

const SELECTIONS: ReadonlyArray<EmailElementSelection> = [
  element("0", "body", { authored: false, origins: [at(17, 5)] }),
  element("0.0", "div", { origins: [at(18, 7), at(17, 5)] }),
  element("0.0.0", "h1", { origins: [at(20, 9), at(18, 7)] }),
  element("0.0.1", "p", { origins: [at(21, 9), at(18, 7)] }),
];

const RENDER_HTML =
  '<body data-samva-instance="0"><div data-samva-instance="0.0">' +
  '<h1 data-samva-instance="0.0.0">Hi</h1><p data-samva-instance="0.0.1">Body</p></div></body>';

const renderAt = (
  revision: string,
  selections: ReadonlyArray<EmailElementSelection> = SELECTIONS,
): EmailRender => ({
  revision,
  subject: "Welcome",
  preheader: "Freshly roasted.",
  html: RENDER_HTML,
  text: "Welcome",
  selections,
});

const emailDocument = (overrides: Partial<EditableEmailDocument> = {}): EditableEmailDocument => ({
  id: "tpl_1",
  name: "Welcome",
  rev: "rev_1",
  origin: {
    kind: "tsx",
    file: "src/Welcome.tsx",
    authoredSource: "export default () => <Email />",
  },
  access: { kind: "editable" },
  variables: [],
  metadata: {},
  channel: "email",
  preview: { status: "current" },
  fixtures: ["welcome", "returning"],
  fixture: "welcome",
  render: renderAt("rev_1"),
  diagnostics: [],
  incompatibilities: [],
  ...overrides,
});

const smsDocument = (text = "Hello", overrides: Partial<EditorDocument> = {}): EditorDocument =>
  ({
    id: "tpl_2",
    name: "Code",
    rev: "rev_1",
    origin: { kind: "tsx", file: "src/Code.tsx", authoredSource: "export default () => null" },
    access: { kind: "editable" },
    variables: [],
    metadata: {},
    channel: "sms",
    preview: { status: "current" },
    fixtures: ["default"],
    fixture: "default",
    render: { revision: "rev_1", text },
    diagnostics: [],
    ...overrides,
  }) as EditorDocument;

const whatsappDocument = (overrides: Partial<EditorDocument> = {}): EditorDocument =>
  ({
    ...smsDocument(),
    channel: "whatsapp",
    render: {
      revision: "rev_1",
      language: "en_US",
      category: "utility",
      body: "Hello",
      buttons: [],
    },
    ...overrides,
  }) as EditorDocument;

const UNBUILT = emailDocument({ fixtures: [], fixture: null, render: null });

const HOST_CHECK: CheckItem = {
  id: "host:1",
  severity: "info",
  label: "Host",
  detail: "host-supplied",
};

describe("deriveDocumentState", () => {
  it("derives every projection for a built email in one pass", () => {
    const derived = deriveDocumentState(emailDocument(), []);

    // The host owns render truth; the editor derives from the render, never a compile.
    expect(derived.outline?.roots.map((root) => root.instancePath)).toStrictEqual(["0"]);
    expect(derived.sizeKb).toBe(1);
    expect(derived.checks.find((check) => check.id === "size:gmail-clip")?.severity).toBe("ok");
  });

  it("has no outline and no size for an entry that did not build", () => {
    const derived = deriveDocumentState(UNBUILT, []);

    expect(derived.outline).toBeNull();
    expect(derived.sizeKb).toBe(0);
    expect(derived.checks.map((check) => check.id)).toStrictEqual(["build:no-render"]);
  });

  it("sizes the markup channels from their render and leaves the outline to email", () => {
    const derived = deriveDocumentState(smsDocument(), []);

    expect(derived.outline).toBeNull();
    expect(derived.sizeKb).toBe(1);
    expect(derived.checks.map((check) => check.id)).toStrictEqual([]);
  });

  it("appends host checks after the derived ones", () => {
    const derived = deriveDocumentState(emailDocument(), [HOST_CHECK]);
    expect(derived.checks.at(-1)).toStrictEqual(HOST_CHECK);
  });
});

describe("documentSizeKb", () => {
  it("measures the rendered HTML for email and the rendered body for the markup channels", () => {
    expect(documentSizeKb(emailDocument())).toBe(1);
    expect(documentSizeKb(UNBUILT)).toBe(0);
    expect(documentSizeKb(smsDocument("x".repeat(3 * 1024)))).toBe(3);
    expect(documentSizeKb(whatsappDocument())).toBe(1);
  });

  it("is zero for a markup document that did not build", () => {
    expect(documentSizeKb(smsDocument("", { render: null }))).toBe(0);
    expect(documentSizeKb(whatsappDocument({ render: null }))).toBe(0);
  });
});

describe("resolveSelection", () => {
  const outline = emailOutline(SELECTIONS);
  const selected = {
    kind: "element",
    instancePath: "0.0.0",
    revision: "rev_1",
    fixture: "welcome",
  } as const;

  it("passes the document and envelope scopes through", () => {
    expect(resolveSelection(DOCUMENT_SELECTION, emailDocument(), outline)).toBe(DOCUMENT_SELECTION);
    expect(resolveSelection(ENVELOPE_SELECTION, emailDocument(), outline)).toBe(ENVELOPE_SELECTION);
  });

  it("keeps a selection taken against the render it names", () => {
    expect(resolveSelection(selected, emailDocument(), outline)).toBe(selected);
  });

  it("drops to document scope when the instance path is gone from the render", () => {
    const shrunk = emailDocument({ render: renderAt("rev_2", SELECTIONS.slice(0, 2)) });
    expect(resolveSelection(selected, shrunk, outline)).toStrictEqual(DOCUMENT_SELECTION);
  });

  it("rebinds to a later revision when the same path still carries the same authoring", () => {
    const rebuilt = emailDocument({ rev: "rev_2", render: renderAt("rev_2") });
    expect(resolveSelection(selected, rebuilt, outline)).toStrictEqual({
      kind: "element",
      instancePath: "0.0.0",
      revision: "rev_2",
      fixture: "welcome",
    });
  });

  it("rebinds across a fixture switch, which re-renders the same revision", () => {
    const switched = emailDocument({ fixture: "returning" });
    expect(resolveSelection(selected, switched, outline)).toStrictEqual({
      kind: "element",
      instancePath: "0.0.0",
      revision: "rev_1",
      fixture: "returning",
    });
  });

  it("drops rather than rebinding when the authoring at that path changed", () => {
    const moved = emailDocument({
      rev: "rev_2",
      render: renderAt("rev_2", [
        ...SELECTIONS.slice(0, 2),
        element("0.0.0", "h1", { origins: [at(31, 9), at(18, 7)] }),
        SELECTIONS[3]!,
      ]),
    });
    expect(resolveSelection(selected, moved, outline)).toStrictEqual(DOCUMENT_SELECTION);
  });

  it("drops when the same authoring now renders a different tag or iteration", () => {
    const retagged = emailDocument({
      rev: "rev_2",
      render: renderAt("rev_2", [
        ...SELECTIONS.slice(0, 2),
        element("0.0.0", "h2"),
        SELECTIONS[3]!,
      ]),
    });
    expect(resolveSelection(selected, retagged, outline)).toStrictEqual(DOCUMENT_SELECTION);

    const repeated = emailDocument({
      rev: "rev_2",
      render: renderAt("rev_2", [
        ...SELECTIONS.slice(0, 2),
        element("0.0.0", "h1", { occurrence: 1, occurrences: 2 }),
        SELECTIONS[3]!,
      ]),
    });
    expect(resolveSelection(selected, repeated, outline)).toStrictEqual(DOCUMENT_SELECTION);
  });

  it("drops without a previous outline to compare against", () => {
    const rebuilt = emailDocument({ rev: "rev_2", render: renderAt("rev_2") });
    expect(resolveSelection(selected, rebuilt, null)).toStrictEqual(DOCUMENT_SELECTION);
  });

  it("drops with no document, no render, or another channel", () => {
    expect(resolveSelection(selected, null, outline)).toStrictEqual(DOCUMENT_SELECTION);
    expect(resolveSelection(selected, UNBUILT, outline)).toStrictEqual(DOCUMENT_SELECTION);
    expect(resolveSelection(selected, smsDocument(), outline)).toStrictEqual(DOCUMENT_SELECTION);
  });
});

describe("withDocumentChange", () => {
  const emailChangeAt = (
    rev: string,
    overrides: Partial<EmailDocumentChange> = {},
  ): EmailDocumentChange => ({
    rev,
    origin: "self",
    channel: "email",
    preview: { status: "current" },
    fixtures: ["welcome", "returning"],
    fixture: "returning",
    render: renderAt(rev),
    diagnostics: [],
    incompatibilities: [],
    ...overrides,
  });

  it("takes the whole channel payload the host published", () => {
    const next = withDocumentChange(emailDocument(), emailChangeAt("rev_2"), null);
    expect(next.rev).toBe("rev_2");
    expect(next.channel).toBe("email");
    if (next.channel !== "email") return;
    expect(next.fixture).toBe("returning");
    expect(next.render?.revision).toBe("rev_2");
  });

  it("adopts a null render with diagnostics rather than keeping the last good one", () => {
    const diagnostic: EmailDiagnostic = {
      code: "entry-did-not-build",
      severity: "error",
      message: "The template entry did not compile.",
      origins: [at(17, 5)],
    };
    const next = withDocumentChange(
      emailDocument(),
      emailChangeAt("rev_2", {
        render: null,
        fixture: null,
        fixtures: [],
        diagnostics: [diagnostic],
      }),
      null,
    );
    expect(next.channel).toBe("email");
    if (next.channel !== "email") return;
    expect(next.render).toBeNull();
    expect(next.diagnostics).toStrictEqual([diagnostic]);
  });

  it("takes the authored entry when the editor holds no newer unsaved edit", () => {
    const next = withDocumentChange(
      emailDocument(),
      emailChangeAt("rev_2", { authoredSource: "export default () => <Email v2 />" }),
      null,
    );
    expect(next.origin.authoredSource).toBe("export default () => <Email v2 />");
  });

  it("keeps a newer local edit rather than rewinding to the render's authored entry", () => {
    const pending = "export default () => <Email v3 />";
    const document = emailDocument({
      origin: { kind: "tsx", file: "src/Welcome.tsx", authoredSource: pending },
    });
    const next = withDocumentChange(
      document,
      emailChangeAt("rev_2", { authoredSource: "export default () => <Email v2 />" }),
      pending,
    );
    expect(next.origin.authoredSource).toBe(pending);
  });

  it("replaces the render, fixtures and diagnostics on a markup channel", () => {
    const change: SmsDocumentChange = {
      rev: "rev_2",
      origin: "agent",
      authoredSource: "export default () => 2",
      channel: "sms",
      preview: { status: "current" },
      fixtures: ["default", "vip"],
      fixture: "vip",
      render: { revision: "rev_2", text: "New" },
      diagnostics: [],
    };
    const next = withDocumentChange(smsDocument("Old"), change, null);
    expect(next.rev).toBe("rev_2");
    expect(next.channel).toBe("sms");
    expect(next.origin.authoredSource).toBe("export default () => 2");
    if (next.channel !== "sms") return;
    expect(next.render?.text).toBe("New");
    expect(next.fixture).toBe("vip");
  });

  it("fails loudly when the host sends a change for another channel", () => {
    const smsChange: SmsDocumentChange = {
      rev: "rev_2",
      origin: "agent",
      channel: "sms",
      preview: { status: "current" },
      fixtures: [],
      fixture: null,
      render: null,
      diagnostics: [],
    };
    expect(() => withDocumentChange(emailDocument(), smsChange, null)).toThrow(
      /sms change for a email document/,
    );
    expect(() => withDocumentChange(smsDocument(), emailChangeAt("rev_2"), null)).toThrow(
      /email change for a sms document/,
    );
    expect(() => withDocumentChange(whatsappDocument(), smsChange, null)).toThrow(
      /sms change for a whatsapp document/,
    );
  });
});

describe("documentChecks", () => {
  const diagnostic = (
    overrides: Partial<EmailDiagnostic> & Pick<EmailDiagnostic, "code" | "severity">,
  ): EmailDiagnostic => ({
    message: "Something to say.",
    origins: [at(20, 9)],
    ...overrides,
  });

  it("maps host diagnostics and incompatibilities onto check tiers", () => {
    const checks = documentChecks(
      emailDocument({
        diagnostics: [diagnostic({ code: "unsupported-element", severity: "error" })],
        incompatibilities: [
          diagnostic({
            code: "css-border-radius",
            severity: "info",
            clients: ["Outlook Windows", "Yahoo webmail"],
          }),
        ],
      }),
      [],
    );

    expect(checks.map((check) => check.id)).toStrictEqual([
      "diagnostic:unsupported-element",
      "compat:css-border-radius",
      "size:gmail-clip",
    ]);
    expect(checks[0]?.severity).toBe("error");
    expect(checks[1]?.severity).toBe("info");
    // A finding is only actionable with its origin and the clients it applies to.
    expect(checks[1]?.diagnostics?.[0]?.clients).toEqual(["Outlook Windows", "Yahoo webmail"]);
    expect(checks[1]?.diagnostics?.[0]?.occurrences).toEqual([[at(20, 9)]]);
  });

  it("treats a warning diagnostic as badge-counted and keeps info out of the badge", () => {
    const checks = documentChecks(
      emailDocument({
        incompatibilities: [
          diagnostic({ code: "css-linear-gradient", severity: "warning" }),
          diagnostic({ code: "css-border-radius", severity: "info" }),
        ],
      }),
      [],
    );
    const { badgeCount, warnCount, info, ok } = summarizeChecks(checks);

    expect(warnCount).toBe(1);
    expect(badgeCount).toBe(1);
    expect(info).toHaveLength(1);
    expect(ok.map((check) => check.id)).toStrictEqual(["size:gmail-clip"]);
  });

  it("groups repeated fixture findings without losing distinct limitations or source occurrences", () => {
    const base = diagnostic({
      code: "caniemail/font-size",
      severity: "warning",
      notes: "rem is unsupported",
      provenance: "pinned matrix",
      clients: ["Outlook"],
    });
    const checks = documentChecks(
      emailDocument({
        incompatibilities: [
          { ...base, fixtures: ["default"] },
          { ...base, fixtures: ["long"], origins: [at(30, 9)] },
          { ...base, severity: "info", message: "Pixel values are safe", fixtures: ["empty"] },
          {
            ...base,
            code: "caniemail/local-anchors",
            severity: "error",
            message: "Link does not work",
            fixtures: ["long"],
          },
        ],
      }),
      [],
    );
    const summary = summarizeChecks(checks);
    expect(summary.badgeCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    const font = checks.find((check) => check.id === "compat:caniemail/font-size");
    expect(font?.diagnostics).toHaveLength(2);
    expect(font?.diagnostics?.[0]).toMatchObject({
      fixtures: ["default", "long"],
      notes: "rem is unsupported",
      provenance: "pinned matrix",
      occurrences: [[at(20, 9)], [at(30, 9)]],
    });
    expect(font?.diagnostics?.[1]?.fixtures).toEqual(["empty"]);
    expect(summary.actionable[0]?.diagnostics?.[0]?.fixtures).toEqual(["long"]);
  });

  it("preserves assessment variants and leads with unverified evidence without creating a repair", () => {
    const base = diagnostic({ code: "caniemail/example", severity: "info" });
    const checks = documentChecks(
      emailDocument({
        incompatibilities: [
          { ...base, compatibility: { assessment: "not-applicable", title: "No effect" } },
          {
            ...base,
            compatibility: { assessment: "unverified", title: "Verify client rendering" },
          },
          { ...base, compatibility: { assessment: "degradation", title: "Fallback appearance" } },
        ],
      }),
      [],
    );
    expect(checks[0]?.label).toBe("Verify client rendering");
    expect(checks[0]?.diagnostics?.map((item) => item.compatibility?.assessment)).toEqual([
      "unverified",
      "degradation",
      "not-applicable",
    ]);
    expect(summarizeChecks(checks).actionable).toEqual([]);
  });

  it("reprojects a client filter after it excludes the risky variant", () => {
    const risk = diagnostic({
      code: "feature",
      severity: "warning",
      clients: ["Outlook"],
      compatibility: { assessment: "risk", title: "Content disappears" },
    });
    const safe = diagnostic({
      code: "feature",
      severity: "info",
      clients: ["Gmail"],
      fixtures: ["default"],
      compatibility: { assessment: "not-applicable", title: "Content retained" },
    });
    expect(projectDiagnosticCheck("compat:feature", [safe, risk]).label).toBe("Content disappears");
    const filtered = projectDiagnosticCheck(
      "compat:feature",
      [safe, risk].filter((item) => item.clients?.includes("Gmail")),
    );
    expect(filtered.severity).toBe("info");
    expect(filtered.label).toBe("Content retained");
    expect(filtered.detail).toBe("1 finding · 1 client · 1 fixture");
  });

  it("warns when the rendered HTML crosses Gmail's clipping threshold", () => {
    const big = emailDocument({
      render: { ...renderAt("rev_1"), html: `<body>${"x".repeat(120 * 1024)}</body>` },
    });
    const clipping = documentChecks(big, []).find((check) => check.id === "size:gmail-clip");
    expect(clipping?.severity).toBe("warn");
    expect(clipping?.detail).toContain("above Gmail's 102 KB clipping threshold");
  });

  it("says a build produced no render when the host explained nothing", () => {
    expect(documentChecks(UNBUILT, []).map((check) => check.id)).toStrictEqual(["build:no-render"]);
  });

  it("leaves the host's own diagnostics to speak for an unbuilt entry", () => {
    const checks = documentChecks(
      emailDocument({
        render: null,
        fixture: null,
        fixtures: [],
        diagnostics: [diagnostic({ code: "entry-did-not-build", severity: "error" })],
      }),
      [],
    );
    expect(checks.map((check) => check.id)).toStrictEqual(["diagnostic:entry-did-not-build"]);
  });

  it("reports a markup channel's build findings and an unbuilt channel", () => {
    const findings = documentChecks(
      smsDocument("", {
        render: null,
        diagnostics: [diagnostic({ code: "dynamic-expression", severity: "error" })],
      }),
      [],
    );
    expect(findings.map((check) => check.id)).toStrictEqual(["diagnostic:dynamic-expression"]);
    expect(findings[0]?.severity).toBe("error");
    expect(
      documentChecks(smsDocument("", { render: null }), []).map((check) => check.id),
    ).toStrictEqual(["build:no-render"]);
  });

  it("carries build warnings alongside a markup render", () => {
    const checks = documentChecks(
      whatsappDocument({
        diagnostics: [diagnostic({ code: "whatsapp-length", severity: "warning" })],
      }),
      [],
    );
    expect(checks.map((check) => [check.id, check.severity])).toStrictEqual([
      ["diagnostic:whatsapp-length", "warn"],
    ]);
  });

  it("appends host checks last on every channel", () => {
    expect(documentChecks(emailDocument(), [HOST_CHECK]).at(-1)).toStrictEqual(HOST_CHECK);
    expect(documentChecks(smsDocument(), [HOST_CHECK]).at(-1)).toStrictEqual(HOST_CHECK);
    expect(documentChecks(whatsappDocument(), [HOST_CHECK]).at(-1)).toStrictEqual(HOST_CHECK);
  });
});

describe("summarizeChecks", () => {
  it("derives the badge from error + warn only, never info or ok", () => {
    const summary = summarizeChecks([
      { id: "e", severity: "error", label: "e", detail: "" },
      { id: "w1", severity: "warn", label: "w1", detail: "" },
      { id: "w2", severity: "warn", label: "w2", detail: "" },
      { id: "i", severity: "info", label: "i", detail: "" },
      { id: "o", severity: "ok", label: "o", detail: "" },
    ]);

    expect(summary.errorCount).toBe(1);
    expect(summary.warnCount).toBe(2);
    expect(summary.badgeCount).toBe(3);
    expect(summary.info).toHaveLength(1);
    expect(summary.ok).toHaveLength(1);
    // Errors sort ahead of warns in the actionable (badge-counted) set.
    expect(summary.actionable.map((check) => check.severity)).toEqual(["error", "warn", "warn"]);
  });
});
