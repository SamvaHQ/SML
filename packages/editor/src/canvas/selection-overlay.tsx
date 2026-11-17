import type { EmailElementSelection } from "@samva/markup/edit";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { selectionLabel } from "../chrome/email-outline";
import { firstVisibleRect, neighbourBoxes, type Box } from "./instance-dom";

const outlineStyle = (box: Box, color: string, weight: number): CSSProperties => ({
  position: "fixed",
  top: box.top,
  left: box.left,
  width: box.width,
  height: box.height,
  outline: `${weight}px solid ${color}`,
  // The selection sits just outside the element, so its text never touches the line.
  outlineOffset: weight > 1 ? 2 : -weight,
  pointerEvents: "none",
  zIndex: 2147483646,
});

/** A pin drawn on the email: its number at the top-left corner of the element it names. */
export interface OverlayPin {
  readonly number: number;
  readonly instancePath: string;
}

export interface SelectionOverlayProps {
  /** Identity of the render being outlined; a new one re-measures even at stable paths. */
  readonly renderRevision: string;
  readonly selected: EmailElementSelection | null;
  readonly hovered: EmailElementSelection | null;
  /** Name the selected element on a chip. Design shows its toolbar outside the frame instead. */
  readonly chip?: boolean | undefined;
  /**
   * Where the selected element and the content around it are laid out, in the frame's
   * coordinates, each time they are measured; null when nothing selected is laid out. The
   * Design toolbar is placed from it in the page around the frame.
   */
  readonly onSelectedGeometry?: ((geometry: SelectedGeometry | null) => void) | undefined;
  readonly pins?: ReadonlyArray<OverlayPin> | undefined;
}

/** The selected element's layout, read in the email's frame. */
export interface SelectedGeometry {
  /** The frame the boxes are measured in. */
  readonly frame: HTMLIFrameElement;
  readonly element: Box;
  readonly neighbours: ReadonlyArray<Box>;
}

const NO_PINS: ReadonlyArray<OverlayPin> = [];

/**
 * Chrome that sits over the rendered document, never inside it: fixed coordinates
 * in the frame viewport track the target element without wrapping it, so the
 * email stays structurally untouched.
 *
 * The chip names what the selection actually is — the tag, whether the renderer
 * generated it, and which iteration of a repeated authoring it is. In Design the
 * toolbar outside the frame takes the chip's place; pins number the elements they name.
 */
export const SelectionOverlay = ({
  renderRevision,
  selected,
  hovered,
  chip = true,
  onSelectedGeometry,
  pins = NO_PINS,
}: SelectionOverlayProps): ReactNode => {
  const anchor = useRef<HTMLDivElement>(null);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [hoveredBox, setHoveredBox] = useState<Box | null>(null);
  const [pinBoxes, setPinBoxes] = useState<
    ReadonlyArray<{ readonly number: number; readonly box: Box }>
  >([]);
  const selectedPath = selected?.instancePath ?? null;
  const hoveredPath = hovered?.instancePath ?? null;
  // Read when measuring, so a new callback identity never re-measures.
  const report = useRef(onSelectedGeometry);
  useLayoutEffect(() => {
    report.current = onSelectedGeometry;
  }, [onSelectedGeometry]);
  const reports = onSelectedGeometry !== undefined;

  // The email keeps laying out after it mounts (web fonts, images), which moves elements without
  // a new render; a resize of its body measures again.
  const [layout, setLayout] = useState(0);
  useLayoutEffect(() => {
    const body = anchor.current?.ownerDocument.body;
    if (body === undefined || typeof ResizeObserver === "undefined") return;
    const view = body.ownerDocument.defaultView;
    const remeasure = () => setLayout((count) => count + 1);
    const observer = new ResizeObserver(remeasure);
    observer.observe(body);
    void body.ownerDocument.fonts?.ready.then(remeasure);
    view?.addEventListener("load", remeasure, true);
    return () => {
      observer.disconnect();
      view?.removeEventListener("load", remeasure, true);
    };
  }, []);

  useLayoutEffect(() => {
    const root = anchor.current?.ownerDocument;
    if (root === undefined) return;
    const element = selectedPath === null ? null : firstVisibleRect(root, selectedPath);
    setSelectedBox(element);
    const frame = root.defaultView?.frameElement;
    report.current?.(
      selectedPath === null || element === null || !(frame instanceof HTMLIFrameElement)
        ? null
        : { frame, element, neighbours: neighbourBoxes(root, selectedPath) },
    );
    // A replaced render moves geometry without changing the selected path.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- renderRevision and layout are the identity of the geometry being measured, and `reports` measures again for a new listener.
  }, [renderRevision, selectedPath, layout, reports]);

  useLayoutEffect(() => {
    const root = anchor.current?.ownerDocument;
    if (root === undefined) return;
    setHoveredBox(
      hoveredPath === null || hoveredPath === selectedPath
        ? null
        : firstVisibleRect(root, hoveredPath),
    );
    setPinBoxes(
      pins.flatMap((pin) => {
        const box = firstVisibleRect(root, pin.instancePath);
        return box === null ? [] : [{ number: pin.number, box }];
      }),
    );
    // A replaced render moves geometry without changing the selected paths.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- renderRevision and layout are the identity of the geometry being measured, not values read in the effect body.
  }, [renderRevision, selectedPath, hoveredPath, pins, layout]);

  // A frame that goes away takes its geometry with it.
  useLayoutEffect(() => () => report.current?.(null), []);

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
          {chip && (
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
          )}
        </>
      ) : null}
      {pinBoxes.map(({ number, box }) => (
        <span
          key={number}
          className="samva-pin"
          data-samva-pin={number}
          style={{ top: Math.max(2, box.top - 8), left: Math.max(2, box.left - 8) }}
        >
          {number}
        </span>
      ))}
    </div>
  );
};
