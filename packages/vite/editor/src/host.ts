import {
  contractVersion,
  DocumentUnavailable,
  DocumentConflict,
  type DocumentChange,
  type DocumentError,
  type EditableEditorDocument,
  type EmailDocumentChange,
  type EditorDocument,
  type SmsDocumentChange,
  type WhatsAppDocumentChange,
} from "@samva/editor/host";
import {
  type DocumentWriter,
  type DocumentReader,
  type EditorHost,
  type FixtureApi,
} from "@samva/editor/host/effect";
import { Effect, Queue, Stream } from "effect";

// Browser-side host implementing the Effect-native `@samva/editor` contract over
// the samvaEditor plugin's HTTP + SSE transport. A local document is its `.tsx`
// file, and a template that declares several channels is several documents over
// it. Source writes carry the last observed revision and return the compiled
// build through the change stream.
//
// No-gap open: the SSE `samva:change` listener is attached and buffering into an
// unbounded queue BEFORE the initial snapshot is read, so no change published in
// the load↔subscribe window is lost. The server attributes origin per client (see
// below), so a fixture switch in ANOTHER tab arrives here as `external`; our own
// arrives as `self`.
//
// Reconnect reconciliation: EventSource auto-reconnects, but the server keeps no
// replay, so a change during a disconnect would be silently missed. On every
// reconnect we refetch the snapshot and, if the build, the authored source or the
// viewed fixture moved, emit an external change — reconnect = reconcile, never a
// silent gap.

const apiUrl = (path: string, params: Record<string, string>): string => {
  const url = new URL(`api/${path}`, window.location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

/** The channel half of a document or a change, exactly as the plugin serves it. */
type ServerContent =
  | Pick<
      EmailDocumentChange,
      | "channel"
      | "preview"
      | "fixtures"
      | "fixture"
      | "render"
      | "diagnostics"
      | "incompatibilities"
    >
  | Pick<
      SmsDocumentChange,
      "channel" | "preview" | "fixtures" | "fixture" | "render" | "diagnostics"
    >
  | Pick<
      WhatsAppDocumentChange,
      "channel" | "preview" | "fixtures" | "fixture" | "render" | "diagnostics"
    >;

type ServerChange = ServerContent & {
  readonly id: string;
  readonly rev: string;
  readonly authoredSource?: string | undefined;
  readonly origin: "self" | "external";
};

/** What the last delivered state was, for reconnect reconciliation. */
interface DocumentCell {
  rev: string;
  authoredSource?: string | undefined;
  fixture?: string | null | undefined;
}

const fixtureOf = (content: ServerContent): string | null => content.fixture;

const changeOf = (
  content: ServerContent,
  rev: string,
  origin: "self" | "external",
  authoredSource: string | undefined,
): DocumentChange => {
  const head = { rev, origin, ...(authoredSource === undefined ? {} : { authoredSource }) };
  // A channel's content is delivered whole, so the change is the head plus the content.
  return { ...head, ...content } as DocumentChange;
};

const openStore = <Document extends EditorDocument>(
  id: string,
  clientId: string,
  last: DocumentCell,
): DocumentReader<Document>["open"] =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<DocumentChange, DocumentError>();
    const source = new EventSource(apiUrl("events", { id, client: clientId }));
    yield* Effect.addFinalizer(() => Effect.sync(() => source.close()));

    // Buffer changes from the moment the stream is attached, passing through the
    // server-attributed origin (self for our own fixture switch, external for others').
    source.addEventListener("samva:change", (event) => {
      const change = JSON.parse((event as MessageEvent).data) as ServerChange;
      if (change.id !== id) return;
      last.rev = change.rev;
      last.fixture = fixtureOf(change);
      if (change.authoredSource !== undefined) last.authoredSource = change.authoredSource;
      Queue.offerUnsafe(queue, changeOf(change, change.rev, change.origin, change.authoredSource));
    });

    const reconcile = (): Promise<void> =>
      fetch(apiUrl("document", { id, client: clientId }))
        .then((response) => (response.ok ? (response.json() as Promise<Document>) : undefined))
        .then((document) => {
          if (document === undefined) return;
          const authoredSource = document.origin.authoredSource;
          if (
            document.rev === last.rev &&
            authoredSource === last.authoredSource &&
            fixtureOf(document) === last.fixture
          ) {
            return;
          }
          last.rev = document.rev;
          last.authoredSource = authoredSource;
          last.fixture = fixtureOf(document);
          Queue.offerUnsafe(queue, changeOf(document, document.rev, "external", authoredSource));
        })
        .catch(() => {
          /* a failed reconcile leaves the stream intact; the next reconnect retries */
        });

    // A single open handler: the first open establishes the subscription; every
    // later open is a reconnect and triggers reconciliation.
    let established = false;
    let resolveOpen: ((effect: Effect.Effect<void, DocumentError>) => void) | undefined;
    source.addEventListener("open", () => {
      if (!established) {
        established = true;
        resolveOpen?.(Effect.void);
        return;
      }
      void reconcile();
    });
    source.addEventListener("error", () => {
      if (!established && source.readyState !== EventSource.OPEN) {
        resolveOpen?.(new DocumentUnavailable({ reason: "editor event stream failed to open" }));
      }
    });

    // Wait for the subscription to go live before reading the snapshot.
    yield* Effect.callback<void, DocumentError>((resume) => {
      if (source.readyState === EventSource.OPEN) {
        established = true;
        return resume(Effect.void);
      }
      resolveOpen = resume;
    });

    const response = yield* Effect.tryPromise({
      try: () => fetch(apiUrl("document", { id, client: clientId })),
      catch: (error) => new DocumentUnavailable({ reason: String(error) }),
    });
    if (!response.ok) {
      return yield* new DocumentUnavailable({ reason: `open failed (${response.status})` });
    }
    const initial = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Document>,
      catch: (error) => new DocumentUnavailable({ reason: String(error) }),
    });
    last.rev = initial.rev;
    last.authoredSource = initial.origin.authoredSource;
    last.fixture = fixtureOf(initial);

    return { initial, changes: Stream.fromQueue(queue) };
  });

/**
 * Showing another fixture re-renders the same build on the server, which
 * publishes the resulting document on the change stream like every other state.
 */
const viewFixture = (id: string, clientId: string): FixtureApi => ({
  view: (fixture) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(apiUrl("fixture", { id, client: clientId }), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fixture }),
          }),
        catch: (error) => new DocumentUnavailable({ reason: String(error) }),
      });
      if (response.ok) return;
      const fallback = `view fixture failed (${response.status})`;
      const reason = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error?: string | undefined }>,
        catch: () => new DocumentUnavailable({ reason: fallback }),
      }).pipe(Effect.map((body) => body.error ?? fallback));
      return yield* new DocumentUnavailable({ reason });
    }),
});

const fileWriter = (id: string, clientId: string): DocumentWriter => ({
  save: (update) =>
    Effect.gen(function* () {
      if (update.kind !== "authoredSource")
        return yield* new DocumentUnavailable({ reason: "Local metadata is declared in source." });
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(apiUrl("document", { id, client: clientId }), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(update),
          }),
        catch: (error) => new DocumentUnavailable({ reason: String(error) }),
      });
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ rev?: string; actualRev?: string; error?: string }>,
        catch: (error) => new DocumentUnavailable({ reason: String(error) }),
      });
      if (response.status === 409)
        return yield* new DocumentConflict({
          expectedRev: update.baseRev,
          actualRev: body.actualRev ?? update.baseRev,
        });
      if (!response.ok || body.rev === undefined)
        return yield* new DocumentUnavailable({
          reason: body.error ?? "Local source save failed.",
        });
      return { rev: body.rev };
    }),
});

export interface FileHostOptions {
  /** The document id: the entry's project-relative path, with `#sms` or `#whatsapp` for those channels. */
  readonly id: string;
}

export const createFileHost = ({ id }: FileHostOptions): EditorHost => {
  // A per-session client id lets the server attribute change origin: our own
  // fixture switch comes back as `self`, another tab's as `external`.
  const clientId = crypto.randomUUID();
  const last: DocumentCell = { rev: "" };
  return {
    contractVersion,
    access: "editable",
    // The file and the revision are the shared authority for both code and visual edits.
    sourceAccess: "editable",
    metadataAccess: "readonly",
    writer: fileWriter(id, clientId),
    document: { open: openStore<EditableEditorDocument>(id, clientId, last) },
    fixtures: { status: "ready", api: viewFixture(id, clientId) },
  };
};
