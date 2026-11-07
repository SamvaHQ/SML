import { describe, expect, it } from "@effect/vitest";

import {
  ZOOM_STEPS,
  isZoomWheel,
  zoomFromWheel,
  zoomInFrom,
  zoomDirectionOf,
  zoomOutFrom,
} from "../src/canvas/zoom";
import { ZOOM_MAX, ZOOM_MIN } from "../src/state/store";

describe("zoom steps", () => {
  it("run from the minimum to the maximum zoom", () => {
    expect(ZOOM_STEPS[0]).toBe(ZOOM_MIN);
    expect(ZOOM_STEPS.at(-1)).toBe(ZOOM_MAX);
  });

  it("moves between neighbouring stops", () => {
    expect(zoomInFrom(100)).toBe(110);
    expect(zoomOutFrom(100)).toBe(90);
    expect(zoomInFrom(50)).toBe(67);
    expect(zoomOutFrom(200)).toBe(175);
  });

  it("walks the whole ladder in both directions", () => {
    const up = [ZOOM_MIN];
    while (up.at(-1)! < ZOOM_MAX) up.push(zoomInFrom(up.at(-1)!));
    expect(up).toEqual(ZOOM_STEPS);
    const down = [ZOOM_MAX];
    while (down.at(-1)! > ZOOM_MIN) down.push(zoomOutFrom(down.at(-1)!));
    expect(down.toReversed()).toEqual(ZOOM_STEPS);
  });

  it("snaps to the next stop from a value between stops", () => {
    expect(zoomInFrom(83)).toBe(90);
    expect(zoomOutFrom(83)).toBe(75);
    expect(zoomInFrom(61.3)).toBe(67);
    expect(zoomOutFrom(61.3)).toBe(50);
  });

  it("treats a value within half a percent of a stop as that stop", () => {
    expect(zoomInFrom(99.7)).toBe(110);
    expect(zoomOutFrom(100.3)).toBe(90);
  });

  it("clamps at the ends", () => {
    expect(zoomInFrom(200)).toBe(ZOOM_MAX);
    expect(zoomInFrom(500)).toBe(ZOOM_MAX);
    expect(zoomOutFrom(50)).toBe(ZOOM_MIN);
    expect(zoomOutFrom(10)).toBe(ZOOM_MIN);
  });
});

describe("zoom wheel", () => {
  it("zooms in on a negative delta and out on a positive one", () => {
    expect(zoomFromWheel(100, -100)).toBeGreaterThan(100);
    expect(zoomFromWheel(100, 100)).toBeLessThan(100);
  });

  it("leaves the zoom alone for a zero delta", () => {
    expect(zoomFromWheel(100, 0)).toBe(100);
  });

  it("is multiplicative and symmetric", () => {
    expect(zoomFromWheel(100, -100)).toBeCloseTo(100 * Math.exp(1), 6);
    expect(zoomFromWheel(zoomFromWheel(80, -40), 40)).toBeCloseTo(80, 6);
  });

  it("scales the change with the zoom it starts from", () => {
    const low = zoomFromWheel(50, -10) - 50;
    const high = zoomFromWheel(150, -10) - 150;
    expect(high / low).toBeCloseTo(3, 6);
  });

  it("is a zoom gesture only with Ctrl or ⌘ held", () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
});

describe("zoom keys", () => {
  it("reads = and the keypad + as zoom in", () => {
    expect(zoomDirectionOf({ keys: ["equal"] })).toBe("in");
    expect(zoomDirectionOf({ keys: ["add"] })).toBe("in");
  });

  it("reads - and the keypad − as zoom out", () => {
    expect(zoomDirectionOf({ keys: ["minus"] })).toBe("out");
    expect(zoomDirectionOf({ keys: ["subtract"] })).toBe("out");
  });

  it("reads 0 as reset", () => {
    expect(zoomDirectionOf({ keys: ["0"] })).toBe("reset");
  });

  it("reads any other key as no zoom", () => {
    expect(zoomDirectionOf({ keys: ["a"] })).toBeNull();
    expect(zoomDirectionOf({})).toBeNull();
  });
});
