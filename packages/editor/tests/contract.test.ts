import { describe, expect, it } from "@effect/vitest";
import {
  DocumentConflict,
  DocumentUnavailable,
  emailContentOf,
  type DocumentChange,
  type DocumentUpdate,
  type EditableEditorDocument,
  type EditableEmailDocument,
  type ReadonlyEditorDocument,
} from "@samva/editor/host";
import { Effect, Exit } from "effect";

// The contract is plain TypeScript, so what a schema used to refuse at decode time the compiler
// refuses here: each `@ts-expect-error` below fails the typecheck if the shape starts accepting
// the value it names.

const ORIGIN = {
  kind: "tsx",
  file: "src/Welcome.tsx",
  authoredSource: "export default () => <Email />",
} as const;

const IDENTITY = {
  id: null,
  name: "Welcome",
  rev: "rev_1",
  origin: ORIGIN,
  variables: [{ name: "firstName", sample: "Ada", required: true }],
  metadata: {
    fromDefault: { email: "hello@nimbus.example", name: "Nimbus Coffee" },
    replyToDefault: ["support@nimbus.example"],
  },
} as const;

const RENDER = {
  revision: "rev_1",
  subject: "Ada, your first bag is on us",
  html: '<body data-samva-instance="0"><h1 data-samva-instance="0.0">Hi</h1></body>',
  text: "Ada, your first bag is on us",
  selections: [
    {
      instancePath: "0",
      tag: "body",
      origins: [{ fileName: "src/Welcome.tsx", lineNumber: 17, columnNumber: 5 }],
      authored: false,
      occurrence: 1,
      occurrences: 1,
      start: 0,
      end: 74,
    },
  ],
} as const;

const EMAIL_CONTENT = {
  channel: "email",
  preview: { status: "current" },
  fixtures: ["welcome", "returning"],
  fixture: "welcome",
  render: RENDER,
  diagnostics: [],
  incompatibilities: [],
} as const;

const SMS_CONTENT = {
  channel: "sms",
  preview: { status: "current" },
  fixtures: ["default"],
  fixture: "default",
  render: { revision: "rev_1", text: "Your code is 123456" },
  diagnostics: [],
} as const;

const WHATSAPP_RENDER = {
  revision: "rev_1",
  language: "en_US",
  category: "utility",
  body: "Your order shipped",
  buttons: [{ type: "quick-reply", text: "Stop" }],
} as const;

describe("EditorDocument", () => {
  it("narrows to the email lane, and to nothing for another channel", () => {
    const email = {
      ...IDENTITY,
      ...EMAIL_CONTENT,
      access: { kind: "editable" },
    } satisfies EditableEmailDocument;
    const sms = { ...IDENTITY, ...SMS_CONTENT, access: { kind: "editable" } } as const;

    expect(emailContentOf(email)?.render?.subject).toBe(RENDER.subject);
    expect(emailContentOf(sms satisfies EditableEditorDocument)).toBeNull();
  });

  it("keeps the authored TSX entry on a read-only document", () => {
    const document: ReadonlyEditorDocument = {
      ...IDENTITY,
      ...EMAIL_CONTENT,
      access: { kind: "readonly", reason: "Managed in code." },
    };
    expect(document.origin.authoredSource).toContain("export default");
  });

  it("refuses shapes outside the contract at compile time", () => {
    const refused: ReadonlyArray<EditableEditorDocument> = [
      // @ts-expect-error A channel render is the channel's own: a WhatsApp render on an SMS document.
      { ...IDENTITY, ...SMS_CONTENT, render: WHATSAPP_RENDER, access: { kind: "editable" } },
      // @ts-expect-error The origin is always the TSX entry.
      { ...IDENTITY, ...EMAIL_CONTENT, origin: { kind: "html" }, access: { kind: "editable" } },
    ];
    expect(refused).toHaveLength(2);
  });
});

describe("DocumentChange", () => {
  it("carries the complete channel content at the changed revision", () => {
    const change: DocumentChange = { rev: "rev_2", origin: "self", ...EMAIL_CONTENT };
    expect(change.channel).toBe("email");
    // @ts-expect-error A build that failed is a null render, never a missing field.
    const missing: DocumentChange = { rev: "rev_2", origin: "self", channel: "email" };
    expect(missing.rev).toBe("rev_2");
  });
});

describe("DocumentUpdate", () => {
  it("versions source updates and leaves metadata unversioned", () => {
    const source: DocumentUpdate = {
      kind: "authoredSource",
      baseRev: "rev_1",
      authoredSource: ORIGIN.authoredSource,
    };
    // @ts-expect-error A metadata patch carries no base revision.
    const metadata: DocumentUpdate = { kind: "metadata", baseRev: "rev_1", patch: { name: "x" } };
    expect([source.kind, metadata.kind]).toEqual(["authoredSource", "metadata"]);
  });
});

describe("tagged errors", () => {
  it("carries the diverged revisions on DocumentConflict", () => {
    const error = new DocumentConflict({ expectedRev: "rev_1", actualRev: "rev_2" });
    expect(error).toBeInstanceOf(DocumentConflict);
    expect(error._tag).toBe("DocumentConflict");
    expect(error.actualRev).toBe("rev_2");
  });

  it("fails an Effect host directly when yielded", () => {
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        return yield* new DocumentUnavailable({ reason: "offline" });
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
