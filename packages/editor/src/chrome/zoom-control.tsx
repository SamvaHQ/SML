import { zoomInFrom, zoomOutFrom } from "../canvas/zoom";
import { useEditorStore } from "../state/context";
import { ZOOM_MAX, ZOOM_MIN } from "../state/store";
import { Minus, Plus } from "./editor-icons";
import { Tip } from "./ui";
import { cn, iconButton, pressedInset, toolbarButton } from "./ui-classes";

/** The modifier a zoom chord uses on this platform, for the tooltips. */
const modifierKey = (): string =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/**
 * The floating zoom control over the canvas: out, the current percentage (which returns to
 * actual size), in, and Fit. `percent` is the zoom on screen, including what Fit resolved to.
 */
export function ZoomControl({ percent }: { readonly percent: number }) {
  const fit = useEditorStore((state) => state.canvasZoom === "fit");
  const { setCanvasZoom } = useEditorStore((state) => state.actions);
  const modifier = modifierKey();
  const shown = Math.round(percent);
  return (
    <div
      role="group"
      aria-label="Zoom"
      data-testid="canvas.zoom-control"
      className="border-border bg-background/95 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border p-1 shadow-[var(--shadow-lg)] backdrop-blur-md"
    >
      <Tip label="Zoom out" shortcut={`${modifier}−`} side="top">
        <button
          type="button"
          aria-label="Zoom out"
          data-testid="canvas.zoom-out"
          data-editor-control=""
          disabled={shown <= ZOOM_MIN}
          onClick={() => setCanvasZoom(zoomOutFrom(percent))}
          className={iconButton}
        >
          <Minus className="size-3.5" />
        </button>
      </Tip>
      <Tip label="Actual size" shortcut={`${modifier}0`} side="top">
        <button
          type="button"
          aria-label={`Zoom ${shown}%. Show at actual size`}
          data-testid="canvas.zoom-value"
          data-editor-control=""
          onClick={() => setCanvasZoom(100)}
          className={cn(toolbarButton, "min-w-12 px-1.5 tabular-nums text-foreground")}
        >
          {shown}%
        </button>
      </Tip>
      <Tip label="Zoom in" shortcut={`${modifier}+`} side="top">
        <button
          type="button"
          aria-label="Zoom in"
          data-testid="canvas.zoom-in"
          data-editor-control=""
          disabled={shown >= ZOOM_MAX}
          onClick={() => setCanvasZoom(zoomInFrom(percent))}
          className={iconButton}
        >
          <Plus className="size-3.5" />
        </button>
      </Tip>
      <span aria-hidden className="bg-border mx-0.5 h-4 w-px" />
      <Tip label="Fit the email to the pane" side="top">
        <button
          type="button"
          aria-pressed={fit}
          data-testid="canvas.zoom"
          data-editor-control=""
          onClick={() => setCanvasZoom("fit")}
          className={cn(toolbarButton, pressedInset)}
        >
          Fit
        </button>
      </Tip>
    </div>
  );
}
