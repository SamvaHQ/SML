import { describe, expect, it } from "@effect/vitest";

import {
  ZOOM_STEPS,
  isZoomWheel,
  zoomFromWheel,
  zoomInFrom,
  zoomKeyOf,
  zoomOutFrom,
} from "../src/canvas/zoom";
import { ZOOM_MAX, ZOOM_MIN } from "../src/state/store";

const key = (
  name: string,
  modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {},
): Parameters<typeof zoomKeyOf>[0] => ({
  key: name,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
});

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
  it("reads ⌘ and Ctrl with = or + as zoom in", () => {
    expect(zoomKeyOf(key("=", { meta: true }))).toBe("in");
    expect(zoomKeyOf(key("+", { meta: true }))).toBe("in");
    expect(zoomKeyOf(key("=", { ctrl: true }))).toBe("in");
  });

  it("reads ⌘ and Ctrl with - or _ as zoom out", () => {
    expect(zoomKeyOf(key("-", { ctrl: true }))).toBe("out");
    expect(zoomKeyOf(key("-", { meta: true }))).toBe("out");
    expect(zoomKeyOf(key("_", { ctrl: true }))).toBe("out");
  });

  it("reads ⌘0 and Ctrl+0 as reset", () => {
    expect(zoomKeyOf(key("0", { meta: true }))).toBe("reset");
    expect(zoomKeyOf(key("0", { ctrl: true }))).toBe("reset");
  });

  it("ignores the same keys without ⌘ or Ctrl", () => {
    expect(zoomKeyOf(key("="))).toBeNull();
    expect(zoomKeyOf(key("-"))).toBeNull();
    expect(zoomKeyOf(key("0"))).toBeNull();
  });

  it("ignores any chord with Alt held", () => {
    expect(zoomKeyOf(key("=", { meta: true, alt: true }))).toBeNull();
    expect(zoomKeyOf(key("-", { ctrl: true, alt: true }))).toBeNull();
    expect(zoomKeyOf(key("0", { meta: true, ctrl: true, alt: true }))).toBeNull();
  });

  it("ignores other keys under ⌘ or Ctrl", () => {
    expect(zoomKeyOf(key("a", { meta: true }))).toBeNull();
    expect(zoomKeyOf(key("1", { ctrl: true }))).toBeNull();
  });
});
