import { Effect, Exit, Fiber, Scope, Stream } from "effect";

import type {
  AsyncDocumentReader,
  AsyncEditableEditorHost,
  AsyncEditorHost,
  AsyncFixtureApi,
  AsyncLifecycleApi,
  AsyncReadonlyEditorHost,
  AsyncVersionsApi,
  Capability,
  contractVersion,
  DocumentChange,
  DocumentConflict,
  DocumentError,
  DocumentUnavailable,
  DocumentUpdate,
  EditableEditorDocument,
  EditorDocument,
  EditorEvent,
  FontEntry,
  LifecycleUnavailable,
  ProjectFileExists,
  ProjectLifecycleState,
  PublishedProjectCommit,
  ReadonlyEditorDocument,
  RevisionToken,
  UploadedImage,
  UploadImageInput,
} from "./types";

// The host contract for a host built on Effect. Every effect is `R = never`: the host provides its
// own dependencies before constructing it. `toAsyncHost` turns one into the Promise host
// `EditorProvider` takes; the two carry the same capabilities.

/** The initial document plus its live change stream, handed out atomically by {@link DocumentReader.open}. */
export interface OpenDocument<TDocument extends EditorDocument = EditorDocument> {
  readonly initial: TDocument;
  readonly changes: Stream.Stream<DocumentChange, DocumentError>;
}

/**
 * The one required capability. The host owns the source of truth (API, Vite
 * watcher, localStorage, agent writes) and is the single entry point for every
 * external mutation via the change stream — the editor never has a second sync
 * path.
 */
export interface DocumentReader<TDocument extends EditorDocument = EditorDocument> {
  /**
   * Attach to the document. `open` MUST establish the change subscription
   * BEFORE reading the initial snapshot, so no change published between the two
   * can be lost — there is no gap between the returned `initial` and the first
   * element of `changes`. The subscription lives for the caller's `Scope`;
   * closing it releases the host's underlying watcher/socket.
   */
  readonly open: Effect.Effect<OpenDocument<TDocument>, DocumentError, Scope.Scope>;
}

/**
 * Optional mutation seam for an editable document. A read-only host has no
 * writer property, so no callable save path exists at the type level.
 */
export interface DocumentWriter {
  /**
   * Persist an update and return the resulting revision.
   *
   * `authoredSource` advances the revision (checked against `baseRev`, raising
   * {@link DocumentConflict} on divergence) and emits a `self` {@link DocumentChange}.
   * `metadata` (name, from/reply-to defaults) is NOT versioned with the source:
   * it MUST return the CURRENT revision unchanged and MUST NOT emit a change, so
   * a rename never makes the next source save conflict.
   */
  readonly save: (
    update: DocumentUpdate,
  ) => Effect.Effect<{ readonly rev: RevisionToken }, DocumentError>;
}

/**
 * Show another declared fixture. This re-renders the same build, so it changes
 * what the editor renders and never the workspace: it returns nothing, and the
 * resulting render arrives on the change stream like every other document state.
 */
export interface FixtureApi {
  readonly view: (fixture: string) => Effect.Effect<void, DocumentError>;
}

/**
 * Optional persisted lifecycle. This is deliberately separate from the
 * editor's local undo/redo history, which never represents saved versions.
 */
export interface LifecycleApi {
  readonly inspect: Effect.Effect<ProjectLifecycleState, LifecycleUnavailable>;
  readonly publish: (input: {
    readonly baseRev: RevisionToken;
    readonly commit: string;
  }) => Effect.Effect<PublishedProjectCommit, LifecycleUnavailable | DocumentConflict>;
  /**
   * Stage a historical commit. The host publishes the resulting document state
   * on the change stream; this returns the revision and the authored entry the
   * editor must now show.
   */
  readonly restore: (input: {
    readonly commit: string;
    readonly baseRev: RevisionToken;
  }) => Effect.Effect<
    { readonly rev: RevisionToken; readonly authoredSource: string },
    LifecycleUnavailable | DocumentConflict
  >;
  readonly resolveConflict: (input: {
    readonly path: string;
    readonly baseRev: RevisionToken;
    readonly resolution: "draft" | "main" | { readonly content: string | null };
  }) => Effect.Effect<ProjectLifecycleState, LifecycleUnavailable | DocumentConflict>;
  readonly updateFile: (input: {
    readonly path: string;
    readonly baseRev: RevisionToken;
    readonly content: string | null;
  }) => Effect.Effect<ProjectLifecycleState, LifecycleUnavailable | DocumentConflict>;
  /**
   * Write an image or font's bytes into the draft; the next Save keeps it. `replace: false` adds a
   * new file and fails with {@link ProjectFileExists} when the path is taken; `replace: true`
   * changes an existing one. The resulting file is listed with `binary: true`.
   */
  readonly putAsset: (input: {
    readonly path: string;
    readonly baseRev: RevisionToken;
    readonly bytes: Uint8Array;
    readonly replace: boolean;
  }) => Effect.Effect<
    ProjectLifecycleState,
    LifecycleUnavailable | DocumentConflict | ProjectFileExists
  >;
}

export interface AssetApi {
  readonly uploadImage: (input: UploadImageInput) => Effect.Effect<UploadedImage>;
  readonly fonts: {
    readonly catalog: Effect.Effect<ReadonlyArray<FontEntry>>;
  };
}

/** The Effect form of {@link AsyncVersionsApi}. */
export interface VersionsApi {
  readonly save: (revision: RevisionToken) => Effect.Effect<RevisionToken, DocumentError>;
  readonly savedRevision: Effect.Effect<RevisionToken | null, DocumentUnavailable>;
}

/**
 * The Effect-native host contract. `document` is required; every other slice is
 * an optional {@link Capability}. Hosts fully provide their own dependencies
 * before constructing this, so every effect here is `R = never`.
 */
interface EditorHostCapabilities {
  readonly contractVersion: typeof contractVersion;
  /** Whether the authored TSX may be changed through the raw source workspace. */
  readonly sourceAccess: "editable" | "readonly";
  /** A host that saves source but has no metadata writer declares that limitation. */
  readonly metadataAccess?: "editable" | "readonly" | undefined;
  /** Present when the host can re-render the open document for another declared fixture. */
  readonly fixtures?: Capability<FixtureApi> | undefined;
  readonly assets?: Capability<AssetApi> | undefined;
  readonly lifecycle?: Capability<LifecycleApi> | undefined;
  readonly versions?: Capability<VersionsApi> | undefined;
  readonly telemetry?: ((event: EditorEvent) => Effect.Effect<void>) | undefined;
}

export interface EditableEditorHost extends EditorHostCapabilities {
  readonly access: "editable";
  readonly document: DocumentReader<EditableEditorDocument>;
  readonly writer: DocumentWriter;
}

export interface ReadonlyEditorHost extends EditorHostCapabilities {
  readonly access: "readonly";
  readonly document: DocumentReader<ReadonlyEditorDocument>;
  readonly writer?: never | undefined;
}

export type EditorHost = EditableEditorHost | ReadonlyEditorHost;

const mapCapability = <A, B>(capability: Capability<A>, mapApi: (api: A) => B): Capability<B> =>
  capability.status === "ready" ? { status: "ready", api: mapApi(capability.api) } : capability;

const toAsyncDocumentReader = <TDocument extends EditorDocument>(
  reader: DocumentReader<TDocument>,
): AsyncDocumentReader<TDocument> => ({
  open: async (
    onChange: (change: DocumentChange) => void,
    onError?: (error: DocumentError) => void,
    onComplete?: () => void,
  ) => {
    const scope = await Effect.runPromise(Scope.make());
    const opened = await Effect.runPromise(
      Scope.provide(reader.open, scope).pipe(
        // The caller never receives `close` when attach fails, so the facade
        // owns cleanup for this path. Preserve the original Exit for scoped
        // finalizers instead of leaking a half-open watcher/subscription.
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
      ),
    );

    // Interruption is asynchronous — the drain fiber can deliver one more
    // element after `close()` requests it (StrictMode's double teardown hits
    // this every mount). This flag, set synchronously in `close()`, gates
    // every callback so nothing fires once the caller has let go.
    let closed = false;
    const consume = Stream.runForEach(opened.changes, (change) =>
      Effect.sync(() => {
        if (!closed) onChange(change);
      }),
    );
    const withError = onError
      ? consume.pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (!closed) onError(error);
            }),
          ),
        )
      : consume;
    // `andThen` runs only when the stream ends normally; a failing stream
    // short-circuits before it, and interruption from close() never reaches it.
    const drain = withError.pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (!closed && onComplete) onComplete();
        }),
      ),
      // A naturally ending or failing stream has no future callback that can
      // release the caller-owned handle. Closing here also covers close(),
      // whose interruption reaches this finalizer before the drain exits.
      Effect.onExit((exit) => Scope.close(scope, exit)),
    );
    const fiber = Effect.runFork(drain);

    return {
      initial: opened.initial,
      close: () => {
        closed = true;
        Effect.runFork(Fiber.interrupt(fiber));
      },
    };
  },
});

/**
 * Derive the async facade from a canonical Effect host.
 *
 * The contract is `R = never` (hosts fully provide their dependencies before
 * constructing the host), so effects run directly with `Effect.runPromise` /
 * `Effect.runFork` — no `Runtime` value is threaded (Effect v4 removed
 * `Runtime.Runtime`; `Effect.run*` are the program boundary). `open` runs the
 * host's scoped attach in a caller-owned `Scope`: the store subscribes before
 * yielding `initial`, so awaiting `open` guarantees the drain fiber's stream is
 * already live — no change can slip through the load↔subscribe window. `close`
 * interrupts the drain fiber and closes the scope, releasing the subscription.
 */
export function toAsyncHost(host: EditableEditorHost): AsyncEditableEditorHost;
export function toAsyncHost(host: ReadonlyEditorHost): AsyncReadonlyEditorHost;
export function toAsyncHost(host: EditorHost): AsyncEditorHost;
export function toAsyncHost(host: EditorHost): AsyncEditorHost {
  const telemetry = host.telemetry;
  const capabilities = {
    contractVersion: host.contractVersion,
    sourceAccess: host.sourceAccess,
    metadataAccess: host.metadataAccess,
    assets:
      host.assets &&
      mapCapability(host.assets, (api) => ({
        uploadImage: (input: UploadImageInput) => Effect.runPromise(api.uploadImage(input)),
        fonts: { catalog: () => Effect.runPromise(api.fonts.catalog) },
      })),
    fixtures:
      host.fixtures &&
      mapCapability<FixtureApi, AsyncFixtureApi>(host.fixtures, (api) => ({
        view: (fixture: string) => Effect.runPromise(api.view(fixture)),
      })),
    versions:
      host.versions &&
      mapCapability<VersionsApi, AsyncVersionsApi>(host.versions, (api) => ({
        save: (revision: RevisionToken) => Effect.runPromise(api.save(revision)),
        savedRevision: () => Effect.runPromise(api.savedRevision),
      })),
    lifecycle:
      host.lifecycle &&
      mapCapability<LifecycleApi, AsyncLifecycleApi>(host.lifecycle, (api) => ({
        inspect: () => Effect.runPromise(api.inspect),
        publish: (input: { readonly baseRev: RevisionToken; readonly commit: string }) =>
          Effect.runPromise(api.publish(input)),
        restore: (input: { readonly commit: string; readonly baseRev: RevisionToken }) =>
          Effect.runPromise(api.restore(input)),
        resolveConflict: (input) => Effect.runPromise(api.resolveConflict(input)),
        updateFile: (input) => Effect.runPromise(api.updateFile(input)),
        putAsset: (input) => Effect.runPromise(api.putAsset(input)),
      })),
    telemetry:
      telemetry &&
      ((event: EditorEvent) => {
        Effect.runFork(telemetry(event));
      }),
  };
  if (host.access === "readonly") {
    return {
      ...capabilities,
      access: "readonly",
      document: toAsyncDocumentReader(host.document),
    };
  }
  return {
    ...capabilities,
    access: "editable",
    document: toAsyncDocumentReader(host.document),
    writer: { save: (update) => Effect.runPromise(host.writer.save(update)) },
  };
}
