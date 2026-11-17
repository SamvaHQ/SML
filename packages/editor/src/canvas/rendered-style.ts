import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/edit";
import { useEffect, useState, type RefObject } from "react";

import { useEditorStore } from "../state/context";

/** What a selected element renders at in the canvas, read from the browser's computed style. */
export interface RenderedStyle {
  /** The text color as the browser serializes it (`rgb(23, 24, 28)`). */
  readonly color: string;
  readonly backgroundColor: string;
  /** Pixels. */
  readonly fontSize: number;
  /** 100–900. */
  readonly fontWeight: number;
  readonly fontFamily: string;
  /** Whether the canvas frame prefers the dark scheme. */
  readonly prefersDark: boolean;
  /** The element's text as rendered, whitespace collapsed. */
  readonly text: string;
}

/** The editing canvas frames: the preview the author clicks in. */
const FRAME_SELECTOR = 'iframe[data-testid="canvas.frame"]';

/**
 * The rendered element for an instance path. A renderer can emit the same path on light/dark
 * twins of one element, one of which is `display:none`, so the first with a real box wins and
 * the first match stands in when none has laid out.
 */
export const renderedElement = (root: ParentNode, instancePath: string): Element | null => {
  const elements = root.querySelectorAll(
    `[${INSTANCE_PATH_ATTRIBUTE}="${CSS.escape(instancePath)}"]`,
  );
  for (const element of elements) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return element;
  }
  return elements[0] ?? null;
};

/** The computed style of `element`, in the units the inspector shows. */
export const renderedStyleOf = (element: Element): RenderedStyle | null => {
  const view = element.ownerDocument.defaultView;
  if (view === null) return null;
  const style = view.getComputedStyle(element);
  const size = Number.parseFloat(style.fontSize);
  const weight = Number.parseInt(style.fontWeight, 10);
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontSize: Number.isFinite(size) ? size : 0,
    fontWeight: Number.isFinite(weight) ? weight : style.fontWeight === "bold" ? 700 : 400,
    fontFamily: style.fontFamily,
    prefersDark: view.matchMedia("(prefers-color-scheme: dark)").matches,
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
};

/** The canvas frames beside `anchor`: those in its editor frame, or in its document without one. */
const canvasFrames = (anchor: Element): ReadonlyArray<HTMLIFrameElement> => {
  const scope = anchor.closest(".samva-editor-frame") ?? anchor.ownerDocument;
  return [...scope.querySelectorAll<HTMLIFrameElement>(FRAME_SELECTOR)];
};

const readStyle = (anchor: Element, instancePath: string): RenderedStyle | null => {
  for (const frame of canvasFrames(anchor)) {
    const document_ = frame.contentDocument;
    const element = document_ === null ? null : renderedElement(document_, instancePath);
    if (element !== null) return renderedStyleOf(element);
  }
  return null;
};

/**
 * The computed style of the selected instance in the editing canvas, read again whenever the
 * render or the selection moves. `anchor` is any element inside the editor, which scopes the
 * lookup to that editor's canvas when a page mounts two.
 */
export function useRenderedStyle(
  anchor: RefObject<Element | null>,
  instancePath: string | null,
): RenderedStyle | null {
  const revision = useEditorStore((state) => state.render?.revision ?? null);
  const epoch = useEditorStore((state) => state.previewEpoch);
  const [style, setStyle] = useState<{
    readonly key: string;
    readonly style: RenderedStyle | null;
  } | null>(null);
  const key = `${revision ?? ""}\u0000${epoch}\u0000${instancePath ?? ""}`;
  useEffect(() => {
    const element = anchor.current;
    if (element === null || instancePath === null) return;
    const read = () => setStyle({ key, style: readStyle(element, instancePath) });
    read();
    // The canvas installs a new render's document in the same commit or the next frame.
    const frame = requestAnimationFrame(read);
    return () => cancelAnimationFrame(frame);
  }, [anchor, instancePath, key]);
  return style?.key === key ? style.style : null;
}
