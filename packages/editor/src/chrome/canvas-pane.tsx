import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { DESKTOP_WIDTH, MOBILE_WIDTH } from "../canvas/device";
import { EmailFrame } from "../canvas/email-frame";
import { SelectionOverlay } from "../canvas/selection-overlay";
import {
  isZoomWheel,
  zoomFromWheel,
  zoomInFrom,
  zoomKeyOf,
  zoomOutFrom,
  type ZoomGesture,
} from "../canvas/zoom";
import { useEditorStore } from "../state/context";
import { CheckActions } from "./check-actions";
import { CheckDetails } from "./check-details";
import { useContributions } from "./contributions";
import { outlineAncestry, selectionLabel } from "./email-outline";
import { EnvelopeCard } from "./envelope-card";
import { NodeContextMenu, type AncestorEntry } from "./node-context-menu";
import { PreviewBar, PreviewNotice } from "./preview-bar";
import { useEditorPortalContainer } from "./use-editor-portal";
import { ZoomControl } from "./zoom-control";

/**
 * The center workspace: the preview bar, then the host's rendered email on the recessed grid
 * backdrop with a floating zoom control. The frame owns click resolution against
 * `data-samva-instance`; this pane centers it at the device width, forwards selection to the
 * store, and drops to document scope when the backdrop outside the email is clicked. While
 * `active`, a pinch or ⌘/Ctrl with +, − or 0 zooms the canvas rather than the page.
 */
export function CanvasPane({
  pointing = false,
  active = true,
}: {
  readonly pointing?: boolean | undefined;
  /** The pane is on screen; a hidden pane leaves zoom chords to the page. */
  readonly active?: boolean | undefined;
}) {
  const { doc, render, outline, selection, previewDevice, canvasZoom, previewEpoch } =
    useEditorStore(
      useShallow((state) => ({
        doc: state.doc,
        render: state.render,
        outline: state.outline,
        selection: state.selection,
        previewDevice: state.previewDevice,
        canvasZoom: state.canvasZoom,
        previewEpoch: state.previewEpoch,
      })),
    );
  const { select, selectDocument, setHovered, setCanvasZoom } = useEditorStore(
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
      if (pointing || outline === null || input.instancePath === null) {
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
    [outline, pointing, select],
  );

  const frame =
    render === null ? null : (
      <EmailFrame
        html={render.html}
        width={deviceWidth}
        epoch={previewEpoch}
        onSelect={select}
        onHover={setHovered}
        onZoomGesture={active ? onZoomGesture : undefined}
        onContextMenu={pointing ? undefined : openContextMenu}
        overlay={
          <SelectionOverlay
            renderRevision={render.revision}
            selected={selected}
            hovered={hovered}
          />
        }
      />
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {doc !== null && doc.channel === "email" && (
        <>
          <PreviewBar />
          <PreviewNotice />
        </>
      )}
      <div className="samva-editor-workspace relative flex min-h-0 min-w-0 flex-1 flex-col">
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
          className="samva-editor-scroll relative flex-1 [scrollbar-gutter:stable] overflow-auto px-10 pt-10 pb-24 [overflow-anchor:none]"
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
              <EnvelopeCard />
              {frame === null ? (
                <UnbuiltCanvas />
              ) : pointing ? (
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
        {doc !== null && <ZoomControl percent={percent} />}
      </div>
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
