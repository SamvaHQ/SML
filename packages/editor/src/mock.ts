import {
  contractVersion,
  DocumentConflict,
  type Capability,
  type DocumentChange,
  type EditableEmailDocument,
  type EmailRender,
  type Variable,
} from "@samva/editor/host";
import {
  type AssetApi,
  type DocumentReader,
  type DocumentWriter,
  type EditableEditorHost,
  type FixtureApi,
} from "@samva/editor/host/effect";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import type { JsxSourceLocation } from "@samva/markup/edit";
import {
  emailSelections,
  INSTANCE_PATH_ATTRIBUTE,
  type EmittedPosition,
} from "@samva/markup/render";
import { Effect, PubSub, Ref, Stream } from "effect";

/** The project entry the dev harness and the component tests edit. */
export const NIMBUS_WELCOME_TSX = `import {
  Button,
  Column,
  Container,
  Email,
  Heading,
  Image,
  Row,
  Section,
  Text,
} from "@samva/markup/email"

const perks = ["Single-origin", "Roasted to order", "Free shipping"]

export default function WelcomeEmail({ firstName, claimUrl }) {
  return (
    <Email subject={\`\${firstName}, your first bag is on us\`}>
      <Container>
        <Image src="https://assets.nimbus.example/logo.png" alt="Nimbus Coffee" />
        <Heading>{firstName}, your first bag is on us</Heading>
        <Text>
          We roast in small batches and ship within a day, so every bag lands fresh.
        </Text>
        <Button href={claimUrl}>Claim your free bag</Button>
        <Section>
          {perks.map((perk) => (
            <Row key={perk}>{perk}</Row>
          ))}
        </Section>
      </Container>
    </Email>
  )
}`;

const ENTRY_FILE = "src/Welcome.tsx";

const at = (lineNumber: number, columnNumber: number): JsxSourceLocation => ({
  fileName: ENTRY_FILE,
  lineNumber,
  columnNumber,
});

/**
 * One node of the mock's rendered document. The mock does not compile anything:
 * it holds the tree a real render would have produced, and serializes it to the
 * same instance-stamped HTML plus the selections that name each element.
 */
interface MockNode {
  readonly tag: string;
  readonly authored: boolean;
  /** Authoring element first, then each enclosing component call site. */
  readonly origins: ReadonlyArray<JsxSourceLocation>;
  readonly text?: string | undefined;
  readonly attrs?: Readonly<Record<string, string>> | undefined;
  readonly children?: ReadonlyArray<MockNode> | undefined;
}

const EMAIL_CALL = at(17, 5);
const CONTAINER_CALL = at(18, 7);
/** The one authored cell inside `Row`, wherever `Row` is used. */
const ROW_CELL = at(31, 5);
const LOOP_ROW_CALL = at(28, 13);
const FOOTER_ROW_CALL = at(34, 9);

/**
 * One `<Row>` rendering. Its cell is authored once; the call site is what tells
 * the three rows of the map apart from the one in the footer.
 */
const rowNode = (
  perk: string,
  callSite: JsxSourceLocation,
  table: JsxSourceLocation,
): MockNode => ({
  tag: "tr",
  authored: true,
  origins: [at(30, 3), callSite, table, CONTAINER_CALL, EMAIL_CALL],
  children: [
    {
      tag: "td",
      authored: true,
      origins: [ROW_CELL, callSite, table, CONTAINER_CALL, EMAIL_CALL],
      text: perk,
    },
  ],
});

const documentTree = (heading: string): MockNode => ({
  tag: "body",
  authored: false,
  origins: [EMAIL_CALL],
  children: [
    {
      tag: "div",
      authored: true,
      origins: [CONTAINER_CALL, EMAIL_CALL],
      children: [
        {
          tag: "img",
          authored: true,
          origins: [at(19, 9), CONTAINER_CALL, EMAIL_CALL],
          attrs: { src: "https://assets.nimbus.example/logo.png", alt: "Nimbus Coffee" },
        },
        {
          tag: "h1",
          authored: true,
          origins: [at(20, 9), CONTAINER_CALL, EMAIL_CALL],
          text: heading,
        },
        {
          tag: "p",
          authored: true,
          origins: [at(21, 9), CONTAINER_CALL, EMAIL_CALL],
          text: "We roast in small batches and ship within a day, so every bag lands fresh.",
        },
        {
          // The button primitive wraps its anchor in a table for Outlook, so the
          // wrapper is generated and its origin is the Button call the author wrote.
          tag: "table",
          authored: false,
          origins: [at(24, 9), CONTAINER_CALL, EMAIL_CALL],
          children: [
            {
              tag: "a",
              authored: true,
              origins: [at(24, 9), CONTAINER_CALL, EMAIL_CALL],
              attrs: { href: "https://nimbus.example/claim/ada" },
              text: "Claim your free bag",
            },
          ],
        },
        {
          tag: "table",
          authored: true,
          origins: [at(26, 9), CONTAINER_CALL, EMAIL_CALL],
          // One authored Row inside a map: three rendered rows share its origin
          // chain, so each reports its own occurrence out of three.
          children: ["Single-origin", "Roasted to order", "Free shipping"].map((perk) =>
            rowNode(perk, LOOP_ROW_CALL, at(26, 9)),
          ),
        },
        {
          tag: "table",
          authored: true,
          origins: [at(33, 9), CONTAINER_CALL, EMAIL_CALL],
          // The same Row through a second call site. Its cell shares the loop
          // rows' authoring but not their call site, which is the difference a
          // shared-definition edit has to make visible.
          children: [rowNode("Questions? Just reply.", FOOTER_ROW_CALL, at(33, 9))],
        },
      ],
    },
  ],
});

const VOID_TAGS: ReadonlySet<string> = new Set(["img", "br", "hr"]);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DOCUMENT_HEAD =
  '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:0}' +
  "@media (prefers-color-scheme: dark){body{background:#0a0a0a;color:#fff}}</style></head>";

/** Serialize the tree into instance-stamped HTML and the positions each element occupies. */
const serialize = (root: MockNode): { html: string; positions: EmittedPosition[] } => {
  const positions: EmittedPosition[] = [];
  let html = DOCUMENT_HEAD;
  const write = (node: MockNode, instancePath: string): void => {
    const start = html.length;
    const attrs = Object.entries(node.attrs ?? {})
      .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
      .join("");
    html += `<${node.tag} ${INSTANCE_PATH_ATTRIBUTE}="${instancePath}"${attrs}>`;
    if (!VOID_TAGS.has(node.tag)) {
      if (node.text !== undefined) html += escapeHtml(node.text);
      (node.children ?? []).forEach((child, index) => write(child, `${instancePath}.${index}`));
      html += `</${node.tag}>`;
    }
    positions.push({
      start,
      end: html.length,
      origins: node.origins,
      instancePath,
      tag: node.tag,
      authored: node.authored,
    });
  };
  write(root, "0");
  html += "</html>";
  return { html, positions };
};

/** Fixtures the mock template declares, with the heading each one renders. */
const FIXTURES: ReadonlyArray<{ readonly name: string; readonly firstName: string }> = [
  { name: "welcome", firstName: "Ada" },
  { name: "returning", firstName: "Grace" },
];

export const MOCK_FIXTURE_NAMES: ReadonlyArray<string> = FIXTURES.map(({ name }) => name);

/** The sample document rendered through one declared fixture, as a host would hand it over. */
export const renderMockFixture = (fixture: string, revision: string): EmailRender => {
  const declared = FIXTURES.find((candidate) => candidate.name === fixture) ?? FIXTURES[0]!;
  const heading = `${declared.firstName}, your first bag is on us`;
  const { html, positions } = serialize(documentTree(heading));
  return {
    revision,
    subject: heading,
    preheader: "Freshly roasted, free shipping, no strings.",
    html,
    text: `${heading}\n\nWe roast in small batches and ship within a day.`,
    selections: emailSelections(positions),
  };
};

/** What the mock reports when a caller asks it to hold an entry that does not build. */
/** The entry has never been executed: a state to explain, not a failure to fix. */
const UNBUILT_ENTRY: EmailDiagnostic = {
  code: "entry-not-built",
  severity: "info",
  message: "This entry has not been built yet.",
  origins: [],
};

const BROKEN_ENTRY: EmailDiagnostic = {
  code: "entry-did-not-build",
  severity: "error",
  message: "The template entry did not compile.",
  origins: [at(17, 5)],
};

const VARIABLES: ReadonlyArray<Variable> = [
  { name: "firstName", sample: "Ada", required: true },
  { name: "claimUrl", sample: "https://nimbus.example/claim/ada", required: true },
];

const INITIAL_METADATA: EditableEmailDocument["metadata"] = {
  fromDefault: { email: "hello@nimbus.example", name: "Nimbus Coffee" },
  replyToDefault: ["support@nimbus.example"],
};

interface MockState {
  readonly authoredSource: string;
  readonly name: string;
  readonly metadata: EditableEmailDocument["metadata"];
  readonly rev: string;
  readonly previewRevision: string;
  readonly staleReason?: string | undefined;
  readonly fixture: string;
  /**
   * `true` when the mock stands in for an entry that failed to build,
   * `"not-built"` for one nothing has executed yet. Both leave the document
   * without a render; only the first is a failure.
   */
  readonly broken: boolean | "not-built";
}

const emailContent = (state: MockState) =>
  state.broken !== false
    ? {
        channel: "email" as const,
        preview: { status: "current" as const },
        fixtures: [],
        fixture: null,
        render: null,
        diagnostics: [state.broken === "not-built" ? UNBUILT_ENTRY : BROKEN_ENTRY],
        incompatibilities: [],
      }
    : {
        channel: "email" as const,
        preview:
          state.staleReason === undefined
            ? { status: "current" as const }
            : { status: "stale" as const, reason: state.staleReason },
        fixtures: MOCK_FIXTURE_NAMES,
        fixture: state.fixture,
        render: renderMockFixture(state.fixture, state.previewRevision),
        diagnostics: [],
        incompatibilities: [],
      };

/** A ready mock host plus hooks to drive it from the dev harness and tests. */
export interface MockHostControls {
  readonly host: EditableEditorHost;
  /** Publish a foreign change, with the render the host produced for it. */
  readonly emit: (input: {
    readonly origin: "agent" | "external";
    readonly authoredSource?: string | undefined;
    readonly broken?: boolean | "not-built" | undefined;
    readonly staleReason?: string | undefined;
  }) => Effect.Effect<void>;
}

export const createMockHost: Effect.Effect<MockHostControls> = Effect.gen(function* () {
  const changes = yield* PubSub.unbounded<DocumentChange>();
  const revCounter = yield* Ref.make(1);
  const stateRef = yield* Ref.make<MockState>({
    authoredSource: NIMBUS_WELCOME_TSX,
    name: "Welcome — first bag on us",
    metadata: INITIAL_METADATA,
    rev: "rev_1",
    previewRevision: "rev_1",
    fixture: MOCK_FIXTURE_NAMES[0]!,
    broken: false,
  });

  const mintRev = Ref.modify(revCounter, (n) => [`rev_${n + 1}`, n + 1] as const);

  const buildDocument = (state: MockState): EditableEmailDocument => ({
    id: "tpl_nimbus_welcome",
    name: state.name,
    origin: { kind: "tsx", file: ENTRY_FILE, authoredSource: state.authoredSource },
    access: { kind: "editable" },
    rev: state.rev,
    variables: VARIABLES,
    metadata: state.metadata,
    ...emailContent(state),
  });

  const publish = (state: MockState, origin: "self" | "agent" | "external") =>
    PubSub.publish(changes, {
      rev: state.rev,
      origin,
      authoredSource: state.authoredSource,
      ...emailContent(state),
    });

  const document: DocumentReader<EditableEmailDocument> = {
    // Subscribe BEFORE reading the snapshot so nothing published in between is
    // lost — the returned stream tails the same attached subscription.
    open: Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const state = yield* Ref.get(stateRef);
      return {
        initial: buildDocument(state),
        changes: Stream.fromEffectRepeat(PubSub.take(subscription)),
      };
    }),
  };

  const writer: DocumentWriter = {
    save: (update) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);

        if (update.kind === "metadata") {
          // Metadata is not versioned with the source: keep the rev and emit no
          // change, so a rename never makes the next source save conflict.
          yield* Ref.set(stateRef, {
            ...state,
            name: update.patch.name ?? state.name,
            metadata: {
              fromDefault:
                update.patch.fromDefault === undefined
                  ? state.metadata.fromDefault
                  : (update.patch.fromDefault ?? undefined),
              replyToDefault:
                update.patch.replyToDefault === undefined
                  ? state.metadata.replyToDefault
                  : (update.patch.replyToDefault ?? undefined),
            },
          });
          return { rev: state.rev };
        }

        if (update.baseRev !== state.rev) {
          return yield* new DocumentConflict({
            expectedRev: update.baseRev,
            actualRev: state.rev,
          });
        }

        const rev = yield* mintRev;
        const next = {
          ...state,
          authoredSource: update.authoredSource,
          rev,
          previewRevision: rev,
          staleReason: undefined,
        };
        yield* Ref.set(stateRef, next);
        yield* publish(next, "self");
        return { rev };
      }),
  };

  const fixtures: Capability<FixtureApi> = {
    status: "ready",
    api: {
      view: (fixture) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (!MOCK_FIXTURE_NAMES.includes(fixture) || state.broken !== false) return;
          const next = { ...state, fixture };
          yield* Ref.set(stateRef, next);
          // A fixture switch re-renders the same build, so the revision holds.
          yield* publish(next, "self");
        }),
    },
  };

  const assets: Capability<AssetApi> = {
    status: "ready",
    api: {
      uploadImage: (input) =>
        Effect.gen(function* () {
          yield* Effect.sleep("200 millis");
          return { url: `https://cdn.samva.local/${input.name}` };
        }),
      fonts: {
        catalog: Effect.succeed([
          {
            family: "Instrument Sans",
            fallback: "Arial, Helvetica, sans-serif",
          },
          {
            family: "Iowan Old Style",
            fallback: "Georgia, 'Times New Roman', serif",
          },
        ]),
      },
    },
  };

  const host: EditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document,
    writer,
    fixtures,
    assets,
  };

  const emit: MockHostControls["emit"] = (input) =>
    Effect.gen(function* () {
      const rev = yield* mintRev;
      const state = yield* Ref.get(stateRef);
      const next: MockState = {
        ...state,
        rev,
        authoredSource: input.authoredSource ?? state.authoredSource,
        broken: input.broken ?? state.broken,
        previewRevision: input.staleReason === undefined ? rev : state.previewRevision,
        staleReason: input.staleReason,
      };
      yield* Ref.set(stateRef, next);
      yield* publish(next, input.origin);
    });

  return { host, emit };
});
