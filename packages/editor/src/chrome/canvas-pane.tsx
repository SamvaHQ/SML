import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { DESKTOP_WIDTH, MOBILE_WIDTH, type DeviceMode } from "../canvas/device";
import { EmailFrame } from "../canvas/email-frame";
import { SelectionOverlay } from "../canvas/selection-overlay";
import { useEditorStore } from "../state/context";
import { CheckActions } from "./check-actions";
import { CheckDetails } from "./check-details";
import { useContributions } from "./contributions";
import { ArrowsToCenter, Mobile, Monitor } from "./editor-icons";
import { outlineAncestry, selectionLabel } from "./email-outline";
import { EnvelopeCard } from "./envelope-card";
import { NodeContextMenu, type AncestorEntry } from "./node-context-menu";
import { Segmented } from "./ui";
import { cn } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

/**
 * The center workspace: the host's rendered email on the recessed grid backdrop.
 * The frame owns click resolution against `data-samva-instance`; this pane
 * centers it at the device width, forwards selection to the store, and drops to
 * document scope when the backdrop outside the email is clicked.
 */
export function CanvasPane({ pointing = false }: { readonly pointing?: boolean | undefined }) {
  const { doc, render, outline, selection, previewDevice, canvasZoom } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      outline: state.outline,
      selection: state.selection,
      previewDevice: state.previewDevice,
      canvasZoom: state.canvasZoom,
    })),
  );
  const { select, selectDocument, setHovered, setPreviewDevice, setCanvasZoom } = useEditorStore(
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
  const scale = canvasZoom === "fit" ? fitScale : 1;

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
        onSelect={select}
        onHover={setHovered}
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
    <div className="samva-editor-workspace relative flex min-w-0 flex-1 flex-col">
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
        className="samva-editor-scroll relative flex-1 overflow-auto px-10 pt-10 pb-24 [overflow-anchor:none]"
        onClick={selectDocument}
      >
        {doc === null ? (
          <div className="text-muted-foreground grid h-full place-items-center text-[12.5px]">
            Loading document…
          </div>
        ) : (
          <div
            className="mx-auto"
            data-canvas-zoom={canvasZoom}
            style={{ width: deviceWidth, zoom: scale }}
            // Stop the workspace's deselect handler so clicks inside the column keep
            // their resolved selection (the envelope card and frame report their own
            // target); only the bare backdrop drops to document scope.
            onClick={(event) => event.stopPropagation()}
          >
            {doc.channel === "email" && doc.preview.status === "stale" && (
              <div
                data-testid="canvas.preview-stale"
                className="border-warning/35 bg-warning/10 text-foreground mb-3 rounded-[9px] border px-3 py-2 text-[12px] shadow-sm"
              >
                Showing the last preview that worked. Your latest edit has a problem:{" "}
                {doc.preview.reason}
              </div>
            )}
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
      {doc !== null && (
        <div className="border-border bg-background/95 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-[9px] border p-1 shadow-[var(--shadow-lg)] backdrop-blur-md">
          <Segmented
            ariaLabel="Canvas preview width"
            value={previewDevice}
            onChange={(value) => setPreviewDevice(value as DeviceMode)}
            size="sm"
            options={[
              {
                value: "desktop",
                title: "Preview desktop width",
                testId: "canvas.device.desktop",
                label: <Monitor className="size-[13px]" />,
              },
              {
                value: "mobile",
                title: "Preview mobile width",
                testId: "canvas.device.mobile",
                label: <Mobile className="size-[13px]" />,
              },
            ]}
          />
          <button
            type="button"
            data-testid="canvas.zoom"
            title={canvasZoom === "fit" ? "Show canvas at 100%" : "Fit canvas to workspace"}
            aria-label={canvasZoom === "fit" ? "Show canvas at 100%" : "Fit canvas to workspace"}
            onClick={() => setCanvasZoom(canvasZoom === "fit" ? "100" : "fit")}
            className={cn(
              "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px] transition-colors",
              canvasZoom === "fit" && "bg-sel-soft text-accent-email",
            )}
          >
            <ArrowsToCenter className="size-[14px]" />
            {canvasZoom === "fit" ? "Fit" : "100%"}
          </button>
        </div>
      )}
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
