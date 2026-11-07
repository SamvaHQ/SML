import { ZOOM_MAX, ZOOM_MIN } from "../state/store";

/** The zoom stops − and + move between, as percentages. */
export const ZOOM_STEPS: ReadonlyArray<number> = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];

/** The next stop above `percent`, or the maximum. */
export const zoomInFrom = (percent: number): number =>
  ZOOM_STEPS.find((step) => step > percent + 0.5) ?? ZOOM_MAX;

/** The next stop below `percent`, or the minimum. */
export const zoomOutFrom = (percent: number): number =>
  ZOOM_STEPS.findLast((step) => step < percent - 0.5) ?? ZOOM_MIN;

/**
 * A pinch on a trackpad arrives as a wheel event with `ctrlKey` set; a held Ctrl or ⌘ with a
 * mouse wheel means the same. Returns the zoom that gesture asks for from `percent`.
 */
export const zoomFromWheel = (percent: number, deltaY: number): number =>
  percent * Math.exp(-deltaY * 0.01);

/** A zoom request the canvas takes for itself instead of letting the browser zoom the page. */
export type ZoomGesture =
  | { readonly kind: "wheel"; readonly deltaY: number }
  | { readonly kind: "key"; readonly direction: "in" | "out" | "reset" };

/**
 * The zoom chords: ⌘ on macOS, Ctrl elsewhere, with +, − or 0, on the main row or the keypad.
 * Keys are physical (`event.code`), so `+` on the main row is Shift with `=`.
 */
export const ZOOM_HOTKEYS =
  "mod+equal, mod+shift+equal, mod+add, mod+minus, mod+shift+minus, mod+subtract, mod+0";

/** The zoom one of `ZOOM_HOTKEYS` asks for, from the key the hotkey matched. */
export const zoomDirectionOf = (hotkey: {
  readonly keys?: ReadonlyArray<string> | undefined;
}): "in" | "out" | "reset" | null => {
  const key = hotkey.keys?.[0];
  if (key === "equal" || key === "add") return "in";
  if (key === "minus" || key === "subtract") return "out";
  if (key === "0") return "reset";
  return null;
};

/** A wheel event that is a zoom gesture rather than a scroll. */
export const isZoomWheel = (event: { readonly ctrlKey: boolean; readonly metaKey: boolean }) =>
  event.ctrlKey || event.metaKey;
