import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useEditorStore, useEditorStoreApi } from "../state/context";
import { ASSISTANT_MAX, ASSISTANT_MIN, CHAT_COLLAPSE_BELOW } from "../state/store";
import { cn, focusRing } from "./ui-classes";

type ResizeSide = "assistant" | "left" | "right";

const KEY_STEP = 8;
const KEY_STEP_LARGE = 24;
// Passed to the left and right setters, which clamp to their own bounds.
const BELOW_ANY_MINIMUM = 0;
const ABOVE_ANY_MAXIMUM = 10_000;

const LABELS: Record<ResizeSide, string> = {
  assistant: "Resize chat",
  left: "Resize layers panel",
  right: "Resize inspector",
};

const TEST_IDS: Record<ResizeSide, string> = {
  assistant: "agent-column.resize",
  left: "left-rail.resize",
  right: "inspector.resize",
};

const restoreBody = () => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
};

/**
 * A draggable divider between two panes. It measures against its own container, so it works
 * wherever the editor is embedded, and handles mouse, touch and pen through pointer events.
 * Keyboard: arrow keys step (Shift for a larger step), Home and End jump to the limits.
 * Dragging the chat divider below `CHAT_COLLAPSE_BELOW` collapses the chat and keeps its width.
 */
export function ResizeHandle({ side }: { side: ResizeSide }) {
  const storeApi = useEditorStoreApi();
  const width = useEditorStore((state) =>
    side === "assistant"
      ? state.assistantWidth
      : side === "left"
        ? state.leftWidth
        : state.rightWidth,
  );
  const { setAssistantWidth, setChatCollapsed, setLeftWidth, setRightWidth } = useEditorStore(
    (state) => state.actions,
  );
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    restoreBody();
  }, []);

  useEffect(
    () => () => {
      if (dragging.current) restoreBody();
    },
    [],
  );

  const resizeTo = (raw: number) => {
    if (side === "assistant") {
      const { chatCollapsed } = storeApi.getState();
      if (raw < CHAT_COLLAPSE_BELOW) {
        setChatCollapsed(true);
        return;
      }
      if (chatCollapsed) setChatCollapsed(false);
      setAssistantWidth(raw);
    } else if (side === "left") setLeftWidth(raw);
    else setRightWidth(raw);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragging.current = true;
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const container = event.currentTarget.parentElement;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    resizeTo(side === "right" ? rect.right - event.clientX : event.clientX - rect.left);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    // Arrow direction that grows the panel: rightwards for panes anchored on the left.
    const grow = side === "right" ? "ArrowLeft" : "ArrowRight";
    const shrink = side === "right" ? "ArrowRight" : "ArrowLeft";
    let next: number;
    if (event.key === grow) next = width + step;
    else if (event.key === shrink) next = width - step;
    else if (event.key === "Home") next = side === "assistant" ? ASSISTANT_MIN : BELOW_ANY_MINIMUM;
    else if (event.key === "End") next = side === "assistant" ? ASSISTANT_MAX : ABOVE_ANY_MAXIMUM;
    else return;
    event.preventDefault();
    resizeTo(next);
  };

  return (
    <div
      data-editor-resize={side}
      data-dragging={isDragging ? "" : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={LABELS[side]}
      aria-valuenow={width}
      aria-valuemin={side === "assistant" ? ASSISTANT_MIN : undefined}
      aria-valuemax={side === "assistant" ? ASSISTANT_MAX : undefined}
      data-testid={TEST_IDS[side]}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        "relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none outline-none",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors",
        "hover:before:w-0.5 hover:before:bg-accent-email",
        "data-[dragging]:before:w-0.5 data-[dragging]:before:bg-accent-email",
        "focus-visible:before:w-0.5 focus-visible:before:bg-accent-email",
        focusRing,
      )}
    />
  );
}
