import type { Box } from "./instance-dom";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the Design toolbar sits relative to the selected element. */
export type ToolbarSide = "right" | "left" | "above" | "below";

export interface ToolbarPlacement {
  /** Stacked beside the email in a gutter, or in a row over or under the element. */
  readonly orientation: "vertical" | "horizontal";
  readonly side: ToolbarSide;
  readonly top: number;
  readonly left: number;
}

/** Every box in one coordinate space, the page the canvas is drawn on. */
export interface ToolbarPlacementInput {
  /** The selected element. */
  readonly element: Box;
  /** The email column (the frame the email renders in). */
  readonly column: Box;
  /** The part of the canvas on screen. */
  readonly viewport: Box;
  /** The toolbar's size with its actions stacked. */
  readonly vertical: Size;
  /** The toolbar's size in a row, with the element's name. */
  readonly horizontal: Size;
  /** Rendered content near the element that is not the element, its ancestors or its content. */
  readonly neighbours: ReadonlyArray<Box>;
}

/** Space between the toolbar and what it sits beside. */
export const TOOLBAR_GAP = 4;
/** Space kept between the toolbar and the edge of the canvas on screen. */
const EDGE = 4;
/** Space kept clear around neighbouring content. */
const CLEARANCE = 4;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/** How much of the neighbouring content a toolbar at `box` would cover, with a clear margin. */
const covered = (box: Box, neighbours: ReadonlyArray<Box>): number => {
  const padded = {
    top: box.top - CLEARANCE,
    left: box.left - CLEARANCE,
    width: box.width + CLEARANCE * 2,
    height: box.height + CLEARANCE * 2,
  };
  return neighbours.reduce((sum, neighbour) => sum + overlap(padded, neighbour), 0);
};

/**
 * Where the Design toolbar goes so it covers neither the element nor what is around it.
 *
 * Beside the email first: when the canvas has room next to the email column (right, then left),
 * the actions stack there, level with the element's top. That space holds no email content, so
 * nothing can be covered. A tall element keeps its toolbar on screen while any of it is.
 *
 * Without that room the toolbar is a row over the element, then under it, starting at the
 * element's left edge and kept inside the column. The first of the two that stays inside the
 * column and clear of neighbouring content wins, a row on screen before one scrolled out of
 * view; when both cover something, the one covering least. When neither fits inside the column, the element fills it, and the row sits at the
 * column's top.
 */
export const placeToolbar = (input: ToolbarPlacementInput): ToolbarPlacement => {
  const { element, column, viewport, vertical, horizontal, neighbours } = input;
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const columnRight = column.left + column.width;
  const columnBottom = column.top + column.height;
  const elementBottom = element.top + element.height;

  // Level with the element's top, held on screen, but never past the element's own span.
  const besideTop = clamp(
    clamp(element.top, viewport.top + EDGE, viewportBottom - vertical.height - EDGE),
    element.top,
    Math.max(element.top, elementBottom - vertical.height),
  );
  const right = columnRight + TOOLBAR_GAP;
  if (right + vertical.width <= viewportRight) {
    return { orientation: "vertical", side: "right", top: besideTop, left: right };
  }
  const left = column.left - TOOLBAR_GAP - vertical.width;
  if (left >= viewport.left) {
    return { orientation: "vertical", side: "left", top: besideTop, left };
  }

  const rowLeft = clamp(
    clamp(element.left, column.left, columnRight - horizontal.width),
    viewport.left + EDGE,
    viewportRight - horizontal.width - EDGE,
  );
  const candidates = [
    { side: "above" as const, top: element.top - TOOLBAR_GAP - horizontal.height },
    { side: "below" as const, top: elementBottom + TOOLBAR_GAP },
  ]
    .filter(({ top }) => top >= column.top && top + horizontal.height <= columnBottom)
    .map((candidate) => ({
      ...candidate,
      onScreen:
        candidate.top >= viewport.top && candidate.top + horizontal.height <= viewportBottom,
      covers: covered(
        { top: candidate.top, left: rowLeft, width: horizontal.width, height: horizontal.height },
        neighbours,
      ),
    }));
  const better = (
    candidate: (typeof candidates)[number],
    chosen: (typeof candidates)[number],
  ): boolean =>
    candidate.onScreen === chosen.onScreen ? candidate.covers < chosen.covers : candidate.onScreen;
  const best = candidates.reduce<(typeof candidates)[number] | undefined>(
    (chosen, candidate) => (chosen === undefined || better(candidate, chosen) ? candidate : chosen),
    undefined,
  );
  return {
    orientation: "horizontal",
    side: best?.side ?? "above",
    top: best?.top ?? column.top,
    left: rowLeft,
  };
};
