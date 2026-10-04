import { useEffect, useRef } from "react";

import { useEditorStore } from "../state/context";
import { cn } from "./ui-classes";

/** A draggable rail divider. Keyboard-resizable (arrow keys, Shift for a larger step). */
export function ResizeHandle({ side }: { side: "assistant" | "assistant-end" | "left" | "right" }) {
  const leftWidth = useEditorStore((state) => state.leftWidth);
  const assistantWidth = useEditorStore((state) => state.assistantWidth);
  const rightWidth = useEditorStore((state) => state.rightWidth);
  const { setAssistantWidth, setLeftWidth, setRightWidth } = useEditorStore(
    (state) => state.actions,
  );
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current) return;
      if (side === "assistant") setAssistantWidth(event.clientX);
      else if (side === "assistant-end") setAssistantWidth(window.innerWidth - event.clientX);
      else if (side === "left") setLeftWidth(event.clientX);
      else setRightWidth(window.innerWidth - event.clientX);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [side, setAssistantWidth, setLeftWidth, setRightWidth]);

  const width =
    side === "assistant" || side === "assistant-end"
      ? assistantWidth
      : side === "left"
        ? leftWidth
        : rightWidth;
  const label =
    side === "assistant" || side === "assistant-end"
      ? "Resize Assistant"
      : side === "left"
        ? "Resize layers panel"
        : "Resize inspector";

  return (
    <div
      data-editor-resize={side}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-label={label}
      data-testid={
        side === "assistant" || side === "assistant-end"
          ? "agent-column.resize"
          : side === "left"
            ? "left-rail.resize"
            : "inspector.resize"
      }
      tabIndex={0}
      onMouseDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 8;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        if (side === "assistant") {
          if (event.key === "ArrowLeft") setAssistantWidth(assistantWidth - step);
          if (event.key === "ArrowRight") setAssistantWidth(assistantWidth + step);
        } else if (side === "assistant-end") {
          if (event.key === "ArrowLeft") setAssistantWidth(assistantWidth + step);
          if (event.key === "ArrowRight") setAssistantWidth(assistantWidth - step);
        } else if (side === "left") {
          if (event.key === "ArrowLeft") setLeftWidth(leftWidth - step);
          if (event.key === "ArrowRight") setLeftWidth(leftWidth + step);
        } else {
          if (event.key === "ArrowLeft") setRightWidth(rightWidth + step);
          if (event.key === "ArrowRight") setRightWidth(rightWidth - step);
        }
      }}
      className={cn(
        "group relative z-10 w-2 shrink-0 cursor-col-resize",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors",
        "hover:before:w-0.5 hover:before:bg-accent-email active:before:bg-accent-email",
        "after:absolute after:top-1/2 after:left-1/2 after:h-10 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-muted-foreground/35 after:opacity-60 after:transition-opacity",
        "hover:after:opacity-100 hover:after:bg-accent-email",
      )}
    />
  );
}
