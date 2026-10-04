import type { EmailElementSelection } from "@samva/markup/render";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { selectionLabel } from "../chrome/email-outline";
import { firstVisibleRect, type Box } from "./instance-dom";

const outlineStyle = (box: Box, color: string, weight: number): CSSProperties => ({
  position: "fixed",
  top: box.top,
  left: box.left,
  width: box.width,
  height: box.height,
  outline: `${weight}px solid ${color}`,
  outlineOffset: -weight,
  pointerEvents: "none",
  zIndex: 2147483646,
});

export interface SelectionOverlayProps {
  /** Identity of the render being outlined; a new one re-measures even at stable paths. */
  readonly renderRevision: string;
  readonly selected: EmailElementSelection | null;
  readonly hovered: EmailElementSelection | null;
}

/**
 * Chrome that sits over the rendered document, never inside it: fixed coordinates
 * in the frame viewport track the target element without wrapping it, so the
 * email stays structurally untouched.
 *
 * The chip names what the selection actually is — the tag, whether the renderer
 * generated it, and which iteration of a repeated authoring it is.
 */
export const SelectionOverlay = ({
  renderRevision,
  selected,
  hovered,
}: SelectionOverlayProps): ReactNode => {
  const anchor = useRef<HTMLDivElement>(null);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [hoveredBox, setHoveredBox] = useState<Box | null>(null);
  const selectedPath = selected?.instancePath ?? null;
  const hoveredPath = hovered?.instancePath ?? null;

  useLayoutEffect(() => {
    const root = anchor.current?.ownerDocument;
    if (root === undefined) return;
    setSelectedBox(selectedPath === null ? null : firstVisibleRect(root, selectedPath));
    setHoveredBox(
      hoveredPath === null || hoveredPath === selectedPath
        ? null
        : firstVisibleRect(root, hoveredPath),
    );
    // A replaced render moves geometry without changing the selected paths.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- renderRevision is the identity of the geometry being measured, not a value read in the effect body.
  }, [renderRevision, selectedPath, hoveredPath]);

  return (
    <div
      ref={anchor}
      data-samva-overlay
      style={{ position: "fixed", inset: 0, pointerEvents: "none" }}
    >
      {hoveredBox !== null ? (
        <div style={outlineStyle(hoveredBox, "var(--editor-canvas-hover)", 1)} />
      ) : null}
      {selectedBox !== null && selected !== null ? (
        <>
          <div
            style={outlineStyle(
              selectedBox,
              selected.authored
                ? "var(--editor-canvas-selected)"
                : "var(--editor-canvas-generated)",
              2,
            )}
          />
          <div
            data-samva-chip
            style={{
              position: "fixed",
              top: Math.max(0, selectedBox.top - 18),
              left: selectedBox.left,
              padding: "1px 6px",
              borderRadius: 4,
              background: selected.authored
                ? "var(--editor-canvas-selected)"
                : "var(--editor-canvas-generated)",
              color: "var(--editor-canvas-selected-fg)",
              font: "11px/1.4 ui-sans-serif, system-ui, sans-serif",
              pointerEvents: "none",
              zIndex: 2147483647,
            }}
          >
            {selected.authored
              ? selectionLabel(selected)
              : `${selectionLabel(selected)} · generated`}
          </div>
        </>
      ) : null}
    </div>
  );
};
