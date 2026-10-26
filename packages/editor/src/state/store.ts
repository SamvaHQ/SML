import type {
  Capability,
  DocumentChange,
  EditorDocument,
  EmailRender,
  PageRender,
  RenderTarget,
  FromDefault,
  RevisionToken,
} from "@samva/editor/host";
import type {
  AsyncAssetApi,
  AsyncEditorHost,
  AsyncFixtureApi,
  AsyncLifecycleApi,
  AsyncVersionsApi,
  EditorEvent,
} from "@samva/editor/host";
import { isPageRender } from "@samva/editor/host";
import {
  applySourceReplacements,
  inspectMarkdownNode,
  type SourceElement,
  type SourceReplacement,
} from "@samva/markup/edit";
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

/** One staged Design edit: the entry before and after it, and what the author did. */
export interface DesignEdit {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** Consecutive edits under one key (typing in one field) are one staged edit. */
  readonly key?: string | undefined;
}

/**
 * Design edits staged on the draft and not yet applied as a version. Each edit is in the draft
 * the host renders, so the preview shows it; Apply saves them all as one version, Reset writes
 * the entry back to what it was before the first.
 */
export interface DesignDraft {
  /** The authored entry before the first staged edit. */
  readonly baseSource: string;
  /** The preview on screen before the first staged edit, which Compare shows. */
  readonly baseRender: EmailRender | null;
  readonly edits: ReadonlyArray<DesignEdit>;
  /** Edits undone since the last new one, most recent last, for redo. */
  readonly undone: ReadonlyArray<DesignEdit>;
}

export type DesignApplyState =
  | { readonly status: "idle" }
  | { readonly status: "applying" }
  | { readonly status: "failed"; readonly reason: string };

const DESIGN_IDLE: DesignApplyState = { status: "idle" };

const STAGED_EDITS_FIRST = "Apply or reset your Design edits before editing the source.";

/** The name of the version Apply saves. */
export const designVersionMessage = (count: number): string =>
  `Design: ${count} ${count === 1 ? "edit" : "edits"}`;

/**
 * The host's chat waits while this is true: edits are staged, Apply is saving them, or Design
 * is writing the draft (an undo or a reset) and the host has not taken the write yet.
 */
export const designWaiting = (
  state: Pick<EditorState, "designDraft" | "designApply" | "designSettling">,
): boolean =>
  (state.designDraft?.edits.length ?? 0) > 0 ||
  state.designApply.status === "applying" ||
  state.designSettling;

/** Staged Design edits waiting for Apply. */
export const pendingDesignEdits = (state: Pick<EditorState, "designDraft">): number =>
  state.designDraft?.edits.length ?? 0;

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
     * Stage the edit as a Design edit under this label instead of adding it to the source
     * history. The draft still renders it; Apply saves the staged edits as one version.
     */
    readonly design?: { readonly label: string } | undefined;
  }) => void;
  /** Undo and redo also walk the staged Design edits while there are any. */
  readonly undo: () => void;
  readonly redo: () => void;
  readonly openSource: () => void;
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

  /**
   * Point, Design or pin mode. Leaving Design is refused while edits are staged; apply or reset
   * them first.
   */
  readonly setCanvasMode: (mode: CanvasMode) => void;
  /** Write the entry back to what it was before the first staged Design edit. */
  readonly resetDesign: () => void;
  /** Show the preview from before the first staged edit until turned off or the draft moves. */
  readonly setDesignCompare: (on: boolean) => void;
  /** Save the staged Design edits as one version through the host's `versions`. */
  readonly applyDesign: () => void;
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
  /** Staged Design edits; null when nothing has been staged since the last Apply or Reset. */
  readonly designDraft: DesignDraft | null;
  readonly designApply: DesignApplyState;
  /** The canvas shows the preview from before the staged edits. */
  readonly designCompare: boolean;
  /**
   * Design's undo or reset is writing the draft and the writer has not accepted it yet, or the
   * write failed. A reload clears it.
   */
  readonly designSettling: boolean;
  readonly pins: ReadonlyArray<EditorPin>;
  /**
   * The host reports an assistant turn at work. Design edits, entering Design and Apply wait for
   * it, so a turn and the author never write the email at once.
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
  const obsoleteMarkdownRevisions = new Set<string>();
  let invalidateMarkdown: () => void = () => {};
  let cancelMarkdownWait: (() => void) | undefined;

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
        (state.lifecycleBusy && !markdownSaving) ||
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
        return { ...target, kind: "entry" as const, source: doc.origin.authoredSource };
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
    // failure of the write itself, which every pending edit shares, clears them all.
    const refuseMarkdown = (reason: string): void => set({ sourceEditError: reason });
    const failMarkdown = (reason: string): void => {
      pendingMarkdown.clear();
      refuseMarkdown(reason);
    };
    invalidateMarkdown = () => {
      const hadEdits = markdownSaving || pendingMarkdown.size > 0;
      const ownedGate = markdownSaving;
      markdownGeneration += 1;
      pendingMarkdown.clear();
      if (markdownTimer !== undefined) clearTimeout(markdownTimer);
      markdownTimer = undefined;
      cancelMarkdownWait?.();
      markdownSaving = false;
      markdownEntryRevision = null;
      set({
        ...(ownedGate ? { lifecycleBusy: false } : {}),
        ...(hadEdits ? { sourceEditError: staleMarkdown } : {}),
      });
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
    const waitForMarkdownRender = (revision: string, fixture: string): Promise<boolean> =>
      new Promise((resolve) => {
        const matches = () => {
          const { doc, render } = get();
          return doc?.rev === revision && doc.fixture === fixture && render?.revision === revision;
        };
        const finish = (ready: boolean) => {
          clearTimeout(timer);
          unsubscribe();
          cancelMarkdownWait = undefined;
          resolve(ready);
        };
        const timer = setTimeout(() => finish(false), 2000);
        const unsubscribe = store.subscribe(() => {
          if (matches()) finish(true);
        });
        cancelMarkdownWait = () => finish(false);
        if (matches()) finish(true);
      });
    const drainMarkdown = (): void => {
      if (markdownSaving || markdownTimer !== undefined) return;
      const next = pendingMarkdown.entries().next();
      if (next.done === true) return;
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
      if (!actions.beginLifecycle()) return failMarkdown(staleMarkdown);
      markdownSaving = true;
      markdownEntryRevision = target.kind === "entry" ? item.revision : null;
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
            const state = get();
            set({
              undoHistory: [...state.undoHistory, { before: target.source, after: changed.source }],
              redoHistory: [],
            });
            commitSource(changed.source);
            const revision = await flushMarkdownSource();
            if (generation !== markdownGeneration) return;
            if (get().conflict || get().storageError !== null)
              return failMarkdown("Couldn't save this change. Try again.");
            const ready = await waitForMarkdownRender(revision, item.fixture);
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
          const ready = await waitForMarkdownRender(written.rev, item.fixture);
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
          actions.endLifecycle();
          drainMarkdown();
        });
    };
    const commitSource = (
      authoredSource: string,
      enqueueOptions?: { readonly coalesceKey?: string | undefined },
    ): void => {
      const state = get();
      if (state.doc === null) return;
      set({
        doc: withAuthoredSource(state.doc, authoredSource),
        pendingAuthoredSource: authoredSource,
        sourceEditError: null,
      });
      spine.enqueueAuthoredSource(authoredSource, {
        coalesceKey: enqueueOptions?.coalesceKey ?? "authored-source",
      });
    };
    /**
     * Hold the chat until the writer accepts a Design write. The spine's flush resolves once its
     * queue drains; a conflict or a storage failure keeps the hold until a reload or a retry.
     */
    const settleDesignWrite = (): void => {
      set({ designSettling: true });
      spine.flushSaves().then(
        () => {
          const state = get();
          if (!state.conflict && state.storageError === null) set({ designSettling: false });
        },
        () => {},
      );
    };
    const designHistory = (direction: "undo" | "redo", draft: DesignDraft): void => {
      const state = get();
      if (state.doc === null || state.designApply.status === "applying") return;
      const from = direction === "undo" ? draft.edits : draft.undone;
      const entry = from.at(-1);
      if (entry === undefined) return;
      if (state.doc.origin.authoredSource !== (direction === "undo" ? entry.after : entry.before)) {
        set({
          sourceEditError:
            "Your edits conflict with a newer change. Your current work is kept. Review the saved versions.",
        });
        return;
      }
      set({
        designDraft:
          direction === "undo"
            ? { ...draft, edits: draft.edits.slice(0, -1), undone: [...draft.undone, entry] }
            : { ...draft, undone: draft.undone.slice(0, -1), edits: [...draft.edits, entry] },
        designCompare: false,
        designApply: DESIGN_IDLE,
      });
      commitSource(direction === "undo" ? entry.before : entry.after);
      settleDesignWrite();
    };
    /** Record a Design edit on the draft and write it, so the host renders it. */
    const stageDesignEdit = (input: {
      readonly before: string;
      readonly after: string;
      readonly label: string;
      readonly key: string | undefined;
    }): void => {
      const state = get();
      // With every staged edit undone, the next one starts a new draft from the source as it is
      // now: the old base may predate a change made elsewhere since.
      const fresh = state.designDraft === null || state.designDraft.edits.length === 0;
      const draft: DesignDraft = fresh
        ? { baseSource: input.before, baseRender: state.render, edits: [], undone: [] }
        : state.designDraft;
      const last = draft.edits.at(-1);
      const merges =
        input.key !== undefined && last?.key === input.key && last.after === input.before;
      set({
        // A new draft starts a new chronology: the source history before it is kept until Apply
        // folds the batch in as one step, and its redo no longer applies.
        ...(fresh ? { redoHistory: [] } : {}),
        canvasMode: "design",
        designCompare: false,
        designApply: DESIGN_IDLE,
        designDraft: {
          ...draft,
          edits: merges
            ? [
                ...draft.edits.slice(0, -1),
                { label: input.label, before: last.before, after: input.after, key: input.key },
              ]
            : [
                ...draft.edits,
                { label: input.label, before: input.before, after: input.after, key: input.key },
              ],
          undone: [],
        },
      });
      commitSource(input.after, { coalesceKey: input.key });
    };
    const history = (direction: "undo" | "redo"): void => {
      const state = get();
      if (gated(state) || !state.sourceEditable || state.conflict || state.doc === null) return;
      const draft = state.designDraft;
      if (
        draft !== null &&
        (direction === "undo" ? draft.edits.length > 0 : draft.undone.length > 0)
      ) {
        designHistory(direction, draft);
        return;
      }
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
              // Stepping back past a draft's start leaves its undone edits nothing to redo onto.
              designDraft: null,
              undoHistory: entries.slice(0, -1),
              redoHistory: [...state.redoHistory, entry],
            }
          : {
              redoHistory: entries.slice(0, -1),
              undoHistory: [...state.undoHistory, entry],
            },
      );
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
      requestSourceAssistance: (originIndex) =>
        set({
          assistantOriginIndex: originIndex,
          rightCollapsed: false,
          ...revealedChat(),
        }),
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
        if (
          state.doc.rev !== input.revision ||
          state.doc.origin.authoredSource !== input.source ||
          (state.pendingAuthoredSource !== null && input.coalesceKey === undefined)
        ) {
          set({
            sourceEditError:
              "That edit is stale. The preview moved on. Reselect the element and try again.",
          });
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
        if (input.design !== undefined) {
          if (state.hostBusy) {
            set({ sourceEditError: "Design waits for the assistant to finish." });
            return;
          }
          stageDesignEdit({
            before: input.source,
            after: result.source,
            label: input.design.label,
            key: input.coalesceKey,
          });
          return;
        }
        if (pendingDesignEdits(state) > 0) {
          set({ sourceEditError: STAGED_EDITS_FIRST });
          return;
        }
        const last = state.undoHistory.at(-1);
        const merges =
          input.coalesceKey !== undefined &&
          last?.key === input.coalesceKey &&
          last.after === input.source;
        set({
          designDraft: null,
          undoHistory: merges
            ? [
                ...state.undoHistory.slice(0, -1),
                { before: last.before, after: result.source, key: input.coalesceKey },
              ]
            : [
                ...state.undoHistory,
                { before: input.source, after: result.source, key: input.coalesceKey },
              ],
          redoHistory: [],
        });
        commitSource(result.source, { coalesceKey: input.coalesceKey });
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
        if (pendingDesignEdits(state) > 0) {
          set({ sourceEditError: STAGED_EDITS_FIRST });
          return;
        }
        set({
          designDraft: null,
          undoHistory: [
            ...state.undoHistory,
            { before: state.doc.origin.authoredSource, after: authoredSource },
          ],
          redoHistory: [],
        });
        commitSource(authoredSource);
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
        set({ conflict: false, storageError: null, fixtureError: null, designSettling: false });
        spine.reload();
      },

      flushSaves: () => spine.flushSaves(),

      beginLifecycle: () => {
        const state = get();
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
        spine.adoptRev(input.rev);
        set((current) => {
          if (current.doc === null) return { conflict: false };
          const doc = { ...withAuthoredSource(current.doc, input.authoredSource), rev: input.rev };
          // A restore replaces the entry, so edits staged on the old one no longer apply.
          const replaced = input.authoredSource !== current.doc.origin.authoredSource;
          return {
            ...committedDocument(current, doc, null),
            sourceEditable: sourceEditableFor(doc),
            conflict: false,
            ...(replaced ? { designDraft: null, designCompare: false } : {}),
          };
        });
      },

      retrySave: () => {
        const state = get();
        const retryingMarkdown =
          markdownEntryRevision !== null &&
          state.storageError !== null &&
          host.access === "editable" &&
          state.doc?.access.kind === "editable" &&
          !state.previewRefreshing;
        if (gated(state) && !retryingMarkdown) return;
        spine.retrySave();
        if (get().designSettling) settleDesignWrite();
      },

      select: (instancePath) => {
        set((current) => {
          if (instancePath === null) return { selection: DOCUMENT_SELECTION };
          const { render, doc } = current;
          if (render === null || doc?.channel !== "email" || doc.fixture === null) {
            return { selection: DOCUMENT_SELECTION };
          }
          if (!render.selections.some((entry) => entry.instancePath === instancePath)) {
            return { selection: DOCUMENT_SELECTION };
          }
          // The layers around a selection open, so the selected row is on screen.
          const collapsed = new Set(current.collapsedLayers);
          if (current.outline !== null) {
            for (const ancestor of outlineAncestry(current.outline, instancePath)) {
              collapsed.delete(ancestor);
            }
          }
          return {
            assistantOriginIndex: 0,
            selection: {
              kind: "element",
              instancePath,
              revision: render.revision,
              fixture: doc.fixture,
            },
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
      selectDocument: () => set({ selection: DOCUMENT_SELECTION }),
      selectEnvelope: () => set({ selection: ENVELOPE_SELECTION }),

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
        if (state.canvasMode === "design" && designWaiting(state)) return;
        if (mode === "design" && state.hostBusy) return;
        set({
          canvasMode: mode,
          designDraft: mode === "design" ? state.designDraft : null,
          designCompare: false,
          designApply: DESIGN_IDLE,
          hoveredCandidatePath: null,
        });
      },

      resetDesign: () => {
        const state = get();
        const draft = state.designDraft;
        if (
          draft === null ||
          draft.edits.length === 0 ||
          gated(state) ||
          !state.sourceEditable ||
          state.conflict ||
          state.doc === null
        )
          return;
        if (state.doc.origin.authoredSource !== draft.edits.at(-1)?.after) {
          set({
            sourceEditError:
              "Your edits conflict with a newer change, so they can't be reset here. Review the saved versions.",
          });
          return;
        }
        set({ designDraft: null, designCompare: false, designApply: DESIGN_IDLE });
        commitSource(draft.baseSource);
        settleDesignWrite();
      },

      setDesignCompare: (on) => {
        const state = get();
        const comparable =
          state.designDraft !== null &&
          state.designDraft.edits.length > 0 &&
          state.designDraft.baseRender !== null;
        const next = on && comparable;
        if (state.designCompare !== next) set({ designCompare: next });
      },

      applyDesign: () => {
        const state = get();
        const draft = state.designDraft;
        if (
          draft === null ||
          draft.edits.length === 0 ||
          state.designApply.status === "applying" ||
          state.hostBusy
        )
          return;
        const count = draft.edits.length;
        // Without saved versions the edits stay in the draft once it holds them: Apply keeps them.
        const versions =
          state.versionsCapability?.status === "ready" ? state.versionsCapability.api : undefined;
        if (!actions.beginLifecycle()) return;
        set({ designApply: { status: "applying" }, designCompare: false });
        void spine
          .flushSaves()
          .then(async (revision) => {
            const settled = get();
            // A staged write that conflicted or could not be stored leaves the draft without the
            // edits; saving a version then would name edits it does not hold.
            if (
              settled.doc === null ||
              settled.conflict ||
              settled.storageError !== null ||
              settled.doc?.origin.authoredSource !== draft.edits.at(-1)?.after
            ) {
              set({
                designApply: {
                  status: "failed",
                  reason: "Your edits haven't reached the draft, so no version was saved.",
                },
              });
              return;
            }
            const snapshot = settled.doc;
            const saved =
              versions === undefined
                ? revision
                : await versions.save(revision, { message: designVersionMessage(count) });
            const current = get().doc;
            // Adopt the saved revision only when nothing moved under the save.
            if (
              versions !== undefined &&
              (current?.rev === revision || current?.rev === saved) &&
              current.origin.authoredSource === snapshot.origin.authoredSource
            ) {
              actions.adoptLifecycleSnapshot({
                rev: saved,
                authoredSource: snapshot.origin.authoredSource,
              });
            }
            // The applied batch becomes one step of the source history, so Undo after Apply
            // reverts it as a whole.
            set((latest) => ({
              designDraft: null,
              designApply: DESIGN_IDLE,
              undoHistory: [
                ...latest.undoHistory,
                { before: draft.baseSource, after: snapshot.origin.authoredSource },
              ],
              redoHistory: [],
            }));
            state.telemetry?.({ name: "design.apply", data: { edits: count } });
          })
          .catch((cause: unknown) =>
            set({
              designApply: {
                status: "failed",
                reason:
                  cause instanceof Error && cause.message !== ""
                    ? cause.message
                    : "The version could not be saved.",
              },
            }),
          )
          .finally(() => actions.endLifecycle());
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
      designDraft: null,
      designApply: DESIGN_IDLE,
      designCompare: false,
      designSettling: false,
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
      store.setState((current) => ({
        ...committedDocument(current, doc, null),
        previewRefreshing: false,
        editable: host.access === "editable" && doc.access.kind !== "readonly",
        sourceEditable: sourceEditableFor(doc),
        readonlyReason: doc.access.kind === "readonly" ? doc.access.reason : null,
      }));
    },
    onPersistedRevision: (rev) => {
      if (store.getState().doc?.origin.kind === "markdown" && store.getState().conflict) {
        obsoleteMarkdownRevisions.add(rev);
        return;
      }
      store.setState((current) =>
        current.doc === null ? current : { doc: { ...current.doc, rev }, draftSavedAt: Date.now() },
      );
    },
    // Our own acked save came back with the render the host produced for it.
    // Local text that has moved on since is kept; everything else is the host's.
    onSelfAck: (change) => {
      if (
        store.getState().doc?.origin.kind === "markdown" &&
        (store.getState().conflict || obsoleteMarkdownRevisions.has(change.rev))
      )
        return;
      applyChange(change, true);
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
      store.setState((current) => ({
        sourceEditable: sourceEditableFor(current.doc),
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
