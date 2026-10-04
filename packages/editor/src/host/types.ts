import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import type { EmailElementSelection } from "@samva/markup/render";
import { Data } from "effect";

// The host contract is plain TypeScript over markup's own types, and the host an embedder
// implements is promises and callbacks. Nothing here decodes: a host hands the editor values it
// already holds. A host built on Effect implements `@samva/editor/host/effect` instead.

/**
 * Bumped whenever the shape below changes in a way a host must react to. Hosts
 * carry it on the {@link EditorHost} they construct; the editor reads it to fail
 * loudly on a contract mismatch instead of silently mis-rendering.
 */
export const contractVersion = "2026-10-03.1" as const;

export type TemplateChannel = "email" | "sms" | "whatsapp";

/**
 * Opaque revision token minted by the host on every successful save. The editor
 * echoes the last known token back as `baseRev`; the host compares and raises
 * {@link DocumentConflict} when they diverge. Conflict policy is the host's.
 */
export type RevisionToken = string;

/** Marketing treatment for a `locked` capability — a visible upsell, not a hidden feature. */
export interface Upsell {
  readonly reason: string;
  readonly cta: { readonly label: string; readonly href: string };
}

/**
 * A host capability the editor derives its UI from. `ready` renders the
 * affordance functionally; `locked` renders it with the upsell treatment; a
 * capability that is absent (the key omitted, or set to `undefined`) renders
 * nothing.
 */
export type Capability<TApi> =
  | { readonly status: "ready"; readonly api: TApi }
  | { readonly status: "locked"; readonly upsell: Upsell };

/** A template variable: name, an optional sample the preview renders, and whether a send requires it. */
export interface Variable {
  readonly name: string;
  readonly sample?: string | undefined;
  readonly required: boolean;
}

/** Default sender for the envelope card's From field. */
export interface FromDefault {
  readonly email: string;
  readonly name?: string | undefined;
}

/** Envelope defaults saved alongside the source but explicitly NOT versioned with it. */
export interface DocumentMetadata {
  readonly fromDefault?: FromDefault | undefined;
  readonly replyToDefault?: ReadonlyArray<string> | undefined;
}

/** The name of one input the template declares and can be rendered against. */
export type FixtureName = string;

/**
 * One render of the email from the template's IR: the delivered content plus the identity of every
 * rendered element.
 *
 * `html` carries `data-samva-instance` on each element, which is how a click in the canvas
 * resolves to exactly one entry in `selections`; each selection's origin is the span of the TSX
 * that produced the element, taken from the compiler's parse. It is preview-only; a delivered
 * message never has it. `revision` is the workspace revision this render was taken at, so a
 * selection taken here can be told apart from one taken against a later build.
 */
export interface EmailRender {
  readonly revision: RevisionToken;
  readonly subject: string;
  readonly preheader?: string;
  readonly html: string;
  readonly text: string;
  /** Every rendered element in document order, with the source span that produced it. */
  readonly selections: ReadonlyArray<EmailElementSelection>;
}

/** Whether the preview represents the open source revision or the last build that rendered. */
export type EmailPreviewState =
  | { readonly status: "current" }
  | { readonly status: "stale"; readonly reason: string };

/** The TSX entry the editor edits. It is the canonical value for every channel. */
interface TsxOrigin {
  readonly kind: "tsx";
  readonly file: string;
  readonly authoredSource: string;
}

interface DocumentIdentity {
  readonly id: string | null;
  readonly name: string;
  readonly rev: RevisionToken;
  readonly origin: TsxOrigin;
  readonly variables: ReadonlyArray<Variable>;
  readonly metadata: DocumentMetadata;
}

/**
 * One build of the workspace entry, viewed through one of the fixtures the template declares.
 * The SMS and WhatsApp lanes read the same way: the editor reads the form from the authored TSX
 * and previews the render; it never compiles.
 */
interface ChannelContent<TRender> {
  readonly preview: EmailPreviewState;
  /** The fixture names the template declares. Empty when the entry did not build. */
  readonly fixtures: ReadonlyArray<FixtureName>;
  /** The declared fixture being viewed. Null when the template declares none. */
  readonly fixture: FixtureName | null;
  /**
   * Null when the entry did not build, or the declared fixture did not render.
   * `diagnostics` says which, and why; this is a state the editor shows, not an
   * error it reports.
   */
  readonly render: TRender | null;
  /** Compile findings for this build. */
  readonly diagnostics: ReadonlyArray<EmailDiagnostic>;
}

interface EmailContent extends ChannelContent<EmailRender> {
  readonly channel: "email";
  /** Target-client findings across the declared fixtures. */
  readonly incompatibilities: ReadonlyArray<EmailDiagnostic>;
}

/**
 * One render of the SMS channel from the template's IR: the message text a recipient would read
 * for the viewed fixture.
 */
export interface SmsRender {
  readonly revision: RevisionToken;
  readonly text: string;
}

/** A rendered WhatsApp button; a conditional button that did not apply is absent. */
export type WhatsAppRenderedButton =
  | { readonly type: "quick-reply"; readonly text: string }
  | { readonly type: "url"; readonly text: string; readonly url: string }
  | { readonly type: "phone"; readonly text: string; readonly phone: string }
  | { readonly type: "copy-code"; readonly code: string };

/**
 * One render of the WhatsApp channel from the template's IR, mirroring what the renderer returns:
 * every text rendered and every conditional button resolved. For a media header `text` is the
 * media URL.
 */
export interface WhatsAppRender {
  readonly revision: RevisionToken;
  readonly name?: string;
  readonly language: string;
  readonly category: string;
  readonly header?: {
    readonly type: "text" | "image" | "video" | "document";
    readonly text: string;
  };
  readonly body: string;
  readonly footer?: string;
  readonly buttons: ReadonlyArray<WhatsAppRenderedButton>;
}

interface SmsContent extends ChannelContent<SmsRender> {
  readonly channel: "sms";
}

interface WhatsAppContent extends ChannelContent<WhatsAppRender> {
  readonly channel: "whatsapp";
}

interface EditableAccess {
  readonly access: { readonly kind: "editable" };
}

interface ReadonlyAccess {
  readonly access: { readonly kind: "readonly"; readonly reason: string };
}

export interface EditableEmailDocument extends DocumentIdentity, EmailContent, EditableAccess {}
export interface EditableSmsDocument extends DocumentIdentity, SmsContent, EditableAccess {}
export interface EditableWhatsAppDocument
  extends DocumentIdentity, WhatsAppContent, EditableAccess {}
export interface ReadonlyEmailDocument extends DocumentIdentity, EmailContent, ReadonlyAccess {}
export interface ReadonlySmsDocument extends DocumentIdentity, SmsContent, ReadonlyAccess {}
export interface ReadonlyWhatsAppDocument
  extends DocumentIdentity, WhatsAppContent, ReadonlyAccess {}

export type EditableEditorDocument =
  | EditableEmailDocument
  | EditableSmsDocument
  | EditableWhatsAppDocument;
export type ReadonlyEditorDocument =
  | ReadonlyEmailDocument
  | ReadonlySmsDocument
  | ReadonlyWhatsAppDocument;
export type EditorDocument = EditableEditorDocument | ReadonlyEditorDocument;

/** The email projection of a document, or null when this document is another channel. */
export const emailContentOf = (
  document: EditorDocument,
): EditableEmailDocument | ReadonlyEmailDocument | null =>
  document.channel === "email" ? document : null;

/**
 * A save unit. `authoredSource` replaces the canonical TSX entry and carries
 * `baseRev` for conflict detection. `metadata` patches envelope
 * defaults and the name; it is unversioned, so it carries no `baseRev`.
 */
export type DocumentUpdate =
  | {
      readonly kind: "authoredSource";
      readonly baseRev: RevisionToken;
      readonly authoredSource: string;
    }
  | {
      readonly kind: "metadata";
      readonly patch: {
        readonly name?: string | undefined;
        readonly fromDefault?: FromDefault | null | undefined;
        readonly replyToDefault?: ReadonlyArray<string> | null | undefined;
      };
    };

interface ChangeFields {
  readonly rev: RevisionToken;
  /**
   * `origin` distinguishes the editor's own saves (`self`) from agent edits
   * (`agent`) and everything external (`external` — file watcher, another tab,
   * collaboration).
   */
  readonly origin: "self" | "agent" | "external";
  /** The canonical TSX at this revision, when the host knows it. */
  readonly authoredSource?: string | undefined;
}

/**
 * A change pushed by the host through the stream returned by
 * {@link DocumentReader.open}. Every change carries the complete channel content
 * at `rev`: the host owns render truth, so a build that failed arrives as a null
 * render with diagnostics rather than as a missing field. Metadata saves emit no
 * change at all (see {@link DocumentWriter.save}).
 */
export interface EmailDocumentChange extends ChangeFields, EmailContent {}
export interface SmsDocumentChange extends ChangeFields, SmsContent {}
export interface WhatsAppDocumentChange extends ChangeFields, WhatsAppContent {}
export type DocumentChange = EmailDocumentChange | SmsDocumentChange | WhatsAppDocumentChange;

/** The last known revision no longer matches the host's — the editor must adopt the host's revision before retrying. */
export class DocumentConflict extends Data.TaggedError("DocumentConflict")<{
  readonly expectedRev: RevisionToken;
  readonly actualRev: RevisionToken;
}> {}

/** The document cannot be loaded or saved at all (no store, transport down, permission). */
export class DocumentUnavailable extends Data.TaggedError("DocumentUnavailable")<{
  readonly reason: string;
}> {}

export type DocumentError = DocumentConflict | DocumentUnavailable;

export interface ProjectCommit {
  readonly commit: string;
  readonly tree: string;
  readonly parentCommit: string | null;
  readonly message: string;
  readonly committedAt: Date;
  readonly isHead: boolean;
  readonly isPublished: boolean;
}

export interface ProjectFile {
  readonly path: string;
  readonly binary?: boolean;
  readonly status: "clean" | "added" | "modified" | "deleted" | "conflicted";
  readonly content: string | null;
}

export interface ProjectConflict {
  readonly path: string;
  readonly base: string | null;
  readonly draft: string | null;
  readonly main: string | null;
}

export interface ProjectLifecycleState {
  readonly rev: RevisionToken;
  readonly baseCommit: string;
  readonly remoteHead: string;
  readonly dirty: boolean;
  readonly files: ReadonlyArray<ProjectFile>;
  readonly conflicts: ReadonlyArray<ProjectConflict>;
  readonly commits: ReadonlyArray<ProjectCommit>;
}

export interface PublishedProjectCommit {
  readonly publicationId: string;
  readonly commit: string;
  readonly publishedAt: Date;
}

/** A persisted-template lifecycle operation could not be completed. */
export class LifecycleUnavailable extends Data.TaggedError("LifecycleUnavailable")<{
  readonly reason: string;
}> {}

/** An add named a path the project already holds. Replacing that file may succeed. */
export class ProjectFileExists extends Data.TaggedError("ProjectFileExists")<{
  readonly path: string;
  readonly reason: string;
}> {}

/** Binary image payload for {@link AssetApi.uploadImage}. */
export interface UploadImageInput {
  readonly name: string;
  readonly contentType: string;
  readonly data: Uint8Array;
}

export interface UploadedImage {
  readonly url: string;
}

export interface FontEntry {
  readonly family: string;
  readonly fallback: string;
}

export interface EditorEvent {
  readonly name: string;
  readonly data?: { readonly [key: string]: unknown } | undefined;
}

/** Handle returned by {@link AsyncDocumentReader.open}: the initial document and a teardown for the subscription. */
export interface OpenedDocument<TDocument extends EditorDocument = EditorDocument> {
  readonly initial: TDocument;
  readonly close: () => void;
}

export interface AsyncDocumentReader<TDocument extends EditorDocument = EditorDocument> {
  /**
   * Attach to the document. Resolves only after the change subscription is live,
   * so a change published immediately after the returned promise settles is
   * delivered to `onChange` rather than lost. `close` tears the subscription down
   * and synchronously stops all callbacks — none fires after it returns.
   *
   * `onComplete` fires if the host's change stream ENDS on its own (document
   * deleted, session over) — a signal for a "session ended" UI. It is NOT called
   * by `close()`.
   */
  open(
    onChange: (change: DocumentChange) => void,
    onError?: (error: DocumentError) => void,
    onComplete?: () => void,
  ): Promise<OpenedDocument<TDocument>>;
}

export interface AsyncDocumentWriter {
  save(update: DocumentUpdate): Promise<{ readonly rev: RevisionToken }>;
}

export interface AsyncAssetApi {
  uploadImage(input: UploadImageInput): Promise<UploadedImage>;
  fonts: {
    catalog(): Promise<ReadonlyArray<FontEntry>>;
  };
}

export interface AsyncFixtureApi {
  view(fixture: string): Promise<void>;
}

export interface AsyncLifecycleApi {
  inspect(): Promise<ProjectLifecycleState>;
  publish(input: {
    readonly baseRev: RevisionToken;
    readonly commit: string;
  }): Promise<PublishedProjectCommit>;
  restore(input: { readonly commit: string; readonly baseRev: RevisionToken }): Promise<{
    readonly rev: RevisionToken;
    readonly authoredSource: string;
  }>;
  resolveConflict(input: {
    readonly path: string;
    readonly baseRev: RevisionToken;
    readonly resolution: "draft" | "main" | { readonly content: string | null };
  }): Promise<ProjectLifecycleState>;
  updateFile(input: {
    readonly path: string;
    readonly baseRev: RevisionToken;
    readonly content: string | null;
  }): Promise<ProjectLifecycleState>;
  putAsset(input: {
    readonly path: string;
    readonly baseRev: RevisionToken;
    readonly bytes: Uint8Array;
    readonly replace: boolean;
  }): Promise<ProjectLifecycleState>;
}

/**
 * Save the draft as a version (a Git commit) and read whether the open revision already is one.
 * A host offers it apart from `lifecycle`, because a draft can be saved where nothing is published.
 */
export interface AsyncVersionsApi {
  /** Commit the draft at `revision` and resolve the revision that now names the saved head. */
  save(revision: RevisionToken): Promise<RevisionToken>;
  /** The open revision when it equals the saved head, or null while the draft differs from it. */
  savedRevision(): Promise<RevisionToken | null>;
}

interface AsyncEditorHostCapabilities {
  readonly contractVersion: typeof contractVersion;
  readonly sourceAccess: "editable" | "readonly";
  /** A host that saves source but has no metadata writer declares that limitation. */
  readonly metadataAccess?: "editable" | "readonly" | undefined;
  readonly assets?: Capability<AsyncAssetApi> | undefined;
  readonly fixtures?: Capability<AsyncFixtureApi> | undefined;
  readonly lifecycle?: Capability<AsyncLifecycleApi> | undefined;
  readonly versions?: Capability<AsyncVersionsApi> | undefined;
  readonly telemetry?: ((event: EditorEvent) => void) | undefined;
}

export interface AsyncEditableEditorHost extends AsyncEditorHostCapabilities {
  readonly access: "editable";
  readonly document: AsyncDocumentReader<EditableEditorDocument>;
  readonly writer: AsyncDocumentWriter;
}

export interface AsyncReadonlyEditorHost extends AsyncEditorHostCapabilities {
  readonly access: "readonly";
  readonly document: AsyncDocumentReader<ReadonlyEditorDocument>;
  readonly writer?: never | undefined;
}

export type AsyncEditorHost = AsyncEditableEditorHost | AsyncReadonlyEditorHost;
