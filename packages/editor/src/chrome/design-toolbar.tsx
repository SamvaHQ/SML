import { inspectSourceElement, structuralReplacements } from "@samva/markup/edit";
import type { EmailElementSelection } from "@samva/markup/edit";
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Box } from "../canvas/instance-dom";
import type { SelectedGeometry } from "../canvas/selection-overlay";
import { placeToolbar, type Size, type ToolbarPlacement } from "../canvas/toolbar-placement";
import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { ArrowUp, ChevronDown, ChevronUp, Duplicate, Trash } from "./editor-icons";
import { authoredAncestry, friendlyName, occurrenceNote } from "./friendly";
import { Tip } from "./ui";

type BlockOperation =
  | { readonly kind: "delete" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "reorder"; readonly direction: "before" | "after" };

const TIP_SIDE = { right: "right", left: "left", above: "top", below: "bottom" } as const;

/**
 * The toolbar beside the element selected in Design: its name, a step out to the element around
 * it, and the block edits that need no form (move earlier or later, duplicate, delete). Each is
 * staged like an edit from the properties. Stacked (`vertical`), the name is the toolbar's
 * accessible name and the actions' tooltips open away from the email.
 */
export function DesignToolbar({
  selection,
  orientation = "horizontal",
  side = "above",
}: {
  readonly selection: EmailElementSelection;
  readonly orientation?: ToolbarPlacement["orientation"] | undefined;
  readonly side?: ToolbarPlacement["side"] | undefined;
}): ReactNode {
  const { entry, source, markdown, revision, rev, ready } = useEditorStore(
    useShallow((state) => ({
      // Block edits are TSX transforms; a Markdown document has no TSX entry to run them on.
      entry: state.doc?.origin.kind === "tsx" ? state.doc.origin.file : null,
      source: state.doc?.origin.kind === "tsx" ? state.doc.origin.authoredSource : null,
      markdown: state.doc?.origin.kind === "markdown",
      revision: state.render?.revision ?? null,
      rev: state.doc?.rev ?? null,
      ready:
        state.sourceEditable &&
        !state.conflict &&
        !state.lifecycleBusy &&
        !state.hostBusy &&
        state.pendingAuthoredSource === null,
    })),
  );
  const { applySourceEdit, select } = useEditorStore((state) => state.actions);
  const name = useEditorStore((state) =>
    [
      friendlyName(
        selection,
        state.doc?.origin.kind === "tsx" ? state.doc.origin.authoredSource : "",
      ),
      occurrenceNote(selection),
    ]
      .filter((part) => part !== undefined)
      .join(" "),
  );
  const origin = selection.origins[0];
  const target = useMemo(
    () =>
      origin === undefined || entry === null || source === null || origin.fileName !== entry
        ? null
        : inspectSourceElement(source, entry, origin),
    [origin, entry, source],
  );
  const outline = useEditorStore((state) => state.outline);
  // Out to the block the author wrote around it, past the compiler's tables and cells.
  const parent =
    outline === null
      ? undefined
      : authoredAncestry(outline, selection.instancePath).at(-1)?.instancePath;
  const available = ready && target !== null && source !== null && revision === rev;
  const run = (operation: BlockOperation, label: string) => {
    if (!available || revision === null) return;
    const edits = structuralReplacements(source, target, operation);
    if (edits !== null) applySourceEdit({ revision, source, edits, design: { label } });
  };
  const why = markdown
    ? "Edit the text from the properties; the layout is not edited here."
    : target === null && origin !== undefined && origin.fileName !== entry
      ? `Written in ${origin.fileName}. Edit it from the properties.`
      : undefined;
  const button = (input: {
    readonly label: string;
    readonly testId: string;
    readonly enabled: boolean;
    readonly onClick: () => void;
    readonly children: ReactNode;
  }) => (
    <Tip
      side={TIP_SIDE[side]}
      label={input.enabled || why === undefined ? input.label : `${input.label}. ${why}`}
    >
      {/* Focusable while disabled, so the tooltip still says why an action is unavailable. */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={input.label}
        data-testid={`design-toolbar.${input.testId}`}
        data-editor-control=""
        disabled={!input.enabled}
        focusableWhenDisabled
        className="hover:bg-white/15 hover:text-inherit data-disabled:opacity-40 data-disabled:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3.5"
        onClick={input.onClick}
      >
        {input.children}
      </Button>
    </Tip>
  );
  const vertical = orientation === "vertical";
  return (
    <div
      role="toolbar"
      aria-label={vertical ? name : "Selected element"}
      aria-orientation={orientation}
      data-orientation={orientation}
      data-testid="design-toolbar"
      className={cn(
        // Dark on any email and in either theme, so it never reads as part of the email.
        "flex items-center gap-0.5 rounded-[9px] bg-(--editor-canvas-toolbar-bg) p-[3px] text-(--editor-canvas-toolbar-fg) shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14),0_0_0_1px_rgb(0_0_0/0.08),0_6px_18px_rgb(0_0_0/0.22)]",
        vertical && "flex-col",
      )}
    >
      {!vertical && (
        <>
          <span className="max-w-44 truncate px-1.5 text-[11.5px] font-medium">{name}</span>
          <Separator orientation="vertical" className="mx-0.5 h-3.5! self-center! bg-white/20" />
        </>
      )}
      {button({
        label: "Select the element around it",
        testId: "parent",
        enabled: parent !== undefined,
        onClick: () => {
          if (parent !== undefined) select(parent);
        },
        children: <ArrowUp />,
      })}
      {!markdown && (
        <>
          {button({
            label: "Move earlier",
            testId: "move-earlier",
            enabled: available && target.previous !== null,
            onClick: () => run({ kind: "reorder", direction: "before" }, "Move block earlier"),
            children: <ChevronUp />,
          })}
          {button({
            label: "Move later",
            testId: "move-later",
            enabled: available && target.next !== null,
            onClick: () => run({ kind: "reorder", direction: "after" }, "Move block later"),
            children: <ChevronDown />,
          })}
          {button({
            label: "Duplicate",
            testId: "duplicate",
            enabled: available && target.structural,
            onClick: () => run({ kind: "duplicate" }, "Duplicate block"),
            children: <Duplicate />,
          })}
          {button({
            label: "Delete",
            testId: "delete",
            enabled: available && target.structural,
            onClick: () => run({ kind: "delete" }, "Delete block"),
            children: <Trash />,
          })}
        </>
      )}
    </div>
  );
}

const sameSpot = (a: ToolbarPlacement | null, b: ToolbarPlacement): boolean =>
  a !== null &&
  a.orientation === b.orientation &&
  a.side === b.side &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5;

/**
 * The Design toolbar in the canvas viewport, outside the email's frame, so it can sit in the
 * gutter beside the email and keeps the editor's own styling. It is positioned in the viewport's
 * scrolled content, so it scrolls with the email, and is placed again when the selection's
 * geometry, the zoom, the scroll or the viewport's size changes (`placeToolbar` owns the rule).
 */
export function FloatingDesignToolbar({
  selection,
  geometry,
  viewport: viewportRef,
  zoom,
}: {
  readonly selection: EmailElementSelection;
  /** The selected element's layout in the frame; null while it is not laid out. */
  readonly geometry: SelectedGeometry | null;
  /** The scrolling canvas viewport the toolbar is positioned in. */
  readonly viewport: RefObject<HTMLElement | null>;
  /** The canvas zoom; the frame's geometry is scaled by it on screen. */
  readonly zoom: number;
}): ReactNode {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ToolbarPlacement | null>(null);
  const orientation = placement?.orientation ?? "horizontal";
  // Each orientation's size as last drawn. The thickness is one button in both, so the gutter
  // test is right before the stacked toolbar has ever been drawn.
  const sizes = useRef<Partial<Record<ToolbarPlacement["orientation"], Size>>>({});

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const toolbar = toolbarRef.current;
    if (viewport === null || toolbar === null || geometry === null) return;
    const { frame } = geometry;
    const place = () => {
      if (!frame.isConnected) return;
      const drawn = { width: toolbar.offsetWidth, height: toolbar.offsetHeight };
      sizes.current[orientation] = drawn;
      const thickness = orientation === "vertical" ? drawn.width : drawn.height;
      const frameRect = frame.getBoundingClientRect();
      const scale = frame.clientWidth === 0 ? 1 : frameRect.width / frame.clientWidth;
      const onPage = (box: Box): Box => ({
        top: frameRect.top + box.top * scale,
        left: frameRect.left + box.left * scale,
        width: box.width * scale,
        height: box.height * scale,
      });
      const viewportRect = viewport.getBoundingClientRect();
      const visible = {
        top: viewportRect.top + viewport.clientTop,
        left: viewportRect.left + viewport.clientLeft,
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      const next = placeToolbar({
        element: onPage(geometry.element),
        column: {
          top: frameRect.top,
          left: frameRect.left,
          width: frameRect.width,
          height: frameRect.height,
        },
        viewport: visible,
        vertical: sizes.current.vertical ?? { width: thickness, height: thickness * 5 },
        horizontal: sizes.current.horizontal ?? { width: drawn.width, height: thickness },
        neighbours: geometry.neighbours.map(onPage),
      });
      // From the page into the viewport's scrolled content, where the toolbar is positioned.
      const inContent = {
        ...next,
        top: next.top - visible.top + viewport.scrollTop,
        left: next.left - visible.left + viewport.scrollLeft,
      };
      setPlacement((current) => (sameSpot(current, inContent) ? current : inContent));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(viewport);
    observer.observe(toolbar);
    viewport.addEventListener("scroll", place, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", place);
    };
    // A new zoom moves the frame on screen without new geometry inside it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- zoom is the identity of the frame's on-screen scale, which is read from the frame rather than the prop.
  }, [geometry, orientation, viewportRef, zoom]);

  return (
    <div
      ref={toolbarRef}
      data-slot="editor-design-toolbar"
      data-side={placement?.side}
      className="absolute z-10"
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement === null || geometry === null ? "hidden" : undefined,
      }}
      // The viewport drops to document scope on a click; a click here is on the toolbar.
      onClick={(event) => event.stopPropagation()}
    >
      <DesignToolbar
        selection={selection}
        orientation={orientation}
        side={placement?.side ?? "above"}
      />
    </div>
  );
}
