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

/** The zoom a key chord asks for: ⌘/Ctrl with +, − or 0. Anything else is not a zoom. */
export const zoomKeyOf = (event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}): "in" | "out" | "reset" | null => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "reset";
  return null;
};

/** A wheel event that is a zoom gesture rather than a scroll. */
export const isZoomWheel = (event: { readonly ctrlKey: boolean; readonly metaKey: boolean }) =>
  event.ctrlKey || event.metaKey;
