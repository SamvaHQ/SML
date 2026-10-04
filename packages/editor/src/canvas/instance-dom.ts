import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/render";

export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

const boxOf = (rect: DOMRect): Box => ({
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
});

/**
 * The rect to outline for an instance path. A renderer can emit the same path on
 * light/dark twins of one element, one of which is `display:none` and measures
 * 0×0 — so match all of them, prefer the first with a real rect, and fall back
 * deterministically to the first match when none has laid out yet.
 */
export const firstVisibleRect = (root: ParentNode, instancePath: string): Box | null => {
  const elements = root.querySelectorAll(
    `[${INSTANCE_PATH_ATTRIBUTE}="${CSS.escape(instancePath)}"]`,
  );
  let fallback: Box | null = null;
  for (const element of elements) {
    const box = boxOf(element.getBoundingClientRect());
    fallback ??= box;
    if (box.width > 0 && box.height > 0) return box;
  }
  return fallback;
};

const INTERACTIVE_SELECTOR =
  'a[href],button,input[type="button"],input[type="submit"],input[type="image"]';

const hasClosest = (
  target: EventTarget | null,
): target is EventTarget & { closest: (selector: string) => Element | null } =>
  target !== null && "closest" in target && typeof target.closest === "function";

/** True when a canvas click would activate link/button behavior in the email. */
export const isCanvasActivationTarget = (target: EventTarget | null): boolean =>
  hasClosest(target) && target.closest(INTERACTIVE_SELECTOR) !== null;

/** The rendered instance a DOM target belongs to, or null outside the document. */
export const resolveInstancePath = (target: EventTarget | null): string | null =>
  hasClosest(target)
    ? (target.closest(`[${INSTANCE_PATH_ATTRIBUTE}]`)?.getAttribute(INSTANCE_PATH_ATTRIBUTE) ??
      null)
    : null;
