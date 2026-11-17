import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import type { CanvasMode } from "../state/store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";
import { useContribution } from "./contributions";
import {
  ChevronDown,
  ChevronUp,
  Compare,
  PaintBrush,
  Pin,
  Redo,
  Undo,
  Xmark,
} from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { Tip } from "./ui";
import { cn, revealOnRowHover } from "./ui-classes";

const pinCount = (count: number): string => `${count} ${count === 1 ? "pin" : "pins"}`;

/** The floating surface the dock and the tray share, on the same paper as the zoom control. */
const floatingClass =
  "bg-popover text-popover-foreground ring-foreground/10 pointer-events-auto rounded-lg shadow-md ring-1";

/** The state an `EditorCanvasModeSwitch` exposes. */
export interface CanvasModeSwitchState extends Record<string, unknown> {
  /** What a click on the email does: `point`, `design` or `pin`. */
  readonly mode: CanvasMode;
  /** Design cannot be turned on right now (an assistant turn, a read-only template). */
  readonly locked: boolean;
}

/**
 * The preview bar's Design and Pin switches. Design makes a click on the email select it for
 * editing, with a toolbar on the element; its edits are ordinary changes to the draft, which the
 * status bar saves as a version. Pin makes a click drop a numbered pin for the chat. Pin is
 * offered only beside a docked assistant, which is where pins go. Design waits for an assistant
 * turn to finish, so the two never edit the email at once.
 */
export function EditorCanvasModeSwitch(props: PartProps<"div", CanvasModeSwitchState>) {
  const { mode, editable, emailReady, hostBusy } = useEditorStore(
    useShallow((state) => ({
      mode: state.canvasMode,
      editable: state.sourceEditable,
      emailReady: state.render !== null,
      hostBusy: state.hostBusy,
    })),
  );
  const { setCanvasMode } = useEditorStore((state) => state.actions);
  const pinsOffered = useContribution("rail.assistant") !== undefined;
  const designOn = mode === "design";
  const designLocked = !emailReady || (!designOn && (hostBusy || !editable));
  const pinLocked = !emailReady;
  const designTip = designOn
    ? "Leave Design"
    : hostBusy
      ? "Design waits for the assistant to finish"
      : !editable
        ? "This template is read-only"
        : "Edit the email directly";
  return usePart<CanvasModeSwitchState>(
    "editor-canvas-mode-switch",
    { role: "group", "aria-label": "Canvas mode", ...props },
    {
      state: { mode, locked: designLocked },
      className: "flex shrink-0 items-center gap-0.5",
      props: {
        children: (
          <>
            <Tip label={designTip}>
              <Toggle
                size="sm"
                pressed={designOn}
                // A disabled control takes no hover, so the tooltip that says why sits on a
                // focusable switch that refuses the change instead.
                aria-disabled={designLocked || undefined}
                onPressedChange={() => {
                  if (!designLocked) setCanvasMode(designOn ? "point" : "design");
                }}
                data-testid="preview-bar.design"
                data-editor-control=""
                className="text-muted-foreground aria-pressed:text-foreground gap-1.5 px-2 aria-disabled:cursor-default aria-disabled:opacity-60 @max-[34rem]/preview-bar:px-1.5"
              >
                <PaintBrush />
                <span className="@max-[34rem]/preview-bar:sr-only">Design</span>
              </Toggle>
            </Tip>
            {pinsOffered && (
              <Tip label={mode === "pin" ? "Stop pinning" : "Pin parts of the email for the chat"}>
                <Toggle
                  size="sm"
                  aria-label="Pin"
                  pressed={mode === "pin"}
                  aria-disabled={pinLocked || undefined}
                  onPressedChange={() => {
                    if (!pinLocked) setCanvasMode(mode === "pin" ? "point" : "pin");
                  }}
                  data-testid="preview-bar.pin"
                  data-editor-control=""
                  className="text-muted-foreground aria-pressed:text-foreground px-1.5 aria-disabled:cursor-default aria-disabled:opacity-60"
                >
                  <Pin />
                </Toggle>
              </Tip>
            )}
          </>
        ),
      },
    },
  );
}

/** The state an `EditorDesignDock` exposes. */
export interface DesignDockState extends Record<string, unknown> {
  /** The canvas shows the preview from before the edits. */
  readonly compare: boolean;
}

/**
 * The Design dock under the canvas: undo and redo through the editor's history, and a locked
 * before-and-after compare against the preview before the first edit since the last saved
 * version. Saving lives in the status bar.
 */
export function EditorDesignDock(props: PartProps<"div", DesignDockState>) {
  const { canUndo, canRedo, compare, comparable } = useEditorStore(
    useShallow((state) => ({
      canUndo: state.sourceEditable && state.undoHistory.length > 0,
      canRedo: state.sourceEditable && state.redoHistory.length > 0,
      compare: state.designCompare,
      comparable: state.designBase?.render != null,
    })),
  );
  const { undo, redo, setDesignCompare } = useEditorStore((state) => state.actions);

  return usePart<DesignDockState>("editor-design-dock", props, {
    state: { compare },
    className: "ml-auto flex min-w-0 items-center gap-2",
    props: {
      children: (
        <div
          role="toolbar"
          aria-label="Design edits"
          data-slot="editor-design-dock-bar"
          data-testid="design-dock"
          className="flex items-center gap-0.5"
        >
          <Tip label="Undo" side="top">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              data-testid="design-dock.undo"
              data-editor-control=""
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo />
            </Button>
          </Tip>
          <Tip label="Redo" side="top">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              data-testid="design-dock.redo"
              data-editor-control=""
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo />
            </Button>
          </Tip>
          <Tip label={compare ? "Show your edits" : "Compare with before your edits"} side="top">
            <Toggle
              size="sm"
              aria-label="Compare with before your edits"
              pressed={compare}
              onPressedChange={setDesignCompare}
              data-testid="design-dock.compare"
              data-editor-control=""
              disabled={!comparable}
              className="min-w-7 px-0"
            >
              <Compare />
            </Toggle>
          </Tip>
        </div>
      ),
    },
  });
}

/** The state an `EditorPinTray` exposes. */
export interface PinTrayState extends Record<string, unknown> {
  readonly count: number;
  /** The rows are shown. */
  readonly open: boolean;
  /** The tray asks before removing every pin. */
  readonly confirming: boolean;
  /** A click on the email drops a pin. */
  readonly pinning: boolean;
}

/**
 * The pins dropped on the email, numbered as they are drawn on it: each with its element and a
 * note, removable one at a time or all at once after a confirm. The host's chat reads the same
 * list and attaches it to the next message. Renders nothing without pins outside pin mode.
 */
export function EditorPinTray(props: PartProps<"section", PinTrayState>) {
  const { pins, pinning } = useEditorStore(
    useShallow((state) => ({ pins: state.pins, pinning: state.canvasMode === "pin" })),
  );
  const { removePin, clearPins, setPinNote } = useEditorStore((state) => state.actions);
  const [open, setOpen] = useState(true);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const count = pins.length;
  const confirming = confirmingClear && count > 0;
  const shown = count > 0 || pinning;

  const header =
    count === 0 ? (
      <div className="flex items-center gap-2 px-3 py-2">
        <Pin className="text-primary size-3.5" />
        <span className="text-muted-foreground text-xs">
          Click a part of the email to pin it for the chat
        </span>
      </div>
    ) : confirming ? (
      <div className="flex h-9 items-center gap-1 pr-1 pl-3">
        <span
          data-testid="pin-tray.clear-confirm"
          className="text-foreground flex-1 text-xs font-medium"
        >
          Remove all {count}?
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="pin-tray.clear-cancel"
          data-editor-control=""
          onClick={() => setConfirmingClear(false)}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          data-testid="pin-tray.clear-confirm-button"
          data-editor-control=""
          onClick={() => {
            setConfirmingClear(false);
            clearPins();
          }}
        >
          Remove all
        </Button>
      </div>
    ) : (
      <div className="flex h-9 items-center gap-1 pr-1 pl-1">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          data-testid="pin-tray.toggle"
          data-editor-control=""
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 justify-start gap-1.5 px-2"
        >
          {open ? (
            <ChevronDown className="text-muted-foreground" />
          ) : (
            <ChevronUp className="text-muted-foreground" />
          )}
          {pinCount(count)}
          <span className="text-muted-foreground font-normal">for the chat</span>
        </Button>
        <Tip label="Remove all pins" side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove all pins"
            data-testid="pin-tray.clear"
            data-editor-control=""
            onClick={() => setConfirmingClear(true)}
            className="text-muted-foreground"
          >
            <Xmark />
          </Button>
        </Tip>
      </div>
    );

  const tray = usePart<PinTrayState>(
    "editor-pin-tray",
    { "aria-label": "Pins", "data-testid": "pin-tray", "data-count": count, ...props },
    {
      state: { count, open, confirming, pinning },
      tag: "section",
      className: cn(floatingClass, "w-[min(26rem,calc(100%-1.5rem))] overflow-hidden"),
      props: {
        children: (
          <>
            {header}
            {count > 0 && open && (
              <ol
                data-slot="editor-pin-tray-list"
                className="border-border m-0 max-h-48 list-none overflow-y-auto border-t p-1"
              >
                {pins.map((pin) => (
                  <li
                    key={pin.id}
                    data-slot="editor-pin-tray-row"
                    data-testid={`pin-tray.row.${pin.number}`}
                    className="group/row hover:bg-muted/50 flex items-center gap-2 rounded-md py-0.5 pr-0.5 pl-1.5"
                  >
                    <span className="bg-primary text-primary-foreground grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold tabular-nums">
                      {pin.number}
                    </span>
                    <Badge
                      variant="secondary"
                      className="max-w-[9rem] shrink-0 truncate rounded-md font-mono text-[11px] font-normal"
                    >
                      {pin.label}
                    </Badge>
                    <Input
                      aria-label={`Note for pin ${pin.number}`}
                      data-testid={`pin-tray.note.${pin.number}`}
                      value={pin.note}
                      placeholder="Add a note"
                      onChange={(event) => setPinNote(pin.id, event.target.value)}
                      className="hover:border-input h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs shadow-none md:text-xs dark:bg-transparent"
                    />
                    <Tip label={`Remove pin ${pin.number}`} side="top">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove pin ${pin.number}`}
                        data-testid={`pin-tray.remove.${pin.number}`}
                        data-editor-control=""
                        onClick={() => removePin(pin.id)}
                        className={cn("text-muted-foreground", revealOnRowHover)}
                      >
                        <Xmark />
                      </Button>
                    </Tip>
                  </li>
                ))}
              </ol>
            )}
          </>
        ),
      },
    },
  );
  return shown ? tray : null;
}
