import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { SmsWorkspace } from "../channels/sms-workspace";
import { WhatsAppWorkspace } from "../channels/whatsapp-workspace";
import { cn } from "../lib/utils";
import { useEditorStore, useEditorStoreApi } from "../state/context";
import { pendingDesignEdits, type EditorLayoutMode } from "../state/store";
import { Button } from "../ui/button";
import type { EditorBrandSource } from "./brand-chip";
import {
  ContributionsProvider,
  resolveContributions,
  useContribution,
  type EditorContribution,
} from "./contributions";
import { SidebarLeft, SidebarRight } from "./editor-icons";
import { EmailWorkspace } from "./email-workspace";
import { downloadEmailHtml } from "./export-html";
import { LifecycleSheet } from "./lifecycle-sheet";
import { usePart, type PartProps } from "./part";
import { EditorPortalProvider } from "./portal-context";
import { PreviewChromeProvider } from "./preview-context";
import { PreviewOverlay } from "./preview-overlay";
import { ShellChromeProvider, useShellChrome } from "./shell-context";
import { StatusBar, type StatusBarProps } from "./statusbar";
import {
  THEME_PATH,
  withBrandImport,
  withBrandModuleSpecifiers,
  type EditorBrand,
} from "./theme-brand";
import { TopBar, type TopBarActions } from "./topbar";
import { Tip } from "./ui";
import { AssistantShellProvider } from "./use-assistant";

export interface EditorShellProps {
  /** Frame height; use 100% when the host supplies a bounded area below its own page chrome. */
  readonly height?: CSSProperties["height"] | undefined;
  /** What the host adds to the editor's regions. See {@link EditorContribution}. */
  readonly contributions?: ReadonlyArray<EditorContribution> | undefined;
  /**
   * The organization's brands and the project's theme, for the brand chip beside
   * the document name. With the host's `versions` capability, a project with no brand import
   * offers the organization's brands in the chip's menu. Omit to hide the chip.
   */
  readonly brand?: EditorBrandSource | undefined;
  /** Return to the templates list. Owned by the host (navigation). Omit to hide the button. */
  readonly onBack?: (() => void) | undefined;
  /** Enable the topbar "Export HTML" button — a client-side download of the compiled document. */
  readonly exportable?: boolean | undefined;
  /** Hide metadata rename when the host exposes source editing without metadata writes. */
  readonly renameEnabled?: boolean | undefined;
  /** Host continuation for a locked Publish capability after its explanation is shown. */
  readonly onLockedLifecycle?: (() => void) | undefined;
  /**
   * The host is producing a change to the email the author will see, such as an assistant turn
   * at work. The preview bar runs a thin progress line while it is true, beside the editor's own
   * waits (an edit on its way, a fixture switch, a refresh).
   */
  readonly previewBusy?: boolean | undefined;
  /** Open the current preview in a new browser tab. Omit where the host has no page for it. */
  readonly onOpenPreview?: (() => void) | undefined;
}

/** Lifecycle transaction controls for host chrome rendered inside the editor. */
export interface EditorHostChrome {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly preview: () => void;
  readonly exportHtml: () => void;
  readonly canExport: boolean;
}

export interface EditorLifecycleControls extends EditorHostChrome {
  readonly flushSaves: () => Promise<string>;
  readonly beginLifecycle: () => boolean;
  readonly endLifecycle: () => void;
  readonly adoptLifecycleSnapshot: (input: {
    readonly rev: string;
    readonly authoredSource: string;
  }) => void;
}

const NO_CONTRIBUTIONS: ReadonlyArray<EditorContribution> = [];

/** Layout mode for a shell width, widest breakpoint first. */
const layoutModeForWidth = (width: number): EditorLayoutMode => {
  if (width >= 1280) return "wide";
  if (width >= 980) return "standard";
  if (width >= 720) return "compact";
  return "narrow";
};

/** Non-blocking banner shown when the host reports a foreign change under an in-flight edit. */
function ConflictBanner() {
  const conflict = useEditorStore((state) => state.conflict);
  const { reload } = useEditorStore((state) => state.actions);
  const editable = useEditorStore((state) => state.editable);
  if (!editable || !conflict) return null;
  return (
    <div className="border-border bg-surface-elevated text-foreground absolute inset-x-0 top-3 z-30 mx-auto flex w-fit items-center gap-3 rounded-lg border px-3.5 py-2 text-[13px] shadow-[var(--shadow-md)]">
      <span>Document changed elsewhere — your recent edits weren’t saved.</span>
      <button
        type="button"
        onClick={reload}
        className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 font-medium transition-opacity hover:opacity-90"
      >
        Reload
      </button>
    </div>
  );
}

/**
 * Non-blocking banner for a storage-full/blocked save failure. Unlike the conflict
 * banner, it is non-destructive: the optimistic edit is kept in memory and the only
 * action is a retry, so the user is never nudged to discard their work.
 */
function StorageBanner() {
  const storageError = useEditorStore((state) => state.storageError);
  const conflict = useEditorStore((state) => state.conflict);
  const { retrySave } = useEditorStore((state) => state.actions);
  const editable = useEditorStore((state) => state.editable);
  if (!editable || storageError === null || conflict) return null;
  return (
    <div className="border-status-warning/45 bg-surface-elevated text-foreground absolute inset-x-0 top-3 z-30 mx-auto flex w-fit items-center gap-3 rounded-lg border px-3.5 py-2 text-[13px] shadow-[var(--shadow-md)]">
      <span>{storageError} Your work is kept here; export a copy or retry.</span>
      <button
        type="button"
        data-testid="storage.retry"
        onClick={retrySave}
        className="border-border hover:bg-muted rounded-md border px-2.5 py-1 font-medium transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

/** Direct channel dispatch keeps channel-specific editing rules explicit and exhaustive. */
function ChannelWorkspace() {
  const doc = useEditorStore((state) => state.doc);
  if (doc === null || doc.channel === "email") return <EmailWorkspace />;
  if (doc.channel === "sms") return <SmsWorkspace />;
  return <WhatsAppWorkspace />;
}

/**
 * The editor's root: the host's frame start, then the parts it holds (top bar, workspace, status
 * bar), with every context those parts read. With a docked assistant the workspace is chat beside
 * a tabbed work pane (a Chat | Preview switch below 1280px of frame width); without one it is
 * layers · canvas · inspector. Must be rendered inside an {@link EditorProvider}.
 */
/** The project files that can import brand components. */
const SCRIPT_PATH = /\.[cm]?[jt]sx?$/;

export function EditorRoot({
  height = "100dvh",
  contributions = NO_CONTRIBUTIONS,
  brand,
  onBack,
  exportable,
  renameEnabled,
  onLockedLifecycle,
  previewBusy = false,
  onOpenPreview,
  children,
  ...partProps
}: EditorRootProps) {
  const leftCollapsed = useEditorStore((state) => state.leftCollapsed);
  const rightCollapsed = useEditorStore((state) => state.rightCollapsed);
  const layoutMode = useEditorStore((state) => state.layoutMode);
  const documentRevision = useEditorStore((state) => state.doc?.rev ?? null);
  // Undo and redo walk the staged Design edits while there are any, then the source history.
  const undoCount = useEditorStore(
    (state) => state.undoHistory.length + (state.designDraft?.edits.length ?? 0),
  );
  const redoCount = useEditorStore(
    (state) => state.redoHistory.length + (state.designDraft?.undone.length ?? 0),
  );
  const sourceEditable = useEditorStore((state) => state.sourceEditable);
  const doc = useEditorStore((state) => state.doc);
  const render = useEditorStore((state) => state.render);
  const pendingAuthoredSource = useEditorStore((state) => state.pendingAuthoredSource);
  const lifecycleBusy = useEditorStore((state) => state.lifecycleBusy);
  const conflict = useEditorStore((state) => state.conflict);
  const storageError = useEditorStore((state) => state.storageError);
  const slots = useMemo(() => resolveContributions(contributions), [contributions]);
  const frameStart = slots.one("frame.start");
  const guestStatus = slots.one("statusbar.headline");
  // A docked assistant takes the left column, so the floating rail toggles give way to it.
  const assistantDocked = slots.one("rail.assistant") !== undefined;
  const {
    flushSaves,
    beginLifecycle,
    endLifecycle,
    adoptLifecycleSnapshot,
    toggleLeft,
    toggleRight,
    setLayoutMode,
    undo,
    redo,
    openWorkTab,
    setFocusedPane,
    setHostBusy,
  } = useEditorStore((state) => state.actions);
  useEffect(() => setHostBusy(previewBusy), [previewBusy, setHostBusy]);
  const versions = useEditorStore((state) => state.versionsCapability);
  const telemetry = useEditorStore((state) => state.telemetry);
  // Save version comes from the host's `versions` capability; the shell holds no second path.
  const versionsApi = versions?.status === "ready" ? versions.api : undefined;
  const onSaveVersion = useMemo(
    () =>
      versionsApi === undefined ? undefined : (revision: string) => versionsApi.save(revision),
    [versionsApi],
  );
  const inspectSavedRevision = useMemo(
    () => (versionsApi === undefined ? undefined : () => versionsApi.savedRevision()),
    [versionsApi],
  );
  const onPreview = () => telemetry?.({ name: "preview" });
  const onExport = () => telemetry?.({ name: "export" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [saveVersionState, setSaveVersionState] = useState<"idle" | "saving" | "error">("idle");
  const [materializedRevision, setMaterializedRevision] = useState<string | null>(null);
  const [hostSavedRevision, setHostSavedRevision] = useState<string | null>(null);
  const store = useEditorStoreApi();
  const idBase = useId();
  useEffect(() => {
    if (inspectSavedRevision === undefined || documentRevision === null) return;
    let current = true;
    void inspectSavedRevision()
      .then((revision) => {
        if (!current) return;
        setHostSavedRevision(revision === documentRevision ? revision : null);
      })
      .catch(() => {
        if (current) setHostSavedRevision(null);
      });
    return () => {
      current = false;
    };
  }, [documentRevision, inspectSavedRevision]);
  // React state only disables the affordance after a render. Keep the operation
  // lock outside that render cycle so a click and Cmd/Ctrl+S in the same tick
  // cannot each flush and materialize the same draft revision.
  const saveVersionInFlight = useRef<Promise<void> | null>(null);
  const saveVersionRef = useRef<() => void>(() => {});
  const frameRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  const canExport =
    exportable === true &&
    doc?.channel === "email" &&
    render !== null &&
    pendingAuthoredSource === null;

  const exportHtml = () => {
    if (!canExport || doc === null || render === null) return;
    downloadEmailHtml(render.html, doc.name);
    onExport?.();
  };

  const saveVersion = (): Promise<void> => {
    if (onSaveVersion === undefined) return Promise.resolve();
    // Staged Design edits are saved by Apply, as one version named for them.
    if (pendingDesignEdits(store.getState()) > 0) {
      store.getState().actions.applyDesign();
      return Promise.resolve();
    }
    if (saveVersionInFlight.current !== null) return saveVersionInFlight.current;
    if (!beginLifecycle()) return Promise.resolve();
    let releaseInFlight: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    // Set before flushSaves: the command may be reached again before React
    // commits the `saving` state update.
    saveVersionInFlight.current = inFlight;
    setSaveVersionState("saving");
    void store
      .getState()
      .actions.flushSaves()
      .then(async (revision) => {
        const snapshot = store.getState().doc;
        const materialized = await onSaveVersion(revision);
        const current = store.getState().doc;
        // Adopt the materialized revision only when nothing moved under the
        // save; a later edit owns the revision fence instead.
        if (
          snapshot !== null &&
          (current?.rev === revision || current?.rev === materialized) &&
          current.origin.authoredSource === snapshot.origin.authoredSource
        ) {
          store.getState().actions.adoptLifecycleSnapshot({
            rev: materialized,
            authoredSource: snapshot.origin.authoredSource,
          });
        }
        setMaterializedRevision(materialized);
        setSaveVersionState("idle");
      })
      .catch(() => setSaveVersionState("error"))
      .finally(() => {
        endLifecycle();
        if (saveVersionInFlight.current === inFlight) saveVersionInFlight.current = null;
        releaseInFlight();
      });
    return inFlight;
  };
  useEffect(() => {
    saveVersionRef.current = saveVersion;
  });

  // Choosing a brand writes its import into the theme, and into every script that imports brand
  // components, through the lifecycle file write (a project compiles against one brand), then
  // saves a version through the same path as Save version.
  const applyBrand =
    brand === undefined || onSaveVersion === undefined
      ? undefined
      : async (chosen: EditorBrand) => {
          const lifecycle = store.getState().lifecycleCapability;
          if (lifecycle?.status !== "ready") return;
          let revision = await store.getState().actions.flushSaves();
          const theme = await brand.readTheme();
          const project = await lifecycle.api.inspect();
          const content = withBrandImport(theme, chosen);
          if (content !== theme.theme) {
            revision = (
              await lifecycle.api.updateFile({ path: THEME_PATH, baseRev: revision, content })
            ).rev;
          }
          for (const file of project.files) {
            if (file.binary === true || file.content === null || !SCRIPT_PATH.test(file.path)) {
              continue;
            }
            const next = withBrandModuleSpecifiers(file.content, chosen);
            if (next === file.content) continue;
            // Each write needs the revision the previous one returned.
            // oxlint-disable-next-line no-await-in-loop -- Serial by design: the revision chains.
            const written = await lifecycle.api.updateFile({
              path: file.path,
              baseRev: revision,
              content: next,
            });
            revision = written.rev;
          }
          await saveVersion();
        };

  let saveVersionStatus: "idle" | "saving" | "saved" | "error" = "idle";
  if (saveVersionState === "saving") saveVersionStatus = "saving";
  else if (saveVersionState === "error") saveVersionStatus = "error";
  else if (
    documentRevision !== null &&
    (materializedRevision === documentRevision || hostSavedRevision === documentRevision) &&
    pendingAuthoredSource === null &&
    !conflict &&
    storageError === null
  ) {
    saveVersionStatus = "saved";
  }

  let saveVersionStatusText: string | undefined;
  if (onSaveVersion !== undefined) {
    saveVersionStatusText = "Unsaved changes";
    if (saveVersionStatus === "saving") saveVersionStatusText = "Saving version…";
    else if (saveVersionStatus === "saved") saveVersionStatusText = "Saved version";
    else if (saveVersionStatus === "error") saveVersionStatusText = "Couldn’t save version";
  }

  const lifecycleControls: EditorLifecycleControls = {
    flushSaves,
    beginLifecycle,
    endLifecycle,
    adoptLifecycleSnapshot,
    undo,
    redo,
    canUndo: sourceEditable && undoCount > 0,
    canRedo: sourceEditable && redoCount > 0,
    preview: () => {
      setPreviewOpen(true);
      onPreview?.();
    },
    exportHtml,
    canExport,
  };
  const previewChrome = useMemo(
    () => ({
      hostBusy: previewBusy,
      openInNewTab: onOpenPreview,
      // The work pane gives checks a tab; the standalone layout keeps them in the inspector.
      showChecks: assistantDocked
        ? () => {
            openWorkTab("checks");
            setFocusedPane("preview");
          }
        : undefined,
    }),
    [assistantDocked, onOpenPreview, openWorkTab, previewBusy, setFocusedPane],
  );
  const toolbarLeading = slots
    .all("toolbar.leading")
    .map((contribution) => <Fragment key={contribution.id}>{contribution.render()}</Fragment>);
  const renderedToolbarActions = slots
    .all("toolbar.actions")
    .map((contribution) => (
      <Fragment key={contribution.id}>{contribution.render(lifecycleControls)}</Fragment>
    ));
  const renderedChannelSwitcher = slots.one("document.switcher")?.render(lifecycleControls);

  useEffect(() => {
    if (onSaveVersion === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!(event.target instanceof HTMLElement)) return;
      if (
        event.target.closest("[data-samva-editor-theme]") === null ||
        event.target.closest('[role="menu"], [role="dialog"], [data-base-ui-portal]') !== null
      )
        return;
      event.preventDefault();
      saveVersionRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSaveVersion]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null || typeof ResizeObserver === "undefined") return;
    // setLayoutMode applies the mode's dock defaults, so it must fire only on
    // zone transitions — an in-zone resize must not clobber a manual rail toggle.
    let appliedMode: EditorLayoutMode | undefined;
    const updateMode = (width: number) => {
      const mode = layoutModeForWidth(width);
      if (mode === appliedMode) return;
      appliedMode = mode;
      setLayoutMode(mode);
    };
    updateMode(frame.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) updateMode(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [setLayoutMode]);

  const overlayPanels = layoutMode === "compact" || layoutMode === "narrow";
  const overlayOpen = overlayPanels && (!leftCollapsed || !rightCollapsed);

  useEffect(() => {
    if (!overlayOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!leftCollapsed) toggleLeft();
      if (!rightCollapsed) toggleRight();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [leftCollapsed, overlayOpen, rightCollapsed, toggleLeft, toggleRight]);

  const topBar: TopBarActions = {
    leading: toolbarLeading.length === 0 ? undefined : toolbarLeading,
    extraActions: renderedToolbarActions.length === 0 ? undefined : renderedToolbarActions,
    onBack: frameStart === undefined ? onBack : undefined,
    onPreview: () => {
      setPreviewOpen(true);
      onPreview?.();
    },
    onLifecycle: () => setLifecycleOpen(true),
    onUndo: undo,
    onRedo: redo,
    canUndo: sourceEditable && undoCount > 0,
    canRedo: sourceEditable && redoCount > 0,
    channelSwitcher: renderedChannelSwitcher,
    exportEnabled: exportable,
    renameEnabled,
    onExport,
    brand,
    onUseBrand: applyBrand,
  };
  const keepsSaveVersion = guestStatus === undefined || guestStatus.saveVersion;
  const statusBar: StatusBarProps = {
    saveVersionStatus: keepsSaveVersion ? saveVersionStatusText : undefined,
    saveVersionState: onSaveVersion === undefined ? undefined : saveVersionStatus,
    onSaveVersion: keepsSaveVersion && onSaveVersion !== undefined ? saveVersion : undefined,
    saveVersionBusy: saveVersionStatus === "saving",
    saveVersionBlocked: lifecycleBusy,
    guestHeadline: guestStatus?.headline,
  };

  const root = usePart<EditorRootState>(
    "editor",
    { ...partProps },
    {
      state: { layout: layoutMode, docked: assistantDocked, busy: lifecycleBusy },
      className: "samva-editor-shell flex min-w-0 flex-1 flex-col overflow-hidden",
      props: {
        "data-samva-editor-theme": "host",
        inert: lifecycleBusy,
        "aria-busy": lifecycleBusy,
        children,
      },
    },
  );

  return (
    <ContributionsProvider value={slots}>
      <AssistantShellProvider
        value={{
          exportHtml,
          canExport,
          saveVersionStatus: onSaveVersion === undefined ? "unavailable" : saveVersionStatus,
        }}
      >
        <PreviewChromeProvider value={previewChrome}>
          <ShellChromeProvider value={{ topBar, statusBar, overlayOpen, idBase }}>
            <EditorPortalProvider container={portalRef}>
              <div ref={frameRef} className="samva-editor-frame flex" style={{ height }}>
                {frameStart?.render()}
                {root}
                <PreviewOverlay open={previewOpen} onClose={() => setPreviewOpen(false)} />
                <LifecycleSheet
                  open={lifecycleOpen}
                  onClose={() => setLifecycleOpen(false)}
                  onLockedAction={onLockedLifecycle}
                />
                <div ref={portalRef} data-samva-editor-portal-root className="samva-editor-shell" />
              </div>
            </EditorPortalProvider>
          </ShellChromeProvider>
        </PreviewChromeProvider>
      </AssistantShellProvider>
    </ContributionsProvider>
  );
}

/** The state an {@link EditorRoot} exposes to `className` and as data attributes. */
export interface EditorRootState extends Record<string, unknown> {
  /** The layout the editor frame's width resolved to. */
  readonly layout: EditorLayoutMode;
  /** A host assistant is docked beside the work pane. */
  readonly docked: boolean;
  /** A lifecycle operation (publish, restore, save version) holds the draft. */
  readonly busy: boolean;
}

export interface EditorRootProps extends EditorShellProps, PartProps<"div", EditorRootState> {
  /** The chrome parts, in the order the host lays them out. */
  readonly children?: ReactNode;
}

/** The workspace between the top bar and the status bar. */
export function EditorWorkspace(props: PartProps<"div", { readonly layout: EditorLayoutMode }>) {
  const layoutMode = useEditorStore((state) => state.layoutMode);
  const leftCollapsed = useEditorStore((state) => state.leftCollapsed);
  const rightCollapsed = useEditorStore((state) => state.rightCollapsed);
  const assistantDocked = useContribution("rail.assistant") !== undefined;
  const { toggleLeft, toggleRight } = useEditorStore((state) => state.actions);
  const { overlayOpen } = useShellChrome();
  return usePart(
    "editor-workspace",
    { ...props },
    {
      state: { layout: layoutMode },
      className: "samva-editor-body relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
      props: {
        children: (
          <>
            {overlayOpen && (
              <button
                type="button"
                aria-label="Close editor panel"
                className="bg-background/45 absolute inset-0 z-30 cursor-default backdrop-blur-[1px]"
                onClick={() => {
                  if (!leftCollapsed) toggleLeft();
                  if (!rightCollapsed) toggleRight();
                }}
              />
            )}
            {leftCollapsed && !assistantDocked && (
              <RailToggle
                label="Show layers and blocks"
                testId="shell.show-left"
                side="left"
                onClick={toggleLeft}
              />
            )}
            {rightCollapsed && !assistantDocked && (
              <RailToggle
                label="Show inspector"
                testId="shell.show-right"
                side="right"
                onClick={toggleRight}
              />
            )}
            <ChannelWorkspace />
            <ConflictBanner />
            <StorageBanner />
          </>
        ),
      },
    },
  );
}

/** A floating control that brings a collapsed standalone rail back. */
function RailToggle({
  label,
  testId,
  side,
  onClick,
}: {
  readonly label: string;
  readonly testId: string;
  readonly side: "left" | "right";
  readonly onClick: () => void;
}) {
  const Icon = side === "left" ? SidebarLeft : SidebarRight;
  return (
    <Tip label={label} side={side === "left" ? "right" : "left"}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
        className={cn("absolute top-3 z-20 shadow-sm", side === "left" ? "left-3" : "right-3")}
      >
        <Icon className="size-4" />
      </Button>
    </Tip>
  );
}

/** The top bar, wired to the editor around it. */
export function EditorTopBar(props: PartProps<"header", { readonly layout: EditorLayoutMode }>) {
  const { topBar } = useShellChrome();
  return <TopBar {...topBar} part={props} />;
}

/** The status bar, wired to the editor around it. */
export function EditorStatusBar(
  props: PartProps<"footer", { readonly layout: EditorLayoutMode; readonly save: string }>,
) {
  const { statusBar } = useShellChrome();
  return <StatusBar {...statusBar} part={props} />;
}

/**
 * The full editor: {@link EditorRoot} around the top bar, the workspace and the status bar. A
 * host that wants another arrangement composes the root and the parts itself.
 */
export function EditorShell(props: EditorShellProps) {
  return (
    <EditorRoot {...props}>
      <EditorTopBar />
      <EditorWorkspace />
      <EditorStatusBar />
    </EditorRoot>
  );
}
