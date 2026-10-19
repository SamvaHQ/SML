import type {
  Capability,
  DocumentChange,
  EditorDocument,
  EmailRender,
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
import { applySourceReplacements, type SourceReplacement } from "@samva/markup/edit";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { DeviceMode } from "../canvas/device";
import {
  defaultExpanded,
  outlineAncestry,
  outlineBreadcrumb,
  type Crumb,
  type EmailOutline,
} from "../chrome/email-outline";
import {
  type SizeSource,
  deriveDocumentState,
  documentChecks,
  resolveSelection,
  withDocumentChange,
} from "./derive";
import { createEditorSpine, type EditorSpine } from "./spine";
import {
  DOCUMENT_SELECTION,
  ENVELOPE_SELECTION,
  type CheckItem,
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
  }) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly openSource: () => void;
  readonly requestSourceAssistance: (originIndex: number) => void;
  /** Open Assistant with one exact finding from the current draft. */
  readonly requestDiagnosticAssistance: (check: CheckItem) => void;
  /** The one write path: replace the canonical TSX entry and persist it through the spine. */
  readonly replaceAuthoredSource: (source: string) => void;
  /** Show another declared fixture. A re-render at the same revision, not a document edit. */
  readonly viewFixture: (fixture: string) => void;
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
  readonly toggleLayerExpand: (instancePath: string) => void;
  readonly ancestryOf: (instancePath: string) => ReadonlyArray<string>;
  readonly breadcrumbOf: (instancePath: string) => ReadonlyArray<Crumb>;
  readonly setHovered: (instancePath: string | null) => void;

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
  readonly expandedLayers: ReadonlySet<string>;
  /** The expanded set is seeded once per store, on the first render that has an outline. */
  readonly layersSeeded: boolean;
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
  // ── hover (raw candidate; validity is derived in the selector against the outline)
  readonly hoveredCandidatePath: string | null;
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
}

/** The element the user just selected, pinned to the render it was selected in. */
export interface UserSelection {
  readonly instancePath: string;
  readonly revision: RevisionToken;
  readonly fixture: string;
}

export interface CreateEditorBundleOptions {
  readonly hostChecks: ReadonlyArray<CheckItem>;
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
    const seed = !state.layersSeeded && derived.outline !== null;
    return {
      doc,
      pendingAuthoredSource,
      ...derived,
      render: renderOf(doc),
      expandedLayers: seed ? defaultExpanded(derived.outline) : state.expandedLayers,
      layersSeeded: state.layersSeeded || seed,
      selection: resolveSelection(state.selection, doc, state.outline),
    };
  };

  const store: EditorStore = createStore<EditorState>((set, get) => {
    const commitSource = (
      authoredSource: string,
      enqueueOptions?: { readonly coalesceKey?: string | undefined },
    ): void => {
      const state = get();
      if (state.doc === null) return;
      set({
        doc: { ...state.doc, origin: { ...state.doc.origin, authoredSource } },
        pendingAuthoredSource: authoredSource,
        sourceEditError: null,
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
        const result = applySourceReplacements(input.source, input.edits, {
          profile: { entry: state.doc.origin.file },
        });
        if (!result.ok) {
          set({ sourceEditError: result.reason });
          return;
        }
        if (result.source === input.source) return;
        const last = state.undoHistory.at(-1);
        const merges =
          input.coalesceKey !== undefined &&
          last?.key === input.coalesceKey &&
          last.after === input.source;
        set({
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
        set({
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

      reload: () => {
        if (get().lifecycleBusy) return;
        set({ conflict: false, storageError: null, fixtureError: null });
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
          const doc: EditorDocument = {
            ...current.doc,
            rev: input.rev,
            origin: {
              ...current.doc.origin,
              authoredSource: input.authoredSource,
            },
          };
          return {
            ...committedDocument(current, doc, null),
            sourceEditable: sourceEditableFor(doc),
            conflict: false,
          };
        });
      },

      retrySave: () => {
        if (gated(get())) return;
        spine.retrySave();
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
          const expanded = new Set(current.expandedLayers);
          if (current.outline !== null) {
            for (const ancestor of outlineAncestry(current.outline, instancePath)) {
              expanded.add(ancestor);
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
            expandedLayers: expanded,
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
          const next = new Set(current.expandedLayers);
          if (next.has(instancePath)) next.delete(instancePath);
          else next.add(instancePath);
          return { expandedLayers: next };
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
      fixtureBusy: false,
      fixtureError: null,
      diagnosticAssistance: null,
      selection: DOCUMENT_SELECTION,
      renameActive: false,
      expandedLayers: new Set<string>(),
      layersSeeded: false,
      leftCollapsed: false,
      rightCollapsed: false,
      workTabs: initialWorkTabs,
      activeWorkTab: readStoredWorkTab(initialWorkTabs),
      chatCollapsed: readStored(CHAT_COLLAPSED_KEY) === "true",
      focusedPane: "assistant",
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
      hoveredCandidatePath: null,
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
      store.setState((current) =>
        current.doc === null ? current : { doc: { ...current.doc, rev } },
      );
    },
    // Our own acked save came back with the render the host produced for it.
    // Local text that has moved on since is kept; everything else is the host's.
    onSelfAck: (change) => applyChange(change, true),
    onForeignChange: (change, saveInFlight) => {
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

  return {
    host,
    store,
    spine,
    setUserSelectListener: (listener) => {
      userSelectListener = listener;
    },
  };
};
