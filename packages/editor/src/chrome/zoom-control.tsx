import { zoomInFrom, zoomOutFrom } from "../canvas/zoom";
import { useEditorStore } from "../state/context";
import { ZOOM_MAX, ZOOM_MIN } from "../state/store";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Toggle } from "../ui/toggle";
import { Minus, Plus } from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { Tip } from "./ui";

/** The modifier a zoom chord uses on this platform, for the tooltips. */
const modifierKey = (): string =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** The state an `EditorZoomControl` exposes. */
export interface ZoomControlState extends Record<string, unknown> {
  /** The canvas fits its pane. */
  readonly fit: boolean;
  /** The zoom on screen, as a whole percentage. */
  readonly percent: number;
}

/**
 * The floating zoom control over the canvas: out, the current percentage (which returns to
 * actual size), in, and Fit, on the same paper as the editor's menus. `percent` is the zoom on
 * screen, including what Fit resolved to.
 */
export function EditorZoomControl({
  percent,
  ...props
}: PartProps<"div", ZoomControlState> & { readonly percent: number }) {
  const fit = useEditorStore((state) => state.canvasZoom === "fit");
  const { setCanvasZoom } = useEditorStore((state) => state.actions);
  const modifier = modifierKey();
  const shown = Math.round(percent);
  return usePart<ZoomControlState>(
    "editor-zoom-control",
    { role: "group", "aria-label": "Zoom", "data-testid": "canvas.zoom-control", ...props },
    {
      state: { fit, percent: shown },
      className:
        "bg-popover text-popover-foreground ring-foreground/10 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-1 shadow-md ring-1",
      props: {
        children: (
          <>
            <Tip label="Zoom out" shortcut={`${modifier}−`} side="top">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom out"
                data-testid="canvas.zoom-out"
                data-editor-control=""
                disabled={shown <= ZOOM_MIN}
                onClick={() => setCanvasZoom(zoomOutFrom(percent))}
              >
                <Minus />
              </Button>
            </Tip>
            <Tip label="Actual size" shortcut={`${modifier}0`} side="top">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Zoom ${shown}%. Show at actual size`}
                data-testid="canvas.zoom-value"
                data-editor-control=""
                onClick={() => setCanvasZoom(100)}
                className="min-w-13 px-1.5 font-normal tabular-nums"
              >
                {shown}%
              </Button>
            </Tip>
            <Tip label="Zoom in" shortcut={`${modifier}+`} side="top">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Zoom in"
                data-testid="canvas.zoom-in"
                data-editor-control=""
                disabled={shown >= ZOOM_MAX}
                onClick={() => setCanvasZoom(zoomInFrom(percent))}
              >
                <Plus />
              </Button>
            </Tip>
            <Separator orientation="vertical" className="mx-0.5 h-4!" />
            <Tip label="Fit the email to the pane" side="top">
              <Toggle
                size="sm"
                pressed={fit}
                onPressedChange={(pressed) => {
                  if (pressed) setCanvasZoom("fit");
                }}
                data-testid="canvas.zoom"
                data-editor-control=""
                className="px-2 text-xs"
              >
                Fit
              </Toggle>
            </Tip>
          </>
        ),
      },
    },
  );
}
