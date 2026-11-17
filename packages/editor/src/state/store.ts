import type {
  Capability,
  DocumentChange,
  EditorDocument,
  EmailRender,
  PageRender,
  RenderTarget,
  FromDefault,
  RevisionToken,
  SavedVersion,
} from "@samva/editor/host";
import type {
  AsyncAssetApi,
  AsyncEditorHost,
  AsyncFixtureApi,
  AsyncLifecycleApi,
  AsyncVersionsApi,
  EditorEvent,
} from "@samva/editor/host";
import { DocumentUnavailable, isPageRender } from "@samva/editor/host";
import {
  applySourceReplacements,
  inspectMarkdownNode,
  type SourceElement,
  type SourceReplacement,
} from "@samva/markup/edit";
import { Predicate } from "effect";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { DeviceMode } from "../canvas/device";
import {
  outlineAncestry,
  outlineBreadcrumb,
  type Crumb,
  type EmailOutline,
} from "../chrome/email-outline";
import { friendlyName, occurrenceNote } from "../chrome/friendly";
import {
  type SizeSource,
  deriveDocumentState,
  documentChecks,
  resolveSelection,
  withDocumentChange,
  withAuthoredSource,
} from "./derive";
import { markdownEdit } from "./markdown-edit";
import { createEditorSpine, type EditorSpine } from "./spine";
import { correspondingPath } from "./target-map";
import {
  DOCUMENT_SELECTION,
  ENVELOPE_SELECTION,
  type CheckItem,
  type EditorPin,
  type EditorSelection,
} from "./types";

export type EditorLayoutMode = "wide" | "standard" | "compact" | "narrow";
/**
 * The tabs of the work pane beside a docked assistant. Preview is always open; the rest are
 * added from its "+" menu and closed again. "review" is the host's own review surface, offered
 * only when the host docks one.
 */
export type WorkTab = "preview" | "source" | "design" | "review" | "checks";
/** A work-pane tab the author adds and closes. */
export type AddedWorkTab = Exclude<WorkTab, "preview">;
/** Every addable tab, in the order the "+" menu lists them and the tab bar keeps them. */
export const ADDED_WORK_TABS: ReadonlyArray<AddedWorkTab> = [
  "source",
  "design",
  "review",
  "checks",
];
/** The pane a docked workspace shows when its frame is too narrow for both. */
export type FocusedPane = "assistant" | "preview";
/** Canvas zoom: fit to the pane, or a percentage between {@link ZOOM_MIN} and {@link ZOOM_MAX}. */
export type CanvasZoom = "fit" | number;
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;

export const DEVICE_WIDTH: Record<DeviceMode, number> = {
  desktop: 600,
  mobile: 375,
};

const LEFT_KEY = "samva.editor.leftWidth";
const ASSISTANT_KEY = "samva.editor.assistantWidth";
const RIGHT_KEY = "samva.editor.rightWidth";
const CHAT_COLLAPSED_KEY = "samva.editor.chatCollapsed";
const WORK_TABS_KEY = "samva.editor.workTabs";
const WORK_TAB_KEY = "samva.editor.workTab";
const LEFT_DEFAULT = 260;
const ASSISTANT_DEFAULT = 420;
const RIGHT_DEFAULT = 320;
const LEFT_MIN = 200;
const LEFT_MAX = 420;
export const ASSISTANT_MIN = 280;
export const ASSISTANT_MAX = 640;
/** Dragging the chat divider narrower than this collapses the chat instead of clamping it. */
export const CHAT_COLLAPSE_BELOW = 140;
const RIGHT_MIN = 260;
const RIGHT_MAX = 440;

/**
 * How a click on the email reads: point the assistant at an element, edit it in Design, or drop
 * a pin for the next message.
 */
export type CanvasMode = "point" | "design" | "pin";

/** The preview before the first Design edit since the last saved version, which Compare shows. */
export interface DesignBase {
  /** The authored entry before the first edit. */
  readonly source: string;
  readonly render: EmailRender | null;
}

/** A version this session saved: the revision and number the host names it by, and the entry it holds. */
export interface EditorSavedVersion extends SavedVersion {
  readonly source: string;
}

/** Saving the draft as a version through the host's `versions`. */
export interface VersionState {
  readonly status: "idle" | "saving" | "failed";
  /** Why the last save failed; null otherwise. */
  readonly reason: string | null;
  /** The last version this session saved. */
  readonly saved: EditorSavedVersion | null;
  /**
   * The host's answer to whether the open revision is its saved version (`savedRevision`), with
   * the revision it answered for. Asked again whenever the revision moves.
   */
  readonly head: {
    readonly revision: RevisionToken;
    readonly saved: SavedVersion | null;
  } | null;
  /**
   * Where the draft last matched what this session counts from (it opened, or saved a version)
   * on the undo history; see {@link changeCount}. Null once the draft holds changes it did not
   * count, such as an assistant's or a restored version's.
   */
  readonly mark: HistoryMark | null;
}

/**
 * A point on the undo history: `depth` is the history's length there, and `fork` the deepest
 * entry it still shares with the current history. A new edit made below `depth` discards the
 * redo entries that led back to it, so the path to it runs down to `fork` and up again.
 */
export interface HistoryMark {
  readonly depth: number;
  readonly fork: number;
}

const markAt = (depth: number): HistoryMark => ({ depth, fork: depth });

/** The mark after a new entry is pushed onto a history `length` deep. */
const markAfterPush = (mark: HistoryMark | null, length: number): HistoryMark | null =>
  mark === null || length >= mark.depth ? mark : { ...mark, fork: Math.min(mark.fork, length) };

/**
 * The changes between the draft and the point the session counts from, in undo steps: an undo
 * after a save is one change, and its redo is none. Null when the draft holds changes this
 * session did not count.
 */
export const changeCount = (state: Pick<EditorState, "version" | "undoHistory">): number | null => {
  const { mark } = state.version;
  if (mark === null) return null;
  const length = state.undoHistory.length;
  return mark.fork >= Math.min(length, mark.depth)
    ? Math.abs(length - mark.depth)
    : mark.depth - mark.fork + (length - mark.fork);
};

/** The element an edit from the element controls targets: one rendered instance and one origin. */
export interface DesignEditTarget {
  readonly instancePath: string;
  /** Which of the element's origins the edit changes (the element, or a call site). */
  readonly originIndex: number;
}

/** The last edit made from the element controls, and the control that made it. */
export interface DesignEdit extends DesignEditTarget {
  /** The control, such as `color.text` or `size`; null when the edit names none. */
  readonly field: string | null;
}

/** The element the assistant is pointed at, pinned to the render it was chosen in. */
export interface AssistantTarget extends DesignEditTarget {
  readonly revision: RevisionToken;
  readonly fixture: string;
}

/** Where the draft stands against its saved versions, as the status bar and the assistant say it. */
export type SaveStatus =
  | { readonly kind: "loading" }
  /** The host has not said yet whether the open revision is a saved version. */
  | { readonly kind: "checking" }
  | { readonly kind: "unsaved"; readonly changes: number | null }
  /** A version is being saved; without `versions`, the draft itself is being written. */
  | { readonly kind: "saving" }
  /** The draft is a saved version; without `versions`, the draft is written. */
  | { readonly kind: "saved"; readonly number?: number | undefined }
  | {
      readonly kind: "failed";
      readonly reason: string;
      /** What retrying does: save the version again, write the draft again, or reload it. */
      readonly retry: "version" | "draft" | "reload";
    };

/** The undo key of Source-tab typing, and how long a pause ends one burst of it. */
const SOURCE_TYPING = "source-typing";
const SOURCE_TYPING_GROUP_MS = 1000;

const LOADING: SaveStatus = { kind: "loading" };
const CHECKING: SaveStatus = { kind: "checking" };
const SAVING: SaveStatus = { kind: "saving" };
const DRAFT_SAVED: SaveStatus = { kind: "saved" };

/** The host's saved version for `revision`, when the host or this session saved it. */
const savedVersionAt = (version: VersionState, revision: RevisionToken): SavedVersion | null => {
  if (version.head?.revision === revision && version.head.saved !== null) return version.head.saved;
  return version.saved?.revision === revision ? version.saved : null;
};

/**
 * Where the draft stands. With `versions`, the draft is saved (it is a version), unsaved (it holds
 * changes no version has), saving, or failed; without it, the status reports the draft's own
 * writes. A draft that cannot be written, or that changed elsewhere under an edit, is failed
 * either way.
 */
export const saveStatus = (
  state: Pick<
    EditorState,
    | "doc"
    | "pendingAuthoredSource"
    | "conflict"
    | "storageError"
    | "version"
    | "versionsCapability"
    | "undoHistory"
  >,
): SaveStatus => {
  const { doc, version } = state;
  if (doc === null) return LOADING;
  if (state.conflict)
    return { kind: "failed", reason: "This template changed somewhere else.", retry: "reload" };
  if (state.storageError !== null)
    return { kind: "failed", reason: state.storageError, retry: "draft" };
  const settled = state.pendingAuthoredSource === null;
  if (state.versionsCapability?.status !== "ready") return settled ? DRAFT_SAVED : SAVING;
  if (version.status === "saving") return SAVING;
  if (version.status === "failed")
    return {
      kind: "failed",
      reason: version.reason ?? "The version could not be saved.",
      retry: "version",
    };
  const atRevision = savedVersionAt(version, doc.rev);
  if (settled && atRevision !== null) return { kind: "saved", number: atRevision.number };
  // Undoing back to what this session saved is the saved version again, whatever its revision,
  // while every change since is one this session counted: a change to another project file (a
  // theme or a shared part) leaves the entry as saved but not the version.
  if (
    settled &&
    version.mark !== null &&
    version.saved !== null &&
    version.saved.source === doc.origin.authoredSource
  )
    return { kind: "saved", number: version.saved.number };
  const changes = changeCount(state);
  if (version.head?.revision !== doc.rev && (changes ?? 0) === 0 && settled) return CHECKING;
  return { kind: "unsaved", changes };
};

/** The edit from the element controls still on its way to the preview, if there is one. */
export const pendingDesignEdit = (
  state: Pick<EditorState, "pendingAuthoredSource" | "lastDesignEdit">,
): DesignEdit | null => (state.pendingAuthoredSource === null ? null : state.lastDesignEdit);

/** A failure's own words, for "Couldn't save: …". */
export const reasonOf = (cause: unknown, fallback: string): string => {
  if (
    Predicate.hasProperty(cause, "reason") &&
    typeof cause.reason === "string" &&
    cause.reason !== ""
  )
    return cause.reason;
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
};

const readStored = (key: string): string | null => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Browser localStorage adapter boundary (not Effect domain): access throws in private mode / SSR, so fall back to the default.
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string): void => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Browser localStorage adapter boundary (not Effect domain): writes throw in private mode / SSR, where persistence is simply best-effort.
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage is unavailable (private mode, SSR) — persistence is best-effort.
  }
};

const readStoredWidth = (key: string, fallback: number): number => {
  const value = readStored(key);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const writeStoredWidth = (key: string, value: number): void => writeStored(key, String(value));

const isAddedWorkTab = (value: unknown): value is AddedWorkTab =>
  ADDED_WORK_TABS.some((tab) => tab === value);

/** The added tabs a previous session left open, in tab-bar order; unknown names are dropped. */
const readStoredWorkTabs = (): ReadonlyArray<AddedWorkTab> => {
  const value = readStored(WORK_TABS_KEY);
  if (value === null) return [];
  const names = new Set(value.split(","));
  return ADDED_WORK_TABS.filter((tab) => names.has(tab));
};

const readStoredWorkTab = (open: ReadonlyArray<AddedWorkTab>): WorkTab => {
  const value = readStored(WORK_TAB_KEY);
  return isAddedWorkTab(value) && open.includes(value) ? value : "preview";
};

const clampAssistantWidth = (width: number): number =>
  Math.min(ASSISTANT_MAX, Math.max(ASSISTANT_MIN, Math.round(width)));

const clampZoom = (zoom: CanvasZoom): CanvasZoom =>
  zoom === "fit" ? zoom : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom)));

/**
 * Every mutator, grouped under one object created at store init so its identity
 * is stable forever — `useEditorStore((s) => s.actions)` never re-renders.
 */
export interface EditorActions {
  /** Read the selected content through the host's project lifecycle. */
  readonly inspectMarkdown: (instancePath: string) => Promise<SourceElement | null>;
  /** Save plain text through the host; consecutive typing is debounced into one edit. */
  readonly editMarkdownText: (instancePath: string, text: string) => void;
  readonly applySourceEdit: (input: {
    readonly revision: string;
    readonly source: string;
    readonly edits: readonly SourceReplacement[];
    /**
     * Set by an edit computed against the current draft rather than a render, such as a form
     * field. Such an edit does not wait for the last save to be answered, and consecutive edits
     * under one key are one save and one undo step.
     */
    readonly coalesceKey?: string | undefined;
    /**
     * A visual edit from Design or the element controls: what it does, and the control that made
     * it (`color.text`, `size`), which shows as pending until the preview holds the edit. Its
     * first edit since the last saved version keeps the preview for Compare.
     */
    readonly design?: { readonly label: string; readonly field?: string | undefined } | undefined;
    /**
     * The element the edit was computed for. While an earlier edit is on its way to the preview,
     * only an edit to the same element and origin is taken: its own start does not move when its
     * attributes or children change, so its origin still points at it in the source the editor
     * holds.
     */
    readonly target?: DesignEditTarget | undefined;
  }) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly openSource: () => void;
  /**
   * Point the assistant at the selected element, at one of its origins, and bring the chat into
   * view. In Design and pin mode this is the only way a selection reaches the assistant.
   */
  readonly requestSourceAssistance: (originIndex: number) => void;
  /** Open Assistant with one exact finding from the current draft. */
  readonly requestDiagnosticAssistance: (check: CheckItem) => void;
  /** The one write path: replace the open source file and persist it through the spine. */
  readonly replaceAuthoredSource: (source: string) => void;
  /** Show another declared fixture. A re-render at the same revision, not a document edit. */
  readonly viewFixture: (fixture: string) => void;
  /**
   * Preview the email or the web page. A web page needs the host's `render`; without it the
   * target stays on email. The selection is kept: it resolves to the same authored element in
   * either render.
   */
  readonly setPreviewTarget: (target: RenderTarget) => void;
  /**
   * Select the element a click in the web page landed on. Resolves the page's path to the email
   * path the selection is kept in, and clears the selection when the email has no such element.
   */
  readonly selectFromPage: (pagePath: string) => void;
  /** Discard local edits and re-open the document from the host's current state. */
  readonly reload: () => void;
  /**
   * Resolves once the async persist queue is empty and the last save has acked, so
   * a publish reads the just-saved source rather than a pre-save snapshot. Resolves
   * immediately when nothing is pending.
   */
  readonly flushSaves: () => Promise<RevisionToken>;
  /** Acquire the synchronous gate used around a host-owned lifecycle operation. */
  readonly beginLifecycle: () => boolean;
  /** Release the lifecycle gate after the host operation and local adoption settle. */
  readonly endLifecycle: () => void;
  /** Adopt the revision and authored entry returned by a persisted lifecycle operation. */
  readonly adoptLifecycleSnapshot: (input: {
    readonly rev: RevisionToken;
    readonly authoredSource: string;
  }) => void;
  /** Re-attempt the queued saves after a storage failure — non-destructive, keeps the source. */
  readonly retrySave: () => void;
  /**
   * Save the draft as a version through the host's `versions`: flush the draft, save it unless
   * the open revision already is the saved version, and resolve the saved revision. One save runs
   * at a time; a second call shares it. Rejects with the reason, also shown in the status bar,
   * when it fails. Without `versions` it flushes the draft and resolves its revision.
   */
  readonly saveVersion: () => Promise<RevisionToken>;
  /**
   * Put the draft back to the saved version: the saved head through `lifecycle`, or, without it,
   * the version this session saved. Rejects with the reason when it cannot.
   */
  readonly discardChanges: () => Promise<void>;

  /** Select one rendered instance; an unknown path falls back to document scope. */
  readonly select: (instancePath: string | null) => void;
  readonly selectDocument: () => void;
  readonly selectEnvelope: () => void;
  readonly toggleLeft: () => void;
  readonly toggleRight: () => void;
  /** Show a work-pane tab, adding it to the tab bar when it is not open yet. */
  readonly openWorkTab: (tab: WorkTab) => void;
  /** Close an added tab. Closing the shown tab shows the one before it. */
  readonly closeWorkTab: (tab: AddedWorkTab) => void;
  /** Collapse or restore the docked chat; the work pane takes the full width while collapsed. */
  readonly setChatCollapsed: (collapsed: boolean) => void;
  /** Switch the pane a docked workspace shows when its frame is too narrow for both. */
  readonly setFocusedPane: (pane: FocusedPane) => void;
  /**
   * Reveal the host's review surface: the work pane opens its Review tab, and a
   * workspace too narrow for both panes shows the work pane. This is the one open
   * path every host deep-link uses.
   */
  readonly openReview: () => void;
  /**
   * Re-open the document from the host and mount the preview again. A no-op while an edit is
   * still on its way to the host, so a refresh never drops it.
   */
  readonly refreshPreview: () => void;
  readonly setWorkspaceView: (view: "visual" | "source") => void;
  readonly setLeftWidth: (width: number) => void;
  readonly setAssistantWidth: (width: number) => void;
  readonly setRightWidth: (width: number) => void;
  readonly setPreviewDevice: (mode: DeviceMode) => void;
  /** Fit, or a percentage clamped to {@link ZOOM_MIN}–{@link ZOOM_MAX}. */
  readonly setCanvasZoom: (zoom: CanvasZoom) => void;
  readonly setLayoutMode: (mode: EditorLayoutMode) => void;
  readonly setRenameActive: (on: boolean) => void;
  readonly rename: (name: string) => void;
  /**
   * Persist envelope defaults (From / Reply-To). Metadata saves return the current
   * rev unchanged and emit no change event, so local `doc.metadata` is updated here
   * from our own patch rather than waiting on the change stream.
   */
  readonly saveMetadata: (patch: {
    readonly fromDefault?: FromDefault | null | undefined;
    readonly replyToDefault?: ReadonlyArray<string> | null | undefined;
  }) => void;
  /** Open or close one layer in the layers list. */
  readonly toggleLayerExpand: (instancePath: string) => void;
  readonly ancestryOf: (instancePath: string) => ReadonlyArray<string>;
  readonly breadcrumbOf: (instancePath: string) => ReadonlyArray<Crumb>;
  readonly setHovered: (instancePath: string | null) => void;

  /** Point, Design or pin mode. Entering Design waits for an assistant turn to finish. */
  readonly setCanvasMode: (mode: CanvasMode) => void;
  /**
   * Show the preview from before the first Design edit since the last saved version, until
   * turned off or the draft moves.
   */
  readonly setDesignCompare: (on: boolean) => void;
  /** Drop a numbered pin on a rendered element of the preview on screen. */
  readonly addPin: (instancePath: string) => void;
  /** Remove one pin; the pins after it move up one number. */
  readonly removePin: (id: string) => void;
  readonly clearPins: () => void;
  readonly setPinNote: (id: string, note: string) => void;

  /** Shell-internal: the host reports an assistant turn at work (`previewBusy`). */
  readonly setHostBusy: (busy: boolean) => void;

  /** Provider-internal: sync a changed host `checks` prop into the merged check list. */
  readonly setHostChecks: (checks: ReadonlyArray<CheckItem>) => void;
}

export interface EditorState {
  readonly sourceEditError: string | null;
  readonly assistantOriginIndex: number;
  readonly undoHistory: readonly {
    readonly before: string;
    readonly after: string;
    /** The coalesce key of the edits merged into this step. */
    readonly key?: string | undefined;
  }[];
  readonly redoHistory: readonly {
    readonly before: string;
    readonly after: string;
    readonly key?: string | undefined;
  }[];
  readonly workspaceView: "visual" | "source";
  // ── document (derived fields computed IN transitions, never in effects/memos)
  readonly doc: EditorDocument | null;
  /**
   * Authored TSX the editor holds that the host has not answered with a render
   * yet. Non-null means what the canvas shows is behind the source rail.
   */
  readonly pendingAuthoredSource: string | null;
  /** True only when the opened document is editable and the host exposes a writer. */
  readonly editable: boolean;
  /** True only when the host allows direct edits in the raw source workspace. */
  readonly sourceEditable: boolean;
  readonly metadataEditable: boolean;
  /** Human-readable source ownership reason shown by read-only chrome. */
  readonly readonlyReason: string | null;
  /** The email render the canvas and the selection resolve against. Null off the email lane. */
  readonly render: EmailRender | null;
  /** The tree of the current render. Null for a non-email document or an unbuilt entry. */
  readonly outline: EmailOutline | null;
  readonly sizeKb: number;
  /** Whether {@link sizeKb} measures the email as sent or the preview HTML. */
  readonly sizeSource: SizeSource;
  /** Host findings merged with host-supplied checks — shared by statusbar and inspector. */
  readonly checks: ReadonlyArray<CheckItem>;
  readonly hostChecks: ReadonlyArray<CheckItem>;
  readonly lifecycleCapability: Capability<AsyncLifecycleApi> | undefined;
  readonly versionsCapability: Capability<AsyncVersionsApi> | undefined;
  /** Where the editor reports what a person did with it. Absent when the host listens for nothing. */
  readonly telemetry: ((event: EditorEvent) => void) | undefined;
  readonly assetsCapability: Capability<AsyncAssetApi> | undefined;
  readonly fixtureCapability: Capability<AsyncFixtureApi> | undefined;
  /** Whether the host renders the web page, so the toggle between targets is offered. */
  readonly pageAvailable: boolean;
  /** The surface the canvas previews. */
  readonly previewTarget: RenderTarget;
  /** The web page for the current revision and fixture; null until the host has rendered it. */
  readonly pageRender: PageRender | null;
  /** The last web page render failed; null when clear. */
  readonly pageError: string | null;
  /** A fixture re-render is in flight. */
  readonly fixtureBusy: boolean;
  /** The last fixture switch failed; null when clear. */
  readonly fixtureError: string | null;
  /** Latest finding explicitly sent from compatibility UI to the host Assistant. */
  readonly diagnosticAssistance: {
    readonly id: number;
    readonly revision: string;
    readonly check: CheckItem;
  } | null;
  // ── selection
  readonly selection: EditorSelection;
  readonly renameActive: boolean;
  /** Layers the author closed. Every authored layer starts open. */
  readonly collapsedLayers: ReadonlySet<string>;
  // ── layout
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  /** The work pane's added tabs, in tab-bar order. Preview is always open and not listed. */
  readonly workTabs: ReadonlyArray<AddedWorkTab>;
  /** The work-pane tab on screen. */
  readonly activeWorkTab: WorkTab;
  /** The docked chat is collapsed and the work pane has the full width. */
  readonly chatCollapsed: boolean;
  /** Which pane a docked workspace too narrow for both is showing. */
  readonly focusedPane: FocusedPane;
  /** The host changed the email while the narrow layout showed the chat; cleared on viewing it. */
  readonly previewUnseen: boolean;
  /** Bumped by a refresh so the preview mounts its document again. */
  readonly previewEpoch: number;
  /** A refresh re-opened the document and its first snapshot has not arrived yet. */
  readonly previewRefreshing: boolean;
  readonly leftWidth: number;
  readonly assistantWidth: number;
  readonly rightWidth: number;
  /** Workspace preview width. */
  readonly previewDevice: DeviceMode;
  readonly canvasZoom: CanvasZoom;
  readonly layoutMode: EditorLayoutMode;
  // ── persistence (renderable outcomes only — rev/queue live in the spine)
  /** A metadata (rename / envelope defaults) save is in flight. */
  readonly metadataSaving: boolean;
  /** The last metadata save failed and the optimistic edit was rolled back; null when clear. */
  readonly metadataError: string | null;
  /** A host-owned lifecycle operation is in flight; local mutations are gated while true. */
  readonly lifecycleBusy: boolean;
  /** The host reported the document changed under an in-flight edit; see reload. */
  readonly conflict: boolean;
  /** A save failed because host storage is full or blocked; the edit is kept in memory. Null when clear. */
  readonly storageError: string | null;
  /** When the host last acknowledged a save of the draft (epoch ms); null until one lands in this session. */
  readonly draftSavedAt: number | null;
  // ── hover (raw candidate; validity is derived in the selector against the outline)
  readonly hoveredCandidatePath: string | null;
  // ── design mode and pins
  readonly canvasMode: CanvasMode;
  /**
   * The preview before the first Design edit, for Compare. Cleared when a version is saved, the
   * draft is replaced, or the draft returns to it.
   */
  readonly designBase: DesignBase | null;
  /** The canvas shows {@link designBase}'s preview. */
  readonly designCompare: boolean;
  /** The last edit from the element controls; see {@link pendingDesignEdit}. */
  readonly lastDesignEdit: DesignEdit | null;
  /** Saving the draft as a version; see {@link saveStatus}. */
  readonly version: VersionState;
  /**
   * The element the assistant is pointed at. In point mode a selection points it; in Design and
   * pin mode only {@link EditorActions.requestSourceAssistance} does. A mode change clears it.
   */
  readonly assistantTarget: AssistantTarget | null;
  readonly pins: ReadonlyArray<EditorPin>;
  /**
   * The host reports an assistant turn at work. Design edits and entering Design wait for it, so
   * a turn and the author never write the email at once.
   */
  readonly hostBusy: boolean;
  readonly actions: EditorActions;
}

export type EditorStore = StoreApi<EditorState>;

/** One editor instance: its store and its persistence spine, created together per mount. */
export interface EditorBundle {
  readonly host: AsyncEditorHost;
  readonly store: EditorStore;
  readonly spine: EditorSpine;
  /**
   * Listen for the user's own selection of an element (a canvas click, an outline row). A document
   * change that rebinds an existing selection to a newer render is not reported, so a host can
   * tell a gesture from the editor keeping up with the document. Pass `undefined` to stop.
   */
  readonly setUserSelectListener: (
    listener: ((selection: UserSelection) => void) | undefined,
  ) => void;
  /** Listen for every change to the pins, with the whole list in tray order. */
  readonly setPinsListener: (
    listener: ((pins: ReadonlyArray<EditorPin>) => void) | undefined,
  ) => void;
}

/** The element the user just selected, pinned to the render it was selected in. */
export interface UserSelection {
  readonly instancePath: string;
  readonly revision: RevisionToken;
  readonly fixture: string;
}

export interface CreateEditorBundleOptions {
  readonly hostChecks: ReadonlyArray<CheckItem>;
  /** The pane a docked workspace too narrow for both shows first. */
  readonly initialPane?: FocusedPane | undefined;
}

const renderOf = (document: EditorDocument | null): EmailRender | null =>
  document !== null && document.channel === "email" ? document.render : null;

export const createEditorBundle = (
  host: AsyncEditorHost,
  options: CreateEditorBundleOptions,
): EditorBundle => {
  // The spine is wired after the store below; nothing dereferences it until an
  // action or the provider's open effect fires, both post-creation.
  let spine!: EditorSpine;
  let userSelectListener: ((selection: UserSelection) => void) | undefined;
  let pinsListener: ((pins: ReadonlyArray<EditorPin>) => void) | undefined;
  let pinSequence = 0;
  let markdownTimer: ReturnType<typeof setTimeout> | undefined;
  let markdownGeneration = 0;
  let markdownSaving = false;
  let markdownEntryRevision: string | null = null;
  let markdownEntrySource: string | null = null;
  // Revision tokens are opaque: retire each one as the writer or change stream advances past it.
  const obsoleteMarkdownRevisions = new Set<string>();
  // Revisions an adopted one replaced while their own render was still on its way. That render,
  // when it lands, shows the adopted revision rather than moving the document back.
  const superseded = new Map<RevisionToken, RevisionToken>();
  const supersede = (from: RevisionToken, to: RevisionToken): void => {
    if (from === to) return;
    for (const [earlier, adopted] of superseded) if (adopted === from) superseded.set(earlier, to);
    superseded.set(from, to);
  };
  const adoptedChange = (change: DocumentChange): DocumentChange => {
    const adopted = superseded.get(change.rev);
    if (adopted === undefined) return change;
    superseded.delete(change.rev);
    return change.channel === "email" && change.render !== null
      ? { ...change, rev: adopted, render: { ...change.render, revision: adopted } }
      : { ...change, rev: adopted };
  };
  let invalidateMarkdown: () => void = () => {};
  let cancelMarkdownWait: (() => void) | undefined;
  // Resolves once every pending Markdown edit is written or dropped.
  let settleMarkdown: () => Promise<void> = () => Promise.resolve();
  let markdownIdleWaiters: Array<() => void> = [];
  const releaseMarkdownWaiters = (): void => {
    const waiters = markdownIdleWaiters;
    markdownIdleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  /**
   * An uneditable host, readonly document, active lifecycle operation, or a refresh still waiting
   * for its reopened snapshot rejects mutations; that snapshot replaces the draft when it lands.
   */
  const gated = (state: EditorState): boolean =>
    host.access !== "editable" ||
    state.doc?.access.kind === "readonly" ||
    state.lifecycleBusy ||
    state.previewRefreshing;

  const sourceEditableFor = (document: EditorDocument | null): boolean =>
    document !== null &&
    host.access === "editable" &&
    host.sourceAccess === "editable" &&
    document.access.kind !== "readonly";

  /**
   * The one document-commit shape: a new doc value plus every projection derived
   * from it, the expanded-layers set seeded on the first outline, and the
   * selection rebound to the render it now points at.
   */
  const committedDocument = (
    state: EditorState,
    doc: EditorDocument,
    pendingAuthoredSource: string | null,
  ): Partial<EditorState> => {
    const derived = deriveDocumentState(doc, state.hostChecks);
    return {
      doc,
      pendingAuthoredSource,
      ...derived,
      render: renderOf(doc),
      selection: resolveSelection(state.selection, doc, state.outline),
      assistantTarget: resolveTarget(state.assistantTarget, doc, state.outline),
    };
  };

  /** Rebind the assistant's element like a selection, or drop it when the element is gone. */
  const resolveTarget = (
    target: AssistantTarget | null,
    doc: EditorDocument,
    outline: EmailOutline | null,
  ): AssistantTarget | null => {
    if (target === null) return null;
    const resolved = resolveSelection({ kind: "element", ...target }, doc, outline);
    if (resolved.kind !== "element") return null;
    return resolved.revision === target.revision && resolved.fixture === target.fixture
      ? target
      : { ...target, revision: resolved.revision, fixture: resolved.fixture };
  };

  /**
   * Move the open document to `rev` without a new render, for a revision the host minted for
   * the source the editor already holds (a saved version, or a save acked after its render).
   * When the render on screen shows that source, it is the render of `rev` too: it, the
   * selection, the assistant's element and the pins move with the revision, so a just-edited
   * element stays current instead of falling behind a render that will not come.
   */
  const movedRevision = (
    state: EditorState,
    rev: RevisionToken,
    authoredSource: string,
  ): Partial<EditorState> | null => {
    const { doc, render } = state;
    if (
      doc === null ||
      doc.channel !== "email" ||
      render === null ||
      state.pendingAuthoredSource !== null ||
      render.revision !== doc.rev ||
      authoredSource !== doc.origin.authoredSource
    )
      return null;
    const from = render.revision;
    const moved = { ...render, revision: rev };
    const { selection, assistantTarget, pageRender } = state;
    return {
      doc: { ...doc, rev, render: moved },
      render: moved,
      selection:
        selection.kind === "element" && selection.revision === from
          ? { ...selection, revision: rev }
          : selection,
      assistantTarget:
        assistantTarget?.revision === from
          ? { ...assistantTarget, revision: rev }
          : assistantTarget,
      pins: state.pins.some((pin) => pin.revision === from)
        ? state.pins.map((pin) => (pin.revision === from ? { ...pin, revision: rev } : pin))
        : state.pins,
      pageRender: pageRender?.revision === from ? { ...pageRender, revision: rev } : pageRender,
    };
  };

  const store: EditorStore = createStore<EditorState>((set, get) => {
    // Our lifecycle gate still accepts typing; pending edits retain identities, never positions.
    const markdownTarget = (instancePath: string, selected = false) => {
      const state = get();
      const { doc, render, selection } = state;
      if (
        host.access !== "editable" ||
        doc?.access.kind === "readonly" ||
        state.previewRefreshing ||
        (state.lifecycleBusy && (!markdownSaving || markdownEntryRevision !== null)) ||
        !state.editable ||
        !state.sourceEditable ||
        state.hostBusy ||
        state.conflict ||
        (state.pendingAuthoredSource !== null &&
          !(markdownSaving && doc?.origin.kind === "markdown")) ||
        doc?.channel !== "email" ||
        doc.fixture === null ||
        render === null ||
        (render.revision !== doc.rev && render.revision !== markdownEntryRevision) ||
        (selected &&
          (selection.kind !== "element" ||
            selection.instancePath !== instancePath ||
            selection.revision !== render.revision ||
            selection.fixture !== doc.fixture))
      )
        return null;
      const element = render.selections.find((entry) => entry.instancePath === instancePath);
      const origin = element?.origins.find((entry) =>
        doc.origin.kind === "markdown"
          ? entry.fileName === doc.origin.file
          : entry.fileName.endsWith(".md"),
      );
      if (element === undefined || origin === undefined) return null;
      const target = { doc, render, fixture: doc.fixture, origin, tag: element.tag };
      if (doc.origin.kind === "markdown")
        return {
          ...target,
          kind: "entry" as const,
          source:
            render.revision === markdownEntryRevision && markdownEntrySource !== null
              ? markdownEntrySource
              : doc.origin.authoredSource,
        };
      if (state.lifecycleCapability?.status !== "ready") return null;
      return { ...target, kind: "project" as const, api: state.lifecycleCapability.api };
    };
    const staleMarkdown = "This content changed. Select it again before editing.";
    const pendingMarkdown = new Map<
      string,
      {
        readonly file: string;
        readonly tag: string;
        readonly fixture: string;
        readonly revision: string;
        readonly text: string;
      }
    >();
    // One element's edit that cannot be applied says why and leaves the others pending; only a
    // unrecoverable failure of the write itself, which every pending edit shares, clears them all.
    const refuseMarkdown = (reason: string): void => set({ sourceEditError: reason });
    const failMarkdown = (reason: string): void => {
      pendingMarkdown.clear();
      refuseMarkdown(reason);
    };
    invalidateMarkdown = () => {
      const hadEdits = markdownSaving || pendingMarkdown.size > 0;
      const ownedGate = markdownSaving && markdownEntryRevision === null;
      markdownGeneration += 1;
      pendingMarkdown.clear();
      if (markdownTimer !== undefined) clearTimeout(markdownTimer);
      markdownTimer = undefined;
      cancelMarkdownWait?.();
      markdownSaving = false;
      markdownEntryRevision = null;
      markdownEntrySource = null;
      set({
        ...(ownedGate ? { lifecycleBusy: false } : {}),
        ...(hadEdits ? { sourceEditError: staleMarkdown } : {}),
      });
      releaseMarkdownWaiters();
    };
    // Keep text typed during an unavailable write until the author's Retry has saved its base.
    // Waiting on the store also lets an external change or disposal cancel the continuation.
    const flushMarkdownSource = (): Promise<RevisionToken> =>
      spine.flushSaves().catch((cause: unknown) => {
        if (get().storageError === null || get().conflict) return Promise.reject(cause);
        return new Promise<boolean>((resolve) => {
          const finish = (ready: boolean) => {
            unsubscribe();
            cancelMarkdownWait = undefined;
            resolve(ready);
          };
          const unsubscribe = store.subscribe((state) => {
            if (state.conflict) finish(false);
            else if (state.storageError === null) finish(true);
          });
          cancelMarkdownWait = () => finish(false);
        }).then((ready) => (ready ? flushMarkdownSource() : Promise.reject(cause)));
      });
    const waitForMarkdownRender = (
      revision: string,
      fixture: string,
      kind: "entry" | "project",
    ): Promise<boolean> =>
      new Promise((resolve) => {
        const matches = () => {
          const { doc, render } = get();
          return doc?.rev === revision && doc.fixture === fixture && render?.revision === revision;
        };
        const finish = (ready: boolean) => {
          if (timer !== undefined) clearTimeout(timer);
          unsubscribe();
          cancelMarkdownWait = undefined;
          resolve(ready);
        };
        // An acknowledged entry save can render slowly; its queued text is still the author's
        // work. Only a source, fixture, or session change cancels it. Project-file edits keep their own timeout.
        const timer = kind === "project" ? setTimeout(() => finish(false), 2000) : undefined;
        const unsubscribe = store.subscribe(() => {
          if (matches()) finish(true);
        });
        cancelMarkdownWait = () => finish(false);
        if (matches()) finish(true);
      });
    const drainMarkdown = (): void => {
      if (markdownSaving || markdownTimer !== undefined) return;
      const next = pendingMarkdown.entries().next();
      if (next.done === true) return releaseMarkdownWaiters();
      const [instancePath, item] = next.value;
      pendingMarkdown.delete(instancePath);
      const target = markdownTarget(instancePath);
      if (
        target === null ||
        target.doc.rev !== item.revision ||
        target.fixture !== item.fixture ||
        target.tag !== item.tag ||
        target.origin.fileName !== item.file
      ) {
        refuseMarkdown(staleMarkdown);
        return drainMarkdown();
      }
      if (target.kind === "project" && !actions.beginLifecycle()) {
        failMarkdown(staleMarkdown);
        return releaseMarkdownWaiters();
      }
      markdownSaving = true;
      markdownEntryRevision = target.kind === "entry" ? item.revision : null;
      markdownEntrySource = target.kind === "entry" ? target.source : null;
      const generation = markdownGeneration;
      void spine
        .flushSaves()
        .then(async () => {
          if (generation !== markdownGeneration) return;
          if (target.kind === "entry") {
            if (get().render !== target.render || get().doc?.rev !== item.revision)
              return refuseMarkdown(staleMarkdown);
            const result = markdownEdit(
              target.source,
              item.file,
              target.origin,
              { kind: "text", text: item.text },
              { tag: item.tag },
            );
            if (!result.ok) return refuseMarkdown(result.reason);
            if (result.edits.length === 0) return;
            const changed = applySourceReplacements(target.source, result.edits, {
              markdown: { file: item.file },
            });
            if (!changed.ok) return refuseMarkdown(changed.reason);
            set(pushedEntry(get(), { before: target.source, after: changed.source }));
            commitSource(changed.source, { markdownSpan: true });
            const revision = await flushMarkdownSource();
            if (generation !== markdownGeneration) return;
            if (get().conflict || get().storageError !== null)
              return failMarkdown("Couldn't save this change. Try again.");
            const ready = await waitForMarkdownRender(revision, item.fixture, target.kind);
            if (generation !== markdownGeneration) return;
            if (!ready) return failMarkdown("Couldn't save this change. Try again.");
            for (const [path, pending] of pendingMarkdown) {
              if (pending.revision === item.revision)
                pendingMarkdown.set(path, { ...pending, revision });
            }
            return;
          }
          const project = await target.api.inspect();
          if (generation !== markdownGeneration) return;
          if (
            markdownTarget(instancePath) === null ||
            get().render !== target.render ||
            get().doc?.fixture !== item.fixture ||
            project.rev !== item.revision
          )
            return refuseMarkdown(staleMarkdown);
          const file = project.files.find((entry) => entry.path === item.file);
          if (file?.content == null || file.binary === true || file.status === "deleted")
            return refuseMarkdown("This content is unavailable. Select it again before editing.");
          const result = markdownEdit(
            file.content,
            file.path,
            target.origin,
            { kind: "text", text: item.text },
            { tag: item.tag },
          );
          if (!result.ok) return refuseMarkdown(result.reason);
          if (result.edits.length === 0) return;
          const changed = applySourceReplacements(file.content, result.edits, {
            markdown: { file: file.path },
          });
          if (!changed.ok)
            return refuseMarkdown("This change cannot keep the text and formatting intact.");
          const written = await target.api.updateFile({
            path: file.path,
            baseRev: project.rev,
            content: changed.source,
          });
          if (generation !== markdownGeneration) return;
          const ready = await waitForMarkdownRender(written.rev, item.fixture, target.kind);
          if (generation !== markdownGeneration) return;
          if (!ready) return failMarkdown("Couldn't save this change. Try again.");
          // Only the exact acknowledged render advances edits taken against this write's base.
          // Each subsequent save resolves its instance again and reads the fresh project file.
          for (const [path, pending] of pendingMarkdown) {
            if (pending.revision === project.rev)
              pendingMarkdown.set(path, { ...pending, revision: written.rev });
          }
        })
        .catch(() => {
          if (generation === markdownGeneration)
            failMarkdown("Couldn't save this change. Try again.");
        })
        .finally(() => {
          if (generation !== markdownGeneration) return;
          markdownSaving = false;
          markdownEntryRevision = null;
          markdownEntrySource = null;
          if (target.kind === "project") actions.endLifecycle();
          drainMarkdown();
        });
    };
    settleMarkdown = () => {
      // Text still inside its typing pause is written now rather than after it.
      if (markdownTimer !== undefined) {
        clearTimeout(markdownTimer);
        markdownTimer = undefined;
        drainMarkdown();
      }
      return !markdownSaving && markdownTimer === undefined && pendingMarkdown.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => markdownIdleWaiters.push(resolve));
    };
    // Typing in the Source tab is one undo step per burst: a keystroke within this long of the
    // last one joins its step.
    let sourceTypingAt = 0;
    type HistoryEntry = EditorState["undoHistory"][number];
    /** A new undo step; any other history change ends a burst of Source typing. */
    const pushedEntry = (state: EditorState, entry: HistoryEntry): Partial<EditorState> => {
      sourceTypingAt = 0;
      return {
        undoHistory: [...state.undoHistory, entry],
        redoHistory: [],
        version: {
          ...state.version,
          mark: markAfterPush(state.version.mark, state.undoHistory.length),
        },
      };
    };
    /**
     * Whether an edit under `key` joins the last undo step: the same key, made on the source the
     * editor holds, and after the last saved version, so a step never spans a save.
     */
    const joinsLastEntry = (state: EditorState, key: string | undefined): boolean => {
      const last = state.undoHistory.at(-1);
      const { mark } = state.version;
      return (
        key !== undefined &&
        last?.key === key &&
        last.after === state.doc?.origin.authoredSource &&
        (mark === null || state.undoHistory.length > mark.depth)
      );
    };
    // The version save in flight; a second call shares it.
    let versionSave: Promise<RevisionToken> | null = null;
    const commitSource = (
      authoredSource: string,
      enqueueOptions?: {
        readonly coalesceKey?: string | undefined;
        readonly markdownSpan?: boolean | undefined;
        /** The element-controls edit this write carries; any other write clears the last one. */
        readonly designEdit?: DesignEdit | undefined;
      },
    ): void => {
      const state = get();
      if (state.doc === null) return;
      if (markdownEntryRevision !== null && enqueueOptions?.markdownSpan !== true)
        invalidateMarkdown();
      // Back where Design started: nothing is left to compare.
      const returned = state.designBase?.source === authoredSource;
      set({
        doc: withAuthoredSource(state.doc, authoredSource),
        pendingAuthoredSource: authoredSource,
        sourceEditError: null,
        lastDesignEdit: enqueueOptions?.designEdit ?? null,
        ...(returned ? { designBase: null, designCompare: false } : {}),
      });
      spine.enqueueAuthoredSource(authoredSource, {
        coalesceKey: enqueueOptions?.coalesceKey ?? "authored-source",
      });
    };
    const history = (direction: "undo" | "redo"): void => {
      const state = get();
      if (gated(state) || !state.sourceEditable || state.conflict || state.doc === null) return;
      const entries = direction === "undo" ? state.undoHistory : state.redoHistory;
      const entry = entries.at(-1);
      if (entry === undefined) return;
      if (state.doc.origin.authoredSource !== (direction === "undo" ? entry.after : entry.before)) {
        set({
          sourceEditError:
            "History conflicts with a newer change. Your current work is kept. Review the saved versions.",
        });
        return;
      }
      set(
        direction === "undo"
          ? {
              undoHistory: entries.slice(0, -1),
              redoHistory: [...state.redoHistory, entry],
              designCompare: false,
            }
          : {
              redoHistory: entries.slice(0, -1),
              undoHistory: [...state.undoHistory, entry],
              designCompare: false,
            },
      );
      sourceTypingAt = 0;
      commitSource(direction === "undo" ? entry.before : entry.after);
    };
    /** The chat a request is addressed to comes into view, in every layout. */
    const revealedChat = (): Partial<EditorState> => {
      writeStored(CHAT_COLLAPSED_KEY, "false");
      return { chatCollapsed: false, focusedPane: "assistant" };
    };
    const initialWorkTabs = readStoredWorkTabs();
    const actions: EditorActions = {
      inspectMarkdown: async (instancePath) => {
        const target = markdownTarget(instancePath, true);
        if (target === null) return null;
        const generation = markdownGeneration;
        if (target.kind === "entry")
          return inspectMarkdownNode(target.source, target.origin.fileName, target.origin, {
            tag: target.tag,
          });
        return target.api.inspect().then(
          (project) => {
            if (
              generation !== markdownGeneration ||
              get().render !== target.render ||
              markdownTarget(instancePath, true) === null ||
              project.rev !== target.doc.rev
            )
              return null;
            const file = project.files.find((entry) => entry.path === target.origin.fileName);
            return file?.content == null || file.binary === true || file.status === "deleted"
              ? null
              : inspectMarkdownNode(file.content, file.path, target.origin, { tag: target.tag });
          },
          () => {
            if (generation === markdownGeneration)
              set({ sourceEditError: "Couldn't read this content. Try again." });
            return null;
          },
        );
      },
      editMarkdownText: (instancePath, text) => {
        const target = markdownTarget(instancePath, true);
        if (target === null) {
          set({
            sourceEditError: "This content cannot be edited right now. Select it again to retry.",
          });
          return;
        }
        set({ sourceEditError: null });
        // The lifecycle has no coalesce key. Only the latest text in a typing burst is saved,
        // and a save that is already running is followed by the latest text typed meanwhile.
        pendingMarkdown.set(instancePath, {
          file: target.origin.fileName,
          tag: target.tag,
          fixture: target.fixture,
          revision: target.render.revision,
          text,
        });
        if (markdownTimer !== undefined) clearTimeout(markdownTimer);
        markdownTimer = setTimeout(() => {
          markdownTimer = undefined;
          drainMarkdown();
        }, 300);
      },
      requestSourceAssistance: (originIndex) => {
        const { selection } = get();
        set({
          assistantOriginIndex: originIndex,
          assistantTarget:
            selection.kind === "element"
              ? {
                  instancePath: selection.instancePath,
                  revision: selection.revision,
                  fixture: selection.fixture,
                  originIndex,
                }
              : null,
          rightCollapsed: false,
          ...revealedChat(),
        });
      },
      requestDiagnosticAssistance: (check) => {
        const state = get();
        if (
          state.doc === null ||
          gated(state) ||
          state.pendingAuthoredSource !== null ||
          state.conflict
        )
          return;
        set({
          diagnosticAssistance: {
            id: (state.diagnosticAssistance?.id ?? 0) + 1,
            revision: state.doc.rev,
            check,
          },
          rightCollapsed: false,
          ...revealedChat(),
        });
      },
      openSource: () => {
        set({ workspaceView: "source" });
        actions.openWorkTab("source");
      },
      undo: () => history("undo"),
      redo: () => history("redo"),
      applySourceEdit: (input) => {
        const state = get();
        if (gated(state) || !state.sourceEditable || state.conflict || state.doc === null) return;
        // While an edit is on its way, the render's origins only still point into the source the
        // editor holds for the element that edit changed.
        const pending = pendingDesignEdit(state);
        const continues =
          input.target !== undefined &&
          pending !== null &&
          pending.instancePath === input.target.instancePath &&
          pending.originIndex === input.target.originIndex;
        if (state.pendingAuthoredSource !== null && input.coalesceKey === undefined && !continues) {
          set({ sourceEditError: "Wait for your last change to reach the preview." });
          return;
        }
        // An edit computed from the render's origins needs that render to show the source it
        // edits (or to be the one its element's own pending edit started from); any other edit
        // is computed against the draft revision.
        const renderCurrent =
          state.pendingAuthoredSource === null && state.render?.revision === state.doc.rev;
        const fresh =
          input.target === undefined
            ? input.revision === state.doc.rev
            : input.revision === state.render?.revision && (renderCurrent || continues);
        if (state.doc.origin.authoredSource !== input.source || !fresh) {
          set({
            sourceEditError:
              "That edit is stale. The preview moved on. Reselect the element and try again.",
          });
          return;
        }
        if (input.design !== undefined && state.hostBusy) {
          set({ sourceEditError: "Design waits for the assistant to finish." });
          return;
        }
        // An edit that would leave the static profile is refused where the author can read why.
        const result = applySourceReplacements(
          input.source,
          input.edits,
          state.doc.origin.kind === "markdown"
            ? { markdown: { file: state.doc.origin.file } }
            : { profile: { entry: state.doc.origin.file } },
        );
        if (!result.ok) {
          set({ sourceEditError: result.reason });
          return;
        }
        if (result.source === input.source) return;
        const last = state.undoHistory.at(-1);
        set({
          ...(last !== undefined && joinsLastEntry(state, input.coalesceKey)
            ? {
                undoHistory: [
                  ...state.undoHistory.slice(0, -1),
                  { before: last.before, after: result.source, key: input.coalesceKey },
                ],
                redoHistory: [],
              }
            : pushedEntry(state, {
                before: input.source,
                after: result.source,
                key: input.coalesceKey,
              })),
          ...(input.design === undefined
            ? {}
            : {
                designBase: state.designBase ?? { source: input.source, render: state.render },
                designCompare: false,
              }),
        });
        sourceTypingAt = 0;
        commitSource(result.source, {
          coalesceKey: input.coalesceKey,
          designEdit:
            input.design === undefined || input.target === undefined
              ? undefined
              : { ...input.target, field: input.design.field ?? null },
        });
      },
      replaceAuthoredSource: (authoredSource) => {
        const state = get();
        if (
          gated(state) ||
          !state.sourceEditable ||
          state.doc === null ||
          authoredSource === state.doc.origin.authoredSource ||
          state.conflict
        ) {
          return;
        }
        const now = Date.now();
        const last = state.undoHistory.at(-1);
        const typing =
          last !== undefined &&
          now - sourceTypingAt < SOURCE_TYPING_GROUP_MS &&
          joinsLastEntry(state, SOURCE_TYPING);
        set(
          typing
            ? {
                undoHistory: [
                  ...state.undoHistory.slice(0, -1),
                  { ...last, after: authoredSource },
                ],
                redoHistory: [],
              }
            : pushedEntry(state, {
                before: state.doc.origin.authoredSource,
                after: authoredSource,
                key: SOURCE_TYPING,
              }),
        );
        commitSource(authoredSource);
        sourceTypingAt = now;
      },

      viewFixture: (fixture) => {
        const state = get();
        const capability = state.fixtureCapability;
        if (
          capability?.status !== "ready" ||
          state.doc === null ||
          state.fixtureBusy ||
          !state.doc.fixtures.includes(fixture) ||
          state.doc.fixture === fixture
        ) {
          return;
        }
        set({ fixtureBusy: true, fixtureError: null });
        void capability.api.view(fixture).then(
          () => set({ fixtureBusy: false }),
          () =>
            set({
              fixtureBusy: false,
              fixtureError: `Couldn't render the ${fixture} fixture.`,
            }),
        );
      },

      setPreviewTarget: (target) => {
        if (target === "web" && host.render === undefined) return;
        if (get().previewTarget === target) return;
        set({ previewTarget: target });
      },

      selectFromPage: (pagePath) => {
        const { pageRender, render } = get();
        // A page from an earlier revision or fixture maps its origins onto the wrong email.
        if (pageRender === null || render === null || pageRender.revision !== render.revision)
          return;
        const emailPath = correspondingPath(pageRender.selections, render.selections, pagePath);
        actions.select(emailPath);
      },

      reload: () => {
        if (get().lifecycleBusy) return;
        if (get().doc?.origin.kind === "markdown") invalidateMarkdown();
        set({ conflict: false, storageError: null, fixtureError: null });
        spine.reload();
      },

      flushSaves: () => spine.flushSaves(),

      beginLifecycle: () => {
        const state = get();
        if (state.doc?.origin.kind === "markdown" && (markdownSaving || pendingMarkdown.size > 0)) {
          set({ sourceEditError: "Your text is still saving. Try again in a moment." });
          return false;
        }
        if (
          state.lifecycleBusy ||
          state.doc === null ||
          host.access !== "editable" ||
          state.doc.access.kind === "readonly"
        ) {
          return false;
        }
        set({ lifecycleBusy: true });
        return true;
      },

      endLifecycle: () => set({ lifecycleBusy: false }),

      adoptLifecycleSnapshot: (input) => {
        const before = get();
        if (before.doc?.origin.kind === "markdown") {
          if (before.doc.rev !== input.rev) obsoleteMarkdownRevisions.add(before.doc.rev);
          if (before.render !== null && before.render.revision !== input.rev)
            obsoleteMarkdownRevisions.add(before.render.revision);
          invalidateMarkdown();
        }
        spine.adoptRev(input.rev);
        sourceTypingAt = 0;
        set((current) => {
          if (current.doc === null) return { conflict: false };
          // A version save in flight keeps its status; a failure no longer applies.
          const same = input.authoredSource === current.doc.origin.authoredSource;
          // The entry as it was under a new revision: another project file changed, so the
          // changes this session counted no longer describe the draft.
          const projectMoved = same && input.rev !== current.doc.rev;
          const version: VersionState = {
            ...current.version,
            ...(current.version.status === "failed" ? { status: "idle", reason: null } : {}),
            ...(projectMoved ? { mark: null } : {}),
          };
          // The same source while its render is still on its way: only the revision moves. The
          // edit stays pending, and its own render, when it lands, is the adopted revision's.
          if (same && current.pendingAuthoredSource !== null) {
            supersede(current.doc.rev, input.rev);
            return {
              doc: { ...current.doc, rev: input.rev },
              conflict: false,
              sourceEditError: null,
              version,
            };
          }
          const settled = { conflict: false, sourceEditError: null, lastDesignEdit: null, version };
          // The same source under a new revision, such as a saved version, keeps its render.
          const moved = movedRevision(current, input.rev, input.authoredSource);
          if (moved !== null) return { ...moved, ...settled };
          const doc = { ...withAuthoredSource(current.doc, input.authoredSource), rev: input.rev };
          // A restore replaces the entry: Compare's base and the change count no longer apply.
          return {
            ...committedDocument(current, doc, null),
            ...settled,
            sourceEditable: sourceEditableFor(doc),
            ...(same
              ? {}
              : {
                  designBase: null,
                  designCompare: false,
                  version: { ...version, mark: null },
                }),
          };
        });
      },

      retrySave: () => {
        if (gated(get())) return;
        spine.retrySave();
      },

      saveVersion: () => {
        if (versionSave !== null) return versionSave;
        const state = get();
        const versions =
          state.versionsCapability?.status === "ready" ? state.versionsCapability.api : undefined;
        // Without versions, keeping the draft is the save: every pending edit written, and refused
        // when a write conflicted or could not be stored.
        if (versions === undefined)
          return settleMarkdown()
            .then(() => spine.flushSaves())
            .then((revision) => {
              const settled = get();
              return settled.doc === null || settled.conflict || settled.storageError !== null
                ? Promise.reject(
                    new DocumentUnavailable({
                      reason:
                        settled.storageError ?? "Your latest changes haven't reached the draft.",
                    }),
                  )
                : revision;
            });
        const { doc } = state;
        if (
          doc !== null &&
          state.pendingAuthoredSource === null &&
          savedVersionAt(state.version, doc.rev) !== null
        ) {
          if (state.version.status === "failed")
            set({ version: { ...state.version, status: "idle", reason: null } });
          return Promise.resolve(doc.rev);
        }
        if (!actions.beginLifecycle())
          return Promise.reject(
            new DocumentUnavailable({
              reason: "Another change is still being saved. Try again in a moment.",
            }),
          );
        set({ version: { ...state.version, status: "saving", reason: null } });
        const saving = spine
          .flushSaves()
          .then(async (revision) => {
            const settled = get();
            // A write that conflicted or could not be stored leaves the draft without the latest
            // changes; a version saved now would not hold them.
            if (settled.doc === null || settled.conflict || settled.storageError !== null)
              return Promise.reject(
                new DocumentUnavailable({
                  reason: settled.storageError ?? "Your latest changes haven't reached the draft.",
                }),
              );
            if (savedVersionAt(settled.version, revision) !== null) {
              set((latest) => ({ version: { ...latest.version, status: "idle", reason: null } }));
              return revision;
            }
            const snapshot = settled.doc;
            const saved = await versions.save(revision);
            const changes = changeCount(get());
            const current = get().doc;
            // Adopt the saved revision only when nothing moved under the save; a later edit owns
            // the revision fence instead.
            if (
              (current?.rev === revision || current?.rev === saved.revision) &&
              current.origin.authoredSource === snapshot.origin.authoredSource
            ) {
              actions.adoptLifecycleSnapshot({
                rev: saved.revision,
                authoredSource: snapshot.origin.authoredSource,
              });
            }
            sourceTypingAt = 0;
            set((latest) => ({
              designBase: null,
              designCompare: false,
              version: {
                status: "idle",
                reason: null,
                saved: { ...saved, source: snapshot.origin.authoredSource },
                head: { revision: saved.revision, saved },
                // Changes count from here; one from elsewhere that landed during the save is not
                // in the version.
                mark:
                  latest.doc?.origin.authoredSource === snapshot.origin.authoredSource
                    ? markAt(latest.undoHistory.length)
                    : null,
              },
            }));
            state.telemetry?.({ name: "version.save", data: { changes: changes ?? 0 } });
            return saved.revision;
          })
          .catch((cause: unknown) => {
            set((latest) => ({
              version: {
                ...latest.version,
                status: "failed",
                reason: reasonOf(cause, "The version could not be saved."),
              },
            }));
            return Promise.reject(cause);
          })
          .finally(() => {
            actions.endLifecycle();
            versionSave = null;
          });
        versionSave = saving;
        return saving;
      },

      discardChanges: async () => {
        const state = get();
        const refuse = (reason: string) => Promise.reject(new DocumentUnavailable({ reason }));
        if (gated(state) || !state.sourceEditable || state.conflict || state.doc === null)
          return refuse("This template can't be changed right now.");
        const lifecycle =
          state.lifecycleCapability?.status === "ready" ? state.lifecycleCapability.api : undefined;
        if (lifecycle === undefined) {
          const saved = state.version.saved;
          if (saved === null) return refuse("There is no saved version to go back to.");
          if (saved.source === state.doc.origin.authoredSource) return;
          set({
            ...pushedEntry(state, { before: state.doc.origin.authoredSource, after: saved.source }),
            version: { ...state.version, mark: markAt(state.undoHistory.length + 1) },
          });
          commitSource(saved.source);
          return;
        }
        if (!actions.beginLifecycle())
          return refuse("Another change is still being saved. Try again in a moment.");
        return spine
          .flushSaves()
          .then(() => lifecycle.inspect())
          .then(async (project) => {
            const head = project.commits.find((commit) => commit.isHead);
            if (head === undefined) return refuse("There is no saved version to go back to.");
            const restored = await lifecycle.restore({
              commit: head.commit,
              baseRev: await spine.flushSaves(),
            });
            actions.adoptLifecycleSnapshot(restored);
            set((latest) => ({
              version: { ...latest.version, mark: markAt(latest.undoHistory.length) },
            }));
          })
          .finally(() => actions.endLifecycle());
      },

      select: (instancePath) => {
        set((current) => {
          const cleared = {
            selection: DOCUMENT_SELECTION,
            ...(current.canvasMode === "point" ? { assistantTarget: null } : {}),
          };
          if (instancePath === null) return cleared;
          const { render, doc } = current;
          if (render === null || doc?.channel !== "email" || doc.fixture === null) return cleared;
          if (!render.selections.some((entry) => entry.instancePath === instancePath))
            return cleared;
          // The layers around a selection open, so the selected row is on screen.
          const collapsed = new Set(current.collapsedLayers);
          if (current.outline !== null) {
            for (const ancestor of outlineAncestry(current.outline, instancePath)) {
              collapsed.delete(ancestor);
            }
          }
          const selection = {
            kind: "element" as const,
            instancePath,
            revision: render.revision,
            fixture: doc.fixture,
          };
          return {
            assistantOriginIndex: 0,
            selection,
            // Pointing is what a click means in point mode; Design and pins point only on request.
            ...(current.canvasMode === "point"
              ? { assistantTarget: { ...selection, originIndex: 0 } }
              : {}),
            collapsedLayers: collapsed,
          };
        });
        const { selection } = get();
        if (selection.kind === "element") {
          userSelectListener?.({
            instancePath: selection.instancePath,
            revision: selection.revision,
            fixture: selection.fixture,
          });
        }
      },
      selectDocument: () =>
        set((current) => ({
          selection: DOCUMENT_SELECTION,
          ...(current.canvasMode === "point" ? { assistantTarget: null } : {}),
        })),
      selectEnvelope: () =>
        set((current) => ({
          selection: ENVELOPE_SELECTION,
          ...(current.canvasMode === "point" ? { assistantTarget: null } : {}),
        })),

      toggleLeft: () => set((current) => ({ leftCollapsed: !current.leftCollapsed })),
      toggleRight: () => set((current) => ({ rightCollapsed: !current.rightCollapsed })),
      openWorkTab: (tab) => {
        const state = get();
        const workTabs =
          tab === "preview" || state.workTabs.includes(tab)
            ? state.workTabs
            : ADDED_WORK_TABS.filter((entry) => entry === tab || state.workTabs.includes(entry));
        if (workTabs === state.workTabs && state.activeWorkTab === tab) return;
        writeStored(WORK_TABS_KEY, workTabs.join(","));
        writeStored(WORK_TAB_KEY, tab);
        set({ workTabs, activeWorkTab: tab });
      },
      closeWorkTab: (tab) => {
        const state = get();
        const index = state.workTabs.indexOf(tab);
        if (index === -1) return;
        const workTabs = state.workTabs.filter((entry) => entry !== tab);
        const activeWorkTab =
          state.activeWorkTab === tab
            ? (state.workTabs[index - 1] ?? "preview")
            : state.activeWorkTab;
        writeStored(WORK_TABS_KEY, workTabs.join(","));
        writeStored(WORK_TAB_KEY, activeWorkTab);
        set({ workTabs, activeWorkTab });
      },
      setChatCollapsed: (collapsed) => {
        if (get().chatCollapsed === collapsed) return;
        writeStored(CHAT_COLLAPSED_KEY, String(collapsed));
        set({ chatCollapsed: collapsed });
      },
      setFocusedPane: (pane) => {
        const state = get();
        if (state.focusedPane === pane && !(pane === "preview" && state.previewUnseen)) return;
        set(
          pane === "preview" ? { focusedPane: pane, previewUnseen: false } : { focusedPane: pane },
        );
      },
      openReview: () => {
        actions.openWorkTab("review");
        set({ focusedPane: "preview", previewUnseen: false });
      },
      refreshPreview: () => {
        const state = get();
        if (
          state.doc === null ||
          state.pendingAuthoredSource !== null ||
          // A metadata save sends no document change, so a snapshot taken before it lands
          // would put the old name or sender defaults back on screen.
          state.metadataSaving ||
          state.conflict ||
          state.lifecycleBusy
        )
          return;
        set({ previewEpoch: state.previewEpoch + 1, previewRefreshing: true });
        spine.reload();
      },
      setWorkspaceView: (view) => set({ workspaceView: view }),
      setLeftWidth: (width) => {
        const clamped = Math.min(LEFT_MAX, Math.max(LEFT_MIN, Math.round(width)));
        writeStoredWidth(LEFT_KEY, clamped);
        set({ leftWidth: clamped });
      },
      setAssistantWidth: (width) => {
        const clamped = clampAssistantWidth(width);
        writeStoredWidth(ASSISTANT_KEY, clamped);
        set({ assistantWidth: clamped });
      },
      setRightWidth: (width) => {
        const clamped = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(width)));
        writeStoredWidth(RIGHT_KEY, clamped);
        set({ rightWidth: clamped });
      },
      setPreviewDevice: (mode) => set({ previewDevice: mode }),
      setCanvasZoom: (zoom) => {
        const next = clampZoom(zoom);
        if (get().canvasZoom !== next) set({ canvasZoom: next });
      },

      // Apply a mode crossing and its dock defaults as one transition so the UI
      // never renders an intermediate mode with the previous mode's panels or
      // zoom. Same-mode calls are no-ops, so in-zone container resizes can never
      // stomp a manual rail toggle.
      setLayoutMode: (mode) => {
        if (get().layoutMode === mode) return;
        if (mode === "wide") {
          set({
            layoutMode: mode,
            leftCollapsed: false,
            rightCollapsed: false,
            canvasZoom: 100,
            previewUnseen: false,
          });
          return;
        }
        if (mode === "standard") {
          set({
            layoutMode: mode,
            leftCollapsed: false,
            rightCollapsed: true,
            canvasZoom: "fit",
          });
          return;
        }
        set({
          layoutMode: mode,
          leftCollapsed: true,
          rightCollapsed: true,
          canvasZoom: "fit",
        });
      },

      setRenameActive: (on) => set({ renameActive: on }),

      rename: (name) => {
        const state = get();
        if (gated(state) || host.access !== "editable" || host.metadataAccess === "readonly")
          return;
        const writer = host.writer;
        const previous = state.doc;
        if (previous === null) return;
        const trimmed = name.trim() || "Untitled template";
        if (trimmed === previous.name) return;
        set((current) =>
          current.doc === null
            ? current
            : {
                doc: { ...current.doc, name: trimmed },
                metadataSaving: true,
                metadataError: null,
              },
        );
        void writer.save({ kind: "metadata", patch: { name: trimmed } }).then(
          () => set({ metadataSaving: false }),
          () => {
            // The save didn't take — roll the name back to the last saved value.
            set((current) => ({
              doc: current.doc === null ? current.doc : { ...current.doc, name: previous.name },
              metadataSaving: false,
              metadataError: "Couldn't save the template name.",
            }));
          },
        );
      },

      saveMetadata: (patch) => {
        const state = get();
        if (gated(state) || host.access !== "editable" || host.metadataAccess === "readonly")
          return;
        const writer = host.writer;
        const previous = state.doc;
        if (previous === null) return;
        set((current) =>
          current.doc === null
            ? current
            : {
                doc: {
                  ...current.doc,
                  metadata: {
                    fromDefault:
                      patch.fromDefault === undefined
                        ? current.doc.metadata.fromDefault
                        : (patch.fromDefault ?? undefined),
                    replyToDefault:
                      patch.replyToDefault === undefined
                        ? current.doc.metadata.replyToDefault
                        : (patch.replyToDefault ?? undefined),
                  },
                },
                metadataSaving: true,
                metadataError: null,
              },
        );
        void writer.save({ kind: "metadata", patch }).then(
          () => set({ metadataSaving: false }),
          () => {
            // The save didn't take — restore the envelope defaults to the saved state.
            set((current) => ({
              doc:
                current.doc === null
                  ? current.doc
                  : { ...current.doc, metadata: previous.metadata },
              metadataSaving: false,
              metadataError: "Couldn't save the sender defaults.",
            }));
          },
        );
      },

      toggleLayerExpand: (instancePath) =>
        set((current) => {
          const next = new Set(current.collapsedLayers);
          if (next.has(instancePath)) next.delete(instancePath);
          else next.add(instancePath);
          return { collapsedLayers: next };
        }),

      ancestryOf: (instancePath) => {
        const { outline } = get();
        return outline === null ? [] : outlineAncestry(outline, instancePath);
      },
      breadcrumbOf: (instancePath) => {
        const { outline } = get();
        return outline === null ? [] : outlineBreadcrumb(outline, instancePath);
      },

      setHovered: (instancePath) => set({ hoveredCandidatePath: instancePath }),

      setCanvasMode: (mode) => {
        const state = get();
        if (state.canvasMode === mode) return;
        if (mode === "design" && state.hostBusy) return;
        set({
          canvasMode: mode,
          designCompare: false,
          hoveredCandidatePath: null,
          // The assistant's element was chosen for the mode being left.
          assistantTarget: null,
        });
      },

      setDesignCompare: (on) => {
        const state = get();
        const next = on && state.designBase?.render != null;
        if (state.designCompare !== next) set({ designCompare: next });
      },

      addPin: (instancePath) => {
        const state = get();
        const { render, doc, outline } = state;
        if (render === null || doc?.channel !== "email" || doc.fixture === null) return;
        const entry =
          outline?.index.get(instancePath) ??
          render.selections.find((candidate) => candidate.instancePath === instancePath);
        if (entry === undefined) return;
        const origin = entry.origins[0];
        pinSequence += 1;
        set({
          pins: [
            ...state.pins,
            {
              id: `pin-${pinSequence}`,
              number: state.pins.length + 1,
              instancePath,
              revision: render.revision,
              fixture: doc.fixture,
              tag: entry.tag,
              label: [friendlyName(entry, doc.origin.authoredSource), occurrenceNote(entry)]
                .filter((part) => part !== undefined)
                .join(" "),
              origin:
                origin === undefined
                  ? null
                  : {
                      fileName: origin.fileName,
                      lineNumber: origin.lineNumber,
                      columnNumber: origin.columnNumber,
                    },
              note: "",
            },
          ],
        });
      },
      removePin: (id) => {
        const state = get();
        if (!state.pins.some((pin) => pin.id === id)) return;
        set({
          pins: state.pins
            .filter((pin) => pin.id !== id)
            .map((pin, index) => (pin.number === index + 1 ? pin : { ...pin, number: index + 1 })),
        });
      },
      clearPins: () => {
        if (get().pins.length > 0) set({ pins: [] });
      },
      setPinNote: (id, note) =>
        set((current) => ({
          pins: current.pins.map((pin) => (pin.id === id ? { ...pin, note } : pin)),
        })),

      setHostBusy: (busy) => {
        if (get().hostBusy !== busy) set({ hostBusy: busy });
      },

      setHostChecks: (nextChecks) => {
        if (Object.is(get().hostChecks, nextChecks)) return;
        set((current) => ({
          hostChecks: nextChecks,
          checks: current.doc === null ? nextChecks : documentChecks(current.doc, nextChecks),
        }));
      },
    };

    return {
      sourceEditError: null,
      assistantOriginIndex: 0,
      undoHistory: [],
      redoHistory: [],
      workspaceView: "visual",
      doc: null,
      pendingAuthoredSource: null,
      editable: host.access === "editable",
      sourceEditable: host.access === "editable" && host.sourceAccess === "editable",
      metadataEditable: host.access === "editable" && host.metadataAccess !== "readonly",
      readonlyReason: null,
      render: null,
      outline: null,
      sizeKb: 0,
      sizeSource: "preview",
      checks: options.hostChecks,
      hostChecks: options.hostChecks,
      lifecycleCapability: host.lifecycle,
      versionsCapability: host.versions,
      telemetry: host.telemetry,
      assetsCapability: host.assets,
      fixtureCapability: host.fixtures,
      pageAvailable: host.render !== undefined,
      previewTarget: "email",
      pageRender: null,
      pageError: null,
      fixtureBusy: false,
      fixtureError: null,
      diagnosticAssistance: null,
      selection: DOCUMENT_SELECTION,
      renameActive: false,
      collapsedLayers: new Set<string>(),
      leftCollapsed: false,
      rightCollapsed: false,
      workTabs: initialWorkTabs,
      activeWorkTab: readStoredWorkTab(initialWorkTabs),
      chatCollapsed: readStored(CHAT_COLLAPSED_KEY) === "true",
      focusedPane: options.initialPane ?? "assistant",
      previewUnseen: false,
      previewEpoch: 0,
      previewRefreshing: false,
      leftWidth: readStoredWidth(LEFT_KEY, LEFT_DEFAULT),
      assistantWidth: clampAssistantWidth(readStoredWidth(ASSISTANT_KEY, ASSISTANT_DEFAULT)),
      rightWidth: readStoredWidth(RIGHT_KEY, RIGHT_DEFAULT),
      previewDevice: "desktop",
      canvasZoom: 100,
      layoutMode: "wide",
      metadataSaving: false,
      metadataError: null,
      lifecycleBusy: false,
      conflict: false,
      storageError: null,
      draftSavedAt: null,
      hoveredCandidatePath: null,
      canvasMode: "point",
      designBase: null,
      designCompare: false,
      lastDesignEdit: null,
      version: { status: "idle", reason: null, saved: null, head: null, mark: markAt(0) },
      assistantTarget: null,
      pins: [],
      hostBusy: false,
      actions,
    };
  });

  const applyChange = (change: DocumentChange, keepLocalEdit: boolean): void => {
    store.setState((current) => {
      if (current.doc === null) return current;
      const pending = keepLocalEdit ? current.pendingAuthoredSource : null;
      const next = withDocumentChange(current.doc, change, pending);
      const settled =
        change.authoredSource !== undefined && change.authoredSource === next.origin.authoredSource;
      // A change the author did not make here lands while a narrow layout shows the chat: mark
      // the preview so the switch says there is something new to look at.
      const unseen =
        change.origin !== "self" &&
        current.layoutMode !== "wide" &&
        current.focusedPane === "assistant";
      return {
        ...committedDocument(current, next, settled ? null : pending),
        ...(unseen ? { previewUnseen: true } : {}),
      };
    });
  };

  spine = createEditorSpine(host, {
    onInitial: (doc) => {
      superseded.clear();
      obsoleteMarkdownRevisions.clear();
      store.setState((current) => ({
        ...committedDocument(current, doc, null),
        previewRefreshing: false,
        editable: host.access === "editable" && doc.access.kind !== "readonly",
        sourceEditable: sourceEditableFor(doc),
        readonlyReason: doc.access.kind === "readonly" ? doc.access.reason : null,
        // A (re)opened document replaces whatever the editor held; counting starts again.
        designBase: null,
        designCompare: false,
        lastDesignEdit: null,
        version: {
          ...current.version,
          ...(current.version.status === "failed" ? { status: "idle", reason: null } : {}),
          mark: markAt(current.undoHistory.length),
        },
      }));
    },
    onPersistedRevision: (rev) => {
      const snapshot = store.getState();
      if (snapshot.doc?.origin.kind === "markdown") {
        if (snapshot.conflict || obsoleteMarkdownRevisions.has(rev)) {
          obsoleteMarkdownRevisions.add(rev);
          return;
        }
        if (snapshot.doc.rev !== rev) obsoleteMarkdownRevisions.add(snapshot.doc.rev);
      }
      store.setState((current) => {
        if (current.doc === null) return current;
        // An ack that names a later revision for the source already on screen keeps the render.
        const moved =
          rev === current.doc.rev
            ? null
            : movedRevision(current, rev, current.doc.origin.authoredSource);
        return { ...(moved ?? { doc: { ...current.doc, rev } }), draftSavedAt: Date.now() };
      });
    },
    // Our own acked save came back with the render the host produced for it.
    // Local text that has moved on since is kept; everything else is the host's.
    onSelfAck: (received) => {
      const change = adoptedChange(received);
      const snapshot = store.getState();
      if (snapshot.doc?.origin.kind === "markdown") {
        if (snapshot.conflict || obsoleteMarkdownRevisions.has(change.rev)) return;
        // A failed view request leaves these edits valid; only the host's confirmed switch cancels them.
        if (snapshot.doc.fixture !== change.fixture) invalidateMarkdown();
        if (snapshot.doc.rev !== change.rev) obsoleteMarkdownRevisions.add(snapshot.doc.rev);
      }
      // A new revision with no entry write of ours on its way and the entry unchanged: another
      // project file changed (a theme or a shared part), which the change count does not cover.
      const projectMoved =
        snapshot.doc !== null &&
        snapshot.pendingAuthoredSource === null &&
        change.rev !== snapshot.doc.rev &&
        (change.authoredSource === undefined ||
          change.authoredSource === snapshot.doc.origin.authoredSource);
      applyChange(change, true);
      if (projectMoved)
        store.setState((current) => ({ version: { ...current.version, mark: null } }));
    },
    onForeignChange: (change, saveInFlight) => {
      const snapshot = store.getState();
      if (snapshot.doc?.origin.kind === "markdown") {
        if (snapshot.doc.rev !== change.rev) obsoleteMarkdownRevisions.add(snapshot.doc.rev);
        if (snapshot.render !== null && snapshot.render.revision !== change.rev)
          obsoleteMarkdownRevisions.add(snapshot.render.revision);
        invalidateMarkdown();
      }
      if (saveInFlight) {
        // Our optimistic base was stale when this landed. Keep the newer local
        // text and surface the conflict rather than replacing it with a remote
        // snapshot the user never saw.
        store.setState((current) =>
          current.doc === null
            ? current
            : {
                doc: { ...current.doc, rev: change.rev },
                sourceEditable: false,
                conflict: true,
              },
        );
        return;
      }
      applyChange(change, false);
      // Someone else's change: the draft is no longer what Design started from, and the count
      // of changes no longer covers it.
      store.setState((current) => ({
        sourceEditable: sourceEditableFor(current.doc),
        designBase: null,
        designCompare: false,
        lastDesignEdit: null,
        version: { ...current.version, mark: null },
      }));
    },
    onConflict: () => store.setState({ conflict: true, sourceEditable: false }),
    onStorageError: (reason) => store.setState({ storageError: reason }),
    // A failed open / dead change stream surfaces through the storage banner;
    // its Retry re-opens the session (the spine routes retrySave by liveness).
    onSessionError: (reason) => store.setState({ storageError: reason, previewRefreshing: false }),
  });

  store.subscribe((state, previous) => {
    if (state.pins !== previous.pins) pinsListener?.(state.pins);
  });

  // Whether the open revision is a saved version is the host's to say; ask whenever it moves.
  let headRequest = 0;
  store.subscribe((state, previous) => {
    const revision = state.doc?.rev;
    const versions = state.versionsCapability;
    if (revision === undefined || revision === previous.doc?.rev || versions?.status !== "ready")
      return;
    headRequest += 1;
    const request = headRequest;
    const answer = (saved: SavedVersion | null) => {
      if (request !== headRequest || store.getState().doc?.rev !== revision) return;
      const found = saved?.revision === revision ? saved : null;
      store.setState((current) => ({
        version: {
          ...current.version,
          head: { revision, saved: found },
          // A draft that is a saved version holds no uncounted changes.
          ...(found !== null && current.pendingAuthoredSource === null
            ? { mark: markAt(current.undoHistory.length) }
            : {}),
        },
      }));
    };
    void versions.api.savedRevision().then(answer, () => answer(null));
  });

  // The web page is the host's render of the same revision and fixture the email shows, so it is
  // requested whenever those change while the page is the previewed target.
  let pageRequest = 0;
  const syncPage = (state: EditorState, previous: EditorState | null) => {
    const render = host.render;
    const { doc } = state;
    if (render === undefined || state.previewTarget !== "web" || doc === null) return;
    const revision = state.render?.revision ?? null;
    const fixture = doc.fixture;
    if (
      previous !== null &&
      previous.previewTarget === "web" &&
      previous.previewEpoch === state.previewEpoch &&
      previous.render?.revision === revision &&
      previous.doc?.fixture === fixture
    ) {
      return;
    }
    if (fixture === null || revision === null) {
      store.setState({ pageRender: null, pageError: null });
      return;
    }
    pageRequest += 1;
    const request = pageRequest;
    void render(doc.origin.file, fixture, "web").then(
      (page) => {
        if (request !== pageRequest) return;
        // Only the page for the render now on screen is kept; any other is for a document the
        // author has moved past.
        const current = page !== null && isPageRender(page) ? page : null;
        const matches = current !== null && current.revision === store.getState().render?.revision;
        store.setState({
          pageRender: matches ? current : null,
          pageError: matches ? null : "Couldn't render the web page.",
        });
      },
      () => {
        if (request !== pageRequest) return;
        store.setState({ pageRender: null, pageError: "Couldn't render the web page." });
      },
    );
  };
  store.subscribe((state, previous) => syncPage(state, previous));

  return {
    host,
    store,
    spine: {
      ...spine,
      dispose: () => {
        markdownGeneration += 1;
        cancelMarkdownWait?.();
        if (markdownTimer !== undefined) clearTimeout(markdownTimer);
        markdownTimer = undefined;
        markdownSaving = false;
        releaseMarkdownWaiters();
        store.setState({ lifecycleBusy: false });
        spine.dispose();
      },
    },
    setUserSelectListener: (listener) => {
      userSelectListener = listener;
    },
    setPinsListener: (listener) => {
      pinsListener = listener;
    },
  };
};
