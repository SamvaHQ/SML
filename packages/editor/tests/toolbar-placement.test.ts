import { describe, expect, it } from "@effect/vitest";

import type { Box } from "../src/canvas/instance-dom";
import {
  placeToolbar,
  TOOLBAR_GAP,
  type ToolbarPlacementInput,
} from "../src/canvas/toolbar-placement";

const box = (left: number, top: number, width: number, height: number): Box => ({
  top,
  left,
  width,
  height,
});

const VERTICAL = { width: 30, height: 150 };
const HORIZONTAL = { width: 240, height: 30 };

/** A 600px email column 40px into a viewport, with a heading 200px down. */
const input = (overrides: Partial<ToolbarPlacementInput>): ToolbarPlacementInput => ({
  element: box(80, 240, 400, 40),
  column: box(40, 40, 600, 1200),
  viewport: box(0, 0, 680, 800),
  vertical: VERTICAL,
  horizontal: HORIZONTAL,
  neighbours: [],
  ...overrides,
});

describe("placeToolbar", () => {
  it("stacks the actions in the gutter right of the email when there is room", () => {
    expect(placeToolbar(input({}))).toEqual({
      orientation: "vertical",
      side: "right",
      top: 240,
      left: 640 + TOOLBAR_GAP,
    });
  });

  it("takes the left gutter when only the left has room", () => {
    const placement = placeToolbar(input({ column: box(40, 40, 630, 1200) }));
    expect(placement).toMatchObject({ orientation: "vertical", side: "left", top: 240 });
    expect(placement.left).toBe(40 - TOOLBAR_GAP - VERTICAL.width);
  });

  it("sits over the element when no gutter has room and nothing is above it", () => {
    const placement = placeToolbar(input({ column: box(0, 40, 680, 1200) }));
    expect(placement).toEqual({
      orientation: "horizontal",
      side: "above",
      top: 240 - TOOLBAR_GAP - HORIZONTAL.height,
      left: 80,
    });
  });

  it("goes under a heading with a badge just above it", () => {
    // The order confirmation: a "✓ Order confirmed" pill 12px above the heading.
    const badge = box(80, 196, 140, 32);
    const placement = placeToolbar(input({ column: box(0, 40, 680, 1200), neighbours: [badge] }));
    expect(placement).toMatchObject({ orientation: "horizontal", side: "below", top: 284 });
  });

  it("covers the least content when both sides cover something", () => {
    const tight = box(80, 220, 60, 10);
    const wide = box(80, 290, 240, 20);
    expect(
      placeToolbar(input({ column: box(0, 40, 680, 1200), neighbours: [tight, wide] })),
    ).toMatchObject({ side: "above" });
    const tall = box(80, 200, 240, 30);
    expect(
      placeToolbar(input({ column: box(0, 40, 680, 1200), neighbours: [tall, tight] })),
    ).toMatchObject({ side: "below" });
  });

  it("keeps a row inside the column, then on screen", () => {
    const right = placeToolbar(
      input({ column: box(20, 40, 640, 1200), element: box(560, 240, 100, 40) }),
    );
    expect(right.left).toBe(660 - HORIZONTAL.width);
    // Zoomed past the viewport: the column runs off screen, the row stays on it.
    const zoomed = placeToolbar(
      input({ column: box(-200, 40, 1200, 1200), element: box(700, 240, 300, 40) }),
    );
    expect(zoomed.left).toBe(680 - HORIZONTAL.width - 4);
  });

  it("goes under an element at the top of the email, and to the column's top when it fills it", () => {
    const top = placeToolbar(
      input({ column: box(0, 40, 680, 1200), element: box(80, 50, 400, 40) }),
    );
    expect(top).toMatchObject({ side: "below", top: 50 + 40 + TOOLBAR_GAP });
    const filling = placeToolbar(
      input({ column: box(0, 40, 680, 300), element: box(0, 40, 680, 300) }),
    );
    expect(filling).toMatchObject({ orientation: "horizontal", top: 40 });
  });

  it("holds a stacked toolbar on screen beside a tall element, within the element", () => {
    // Scrolled so the element's top is above the viewport: the toolbar stays at the top edge.
    expect(placeToolbar(input({ element: box(80, -300, 400, 900) })).top).toBe(4);
    // Near its end, it stops at the element's bottom rather than following the viewport.
    expect(placeToolbar(input({ element: box(80, -300, 400, 400) })).top).toBe(
      100 - VERTICAL.height,
    );
    // An element starting low on screen keeps its toolbar level with it.
    expect(placeToolbar(input({ element: box(80, 760, 400, 40) })).top).toBe(760);
  });
});
