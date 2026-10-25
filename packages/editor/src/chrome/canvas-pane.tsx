import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { DESKTOP_WIDTH, MOBILE_WIDTH } from "../canvas/device";
import { EmailFrame } from "../canvas/email-frame";
import { PageFrame } from "../canvas/page-frame";
import { SelectionOverlay } from "../canvas/selection-overlay";
import {
  isZoomWheel,
  zoomFromWheel,
  zoomInFrom,
  zoomKeyOf,
  zoomOutFrom,
  type ZoomGesture,
} from "../canvas/zoom";
import { useEditorStore, useEditorStoreApi } from "../state/context";
import { correspondingPath } from "../state/target-map";
import { CheckActions } from "./check-actions";
import { CheckDetails } from "./check-details";
import { useContributions } from "./contributions";
import { EditorDesignDock, EditorPinTray } from "./design-controls";
import { DesignToolbar } from "./design-toolbar";
import { outlineAncestry, selectionLabel } from "./email-outline";
import { EnvelopeCard } from "./envelope-card";
import { nearestAuthored } from "./friendly";
import { Inspector } from "./inspector";
import { NodeContextMenu, type AncestorEntry } from "./node-context-menu";
import { usePart, type PartProps } from "./part";
import { EditorPreviewBar, PreviewNotice } from "./preview-bar";
import { ReadonlyInspector } from "./readonly-inspector";
import { cn } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";
import { EditorZoomControl } from "./zoom-control";

/**
 * The center workspace: the preview bar, then the host's rendered email on the recessed grid
 * backdrop with a floating zoom control. The frame owns click resolution against
 * `data-samva-instance`; this pane centers it at the device width, forwards selection to the
 * store, and drops to document scope when the backdrop outside the email is clicked. While
 * `active`, a pinch or ⌘/Ctrl with +, − or 0 zooms the canvas rather than the page.
 */
/** The state an `EditorCanvas` exposes. */
export interface CanvasState extends Record<string, unknown> {
  /** `fit`, or the zoom percentage. */
  readonly zoom: string;
  /** The width the email is shown at. */
  readonly device: string;
  /** What the preview shows: the `email` or the `web` page. */
  readonly target: string;
}

export function CanvasPane({
  pointing = false,
  active = true,
  viewMenu,
  ...props
}: PartProps<"div", CanvasState> & {
  /** Extra rows for the preview bar's menu. */
  readonly viewMenu?: ReactNode | undefined;
  readonly pointing?: boolean | undefined;
  /** The pane is on screen; a hidden pane leaves zoom chords to the page. */
  readonly active?: boolean | undefined;
}) {
  const {
    doc,
    render,
    outline,
    selection,
    previewDevice,
    canvasZoom,
    previewEpoch,
    canvasMode,
    beforeEdits,
    pins,
    sourceEditable,
    previewTarget,
    pageRender,
    pageError,
  } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      outline: state.outline,
      selection: state.selection,
      previewDevice: state.previewDevice,
      canvasZoom: state.canvasZoom,
      previewEpoch: state.previewEpoch,
      canvasMode: state.canvasMode,
      beforeEdits: state.designCompare ? (state.designDraft?.baseRender ?? null) : null,
      pins: state.pins,
      sourceEditable: state.sourceEditable,
      previewTarget: state.pageAvailable ? state.previewTarget : "email",
      pageRender: state.pageRender,
      pageError: state.pageError,
    })),
  );
  const store = useEditorStoreApi();
  const { select, selectDocument, selectFromPage, setHovered, setCanvasZoom } = useEditorStore(
    (state) => state.actions,
  );
  // Validity is derived in the selector: a candidate that left the render reads
  // as null, so a hover over a vanished element can never highlight a ghost.
  const hovered = useEditorStore((state) =>
    state.hoveredCandidatePath === null
      ? null
      : (state.outline?.index.get(state.hoveredCandidatePath) ?? null),
  );
  const portalContainer = useEditorPortalContainer();
  const canvasOverlays = useContributions("canvas.overlay");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [contextAncestors, setContextAncestors] = useState<ReadonlyArray<AncestorEntry>>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextAnchor, setContextAnchor] = useState<{
    readonly getBoundingClientRect: () => DOMRect;
  } | null>(null);

  const selected =
    selection.kind === "element" ? (outline?.index.get(selection.instancePath) ?? null) : null;
  const designing = canvasMode === "design";
  // A click drops a pin in pin mode and selects otherwise. The mode is read when the click lands,
  // so the frame's listeners never re-attach as it changes.
  const onFrameSelect = useCallback(
    (instancePath: string | null) => {
      const { canvasMode: mode, actions, outline: current } = store.getState();
      // Design and pins name what the author wrote: a click on a compiler's table or cell lands
      // on the authored block around it.
      const target =
        mode === "point" || instancePath === null || current === null
          ? instancePath
          : (nearestAuthored(current, instancePath)?.instancePath ?? instancePath);
      if (mode !== "pin") actions.select(target);
      else if (target !== null) actions.addPin(target);
    },
    [store],
  );
  const fixture = doc?.channel === "email" ? doc.fixture : null;
  const renderRevision = render?.revision ?? null;
  // An instance path names a position, so after the email changes it can name another element.
  // A pin is drawn only on the render it was dropped on; the tray keeps listing it.
  const overlayPins = useMemo(
    () =>
      pins
        .filter((pin) => pin.fixture === fixture && pin.revision === renderRevision)
        .map((pin) => ({ number: pin.number, instancePath: pin.instancePath })),
    [pins, fixture, renderRevision],
  );

  const deviceWidth = previewDevice === "mobile" ? MOBILE_WIDTH : DESKTOP_WIDTH;
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace === null || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const available = Math.max(240, workspace.clientWidth - 80);
      setFitScale(Math.min(1, Math.max(0.5, available / deviceWidth)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [deviceWidth]);
  const scale = canvasZoom === "fit" ? fitScale : canvasZoom / 100;
  const percent = scale * 100;
  // Gesture handlers read the zoom on screen at event time, so neither the frame's listeners
  // nor the window's are re-attached as the zoom moves.
  const percentRef = useRef(percent);
  useLayoutEffect(() => {
    percentRef.current = percent;
  }, [percent]);

  const onZoomGesture = useCallback(
    (gesture: ZoomGesture) => {
      const current = percentRef.current;
      if (gesture.kind === "wheel") setCanvasZoom(zoomFromWheel(current, gesture.deltaY));
      else if (gesture.direction === "in") setCanvasZoom(zoomInFrom(current));
      else if (gesture.direction === "out") setCanvasZoom(zoomOutFrom(current));
      else setCanvasZoom(100);
    },
    [setCanvasZoom],
  );

  // A pinch over the backdrop arrives as a wheel event with ctrlKey. React's wheel listener is
  // passive, so the page zoom can only be refused from a listener registered here.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace === null || !active) return;
    const onWheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) return;
      event.preventDefault();
      onZoomGesture({ kind: "wheel", deltaY: event.deltaY });
    };
    workspace.addEventListener("wheel", onWheel, { passive: false });
    return () => workspace.removeEventListener("wheel", onWheel);
  }, [active, onZoomGesture]);

  // Zoom chords anywhere in this editor zoom its canvas while the canvas is on screen. Chords
  // typed inside the email arrive through the frame instead.
  useEffect(() => {
    if (!active) return;
    const frame = workspaceRef.current?.closest("[data-samva-editor-theme]");
    if (frame === null || frame === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = zoomKeyOf(event);
      if (direction === null || !(event.target instanceof Node) || !frame.contains(event.target))
        return;
      event.preventDefault();
      onZoomGesture({ kind: "key", direction });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, onZoomGesture]);

  const openContextMenu = useCallback(
    (input: {
      readonly instancePath: string | null;
      readonly clientX: number;
      readonly clientY: number;
    }) => {
      if (
        pointing ||
        store.getState().canvasMode === "pin" ||
        outline === null ||
        input.instancePath === null
      ) {
        setContextOpen(false);
        return;
      }
      const walk = [...outlineAncestry(outline, input.instancePath), input.instancePath]
        .toReversed()
        .flatMap((instancePath): AncestorEntry[] => {
          const entry = outline.index.get(instancePath);
          return entry === undefined
            ? []
            : [
                {
                  instancePath,
                  label: selectionLabel(entry),
                  generated: !entry.authored,
                },
              ];
        });
      if (walk.length === 0) {
        setContextOpen(false);
        return;
      }
      select(input.instancePath);
      setContextAncestors(walk);
      const { clientX, clientY } = input;
      setContextAnchor({
        getBoundingClientRect: () => DOMRect.fromRect({ x: clientX, y: clientY }),
      });
      queueMicrotask(() => setContextOpen(true));
    },
    [outline, pointing, select, store],
  );

  const onPageSelect = useCallback(
    (pagePath: string | null) => {
      if (pagePath === null) select(null);
      else selectFromPage(pagePath);
    },
    [select, selectFromPage],
  );
  // Prose is edited on the page, where the text reads as the reader sees it. Only text written in
  // Markdown can be changed this way, and only where the host lets the project be saved.
  const canEditPageText = useCallback(
    (pagePath: string) => {
      const { pageRender: page, render: email, editable, lifecycleCapability } = store.getState();
      // A page that is behind the email on screen would map its text onto the wrong origin.
      if (
        page === null ||
        email === null ||
        page.revision !== email.revision ||
        !editable ||
        lifecycleCapability?.status !== "ready"
      )
        return false;
      const emailPath = correspondingPath(page.selections, email.selections, pagePath);
      const entry = email.selections.find((item) => item.instancePath === emailPath);
      return entry?.origins.some((origin) => origin.fileName.endsWith(".md")) === true;
    },
    [store],
  );
  const onEditPageText = useCallback(
    (pagePath: string, text: string) => {
      const { pageRender: page, render: email } = store.getState();
      if (page === null || email === null || page.revision !== email.revision) return;
      const emailPath = correspondingPath(page.selections, email.selections, pagePath);
      if (emailPath === null) return;
      selectFromPage(pagePath);
      store.getState().actions.editMarkdownText(emailPath, text);
    },
    [selectFromPage, store],
  );
  const onWeb = previewTarget === "web";
  const pageFrame =
    pageRender !== null && pageError === null && render !== null ? (
      <PageFrame
        page={pageRender}
        selectedEmailPath={selection.kind === "element" ? selection.instancePath : null}
        emailSelections={render.selections}
        width={deviceWidth}
        epoch={previewEpoch}
        onSelect={onPageSelect}
        onZoomGesture={active ? onZoomGesture : undefined}
        canEditText={canEditPageText}
        onEditText={onEditPageText}
      />
    ) : null;

  // Compare shows the preview from before the staged edits, untouched by selection or pins.
  const emailFrame =
    beforeEdits !== null ? (
      <EmailFrame html={beforeEdits.html} width={deviceWidth} epoch={previewEpoch} />
    ) : render === null ? null : (
      <EmailFrame
        html={render.html}
        width={deviceWidth}
        epoch={previewEpoch}
        onSelect={onFrameSelect}
        onHover={setHovered}
        onZoomGesture={active ? onZoomGesture : undefined}
        onContextMenu={pointing ? undefined : openContextMenu}
        overlay={
          <SelectionOverlay
            renderRevision={render.revision}
            selected={canvasMode === "pin" ? null : selected}
            hovered={hovered}
            toolbar={
              designing && selected !== null ? <DesignToolbar selection={selected} /> : undefined
            }
            pins={overlayPins}
          />
        }
      />
    );

  const frame = onWeb ? pageFrame : emailFrame;

  const children = (
    <>
      {/* Drawn while the document loads too: the shell opens on email, and the canvas below
          keeps its place when the document lands. */}
      {(doc === null || doc.channel === "email") && (
        <>
          <EditorPreviewBar viewMenu={viewMenu} />
          <PreviewNotice />
        </>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          data-canvas-mode={canvasMode}
          className="samva-editor-workspace relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {canvasOverlays.length > 0 && (
            /*
          The slot is placement only, never chrome. A host status is a live
          component — it renders nothing most of the time and something during
          a wait — so a truthy element says nothing about whether there is
          anything to show. Drawing a pill and a spinner around it here pinned
          an empty, permanently spinning badge over the preview on every mount.
          Pointer events pass through: a wait names itself without taking the
          canvas away from the hands that are already working in it.
        */
            <div
              data-samva-canvas-status
              className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"
            >
              {canvasOverlays.map((contribution) => (
                <Fragment key={contribution.id}>{contribution.render()}</Fragment>
              ))}
            </div>
          )}
          <div
            ref={workspaceRef}
            data-samva-canvas-viewport
            // Fit zoom reads this element's clientWidth; a stable gutter keeps that width
            // from moving when the zoomed email starts or stops overflowing.
            className={cn(
              "samva-editor-scroll relative flex-1 [scrollbar-gutter:stable] overflow-auto px-10 pt-10 pb-24 [overflow-anchor:none]",
              // Room to scroll the end of the email above the pin tray.
              (pins.length > 0 || canvasMode === "pin") && "pb-64",
            )}
            onClick={selectDocument}
          >
            {doc === null ? (
              <div className="text-muted-foreground grid h-full place-items-center text-[12.5px]">
                Loading document…
              </div>
            ) : (
              <div
                className="mx-auto"
                data-canvas-zoom={canvasZoom === "fit" ? "fit" : String(canvasZoom)}
                style={{ width: deviceWidth, zoom: scale }}
                // Stop the workspace's deselect handler so clicks inside the column keep
                // their resolved selection (the envelope card and frame report their own
                // target); only the bare backdrop drops to document scope.
                onClick={(event) => event.stopPropagation()}
              >
                {!onWeb && <EnvelopeCard />}
                {frame === null ? (
                  onWeb ? (
                    <UnbuiltPage />
                  ) : (
                    <UnbuiltCanvas />
                  )
                ) : pointing || onWeb ? (
                  frame
                ) : (
                  <NodeContextMenu
                    ancestors={contextAncestors}
                    onSelect={select}
                    portalContainer={portalContainer}
                    anchor={contextAnchor ?? undefined}
                    open={contextOpen}
                    onOpenChange={(open) => setContextOpen(open && contextAncestors.length > 0)}
                  >
                    {frame}
                  </NodeContextMenu>
                )}
              </div>
            )}
          </div>
          {beforeEdits !== null && (
            <div
              data-testid="canvas.compare-badge"
              className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"
            >
              <span className="bg-popover text-popover-foreground ring-foreground/10 rounded-lg px-3 py-1 text-xs font-medium shadow-md ring-1">
                Before your edits
              </span>
            </div>
          )}
          {doc !== null && (pins.length > 0 || canvasMode === "pin") && (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-2 px-3",
                // Above the Design bar, which is one row tall at any width.
                designing ? "bottom-16" : "bottom-15",
              )}
            >
              <EditorPinTray />
            </div>
          )}
          {doc !== null && !designing && <EditorZoomControl percent={percent} />}
          {doc !== null && designing && (
            // In Design the zoom and the staged edits share one bar under the email, in the
            // layout rather than over it, so neither covers the email.
            <div
              data-slot="editor-design-bar"
              className="border-border bg-background @container/design-bar flex h-11 shrink-0 items-center justify-between gap-2 border-t px-2"
            >
              {/* A narrow bar keeps Apply and the edit controls; zoom stays in pinch and ⌘/Ctrl. */}
              <EditorZoomControl
                percent={percent}
                className="static translate-x-0 rounded-none bg-transparent p-0 shadow-none ring-0 @max-[34rem]/design-bar:hidden"
              />
              <EditorDesignDock />
            </div>
          )}
        </div>
        {pointing && designing && (
          // Beside a docked chat the work pane has no inspector of its own, so Design brings the
          // selected element's properties next to the email while there is room for both.
          <div
            data-slot="editor-design-properties"
            data-testid="canvas.design-properties"
            className="border-border hidden w-[300px] shrink-0 border-l @min-[44rem]/work-pane:flex"
          >
            {sourceEditable ? (
              <Inspector embedded checks={false} />
            ) : (
              <ReadonlyInspector embedded />
            )}
          </div>
        )}
      </div>
    </>
  );
  return usePart<CanvasState>(
    "editor-canvas",
    { ...props },
    {
      state: {
        zoom: canvasZoom === "fit" ? "fit" : String(canvasZoom),
        device: previewDevice,
        target: previewTarget,
      },
      className: "flex min-h-0 min-w-0 flex-1 flex-col",
      props: { children },
    },
  );
}

/** The web page has not come back yet, or the host could not draw it; the email is unaffected. */
function UnbuiltPage() {
  return (
    <div
      data-testid="canvas.page-unbuilt"
      className="border-border bg-surface-inset text-foreground rounded-xl border border-dashed p-6 text-[12.5px]"
    >
      <p className="font-medium">No preview yet</p>
      <p className="text-muted-foreground mt-1">
        The web page isn't ready. Switch to Email to keep working.
      </p>
    </div>
  );
}

/**
 * The host has no render for this revision. That is a failure only when it also
 * reported something to fix: a document nothing has executed yet is waiting for
 * its first build, and telling its author to fix the source would be wrong.
 */
function UnbuiltCanvas() {
  const errors = useEditorStore(
    useShallow((state) => state.checks.filter((check) => check.severity === "error")),
  );
  const failed = errors.length > 0;
  return (
    <div
      data-testid="canvas.unbuilt"
      data-unbuilt-reason={failed ? "failed" : "not-built"}
      className="border-border bg-surface-inset text-foreground rounded-xl border border-dashed p-6 text-[12.5px]"
    >
      <p className="font-medium">{failed ? "No preview" : "No preview yet"}</p>
      <p className="text-muted-foreground mt-1">
        {failed
          ? "The current draft broke the preview. Fix the source and it will come back."
          : "Nothing has run this entry yet. The next pass puts the preview here."}
      </p>
      {failed && (
        <ul className="mt-4 space-y-2">
          {errors.map((check) => (
            <li key={check.id}>
              <CheckDetails check={check} actions={<CheckActions check={check} />} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The email canvas with its preview bar and zoom control, as a part. */
export { CanvasPane as EditorCanvas };
