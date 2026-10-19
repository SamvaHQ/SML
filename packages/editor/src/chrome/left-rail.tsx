import { ScrollArea } from "@base-ui/react/scroll-area";
import { createElement, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { Button } from "../ui/button";
import { ChevronRight, SidebarLeftHide } from "./editor-icons";
import { selectionTextExcerpt } from "./email-outline";
import { authoredTree, friendlyName, type AuthoredNode } from "./friendly";
import { iconForTag } from "./icons";
import { Tip } from "./ui";
import { cn } from "./ui-classes";

// ---------------------------------------------------------------------------
// Layers — the blocks and elements the author wrote, by the names they wrote them with
// (`Section`, `Button`) or a plain word (`Heading`, `Text`, `Image`), with a short excerpt.
// The tables, rows and cells the compiler renders them into are left out; the compiler marks
// which rendered element each authored element is. Selecting a row selects that element.
// ---------------------------------------------------------------------------

/**
 * A short sample of the element's text. Clients that need a second copy of a control (Outlook's
 * button) render the same words twice, so a repeat is dropped.
 */
const layerExcerpt = (selection: AuthoredNode["selection"], html: string): string | undefined => {
  const text = selectionTextExcerpt(selection, html)
    ?.replace(/\u200b|\u00ad|\u034f/g, "")
    .trim();
  if (text === undefined || text === "") return undefined;
  const half = text.length / 2;
  const first = text.slice(0, Math.floor(half)).trim();
  return first !== "" && text.slice(Math.ceil(half)).trim().startsWith(first.slice(0, 12))
    ? first
    : text;
};

function TreeRow({ node, depth }: { node: AuthoredNode; depth: number }) {
  const { selectedPath, collapsedLayers, authoredSource, html } = useEditorStore(
    useShallow((state) => ({
      selectedPath: state.selection.kind === "element" ? state.selection.instancePath : null,
      collapsedLayers: state.collapsedLayers,
      authoredSource: state.doc?.origin.authoredSource ?? "",
      html: state.render?.html ?? "",
    })),
  );
  const { select, toggleLayerExpand, setHovered } = useEditorStore((state) => state.actions);
  const hasChildren = node.children.length > 0;
  const open = !collapsedLayers.has(node.instancePath);
  const selected = selectedPath === node.instancePath;
  const { selection } = node;
  const name = friendlyName(selection, authoredSource);
  // A loop's copies are one layer: it names how many there are, and selects the first.
  const repeat = node.copies > 1 ? `×${node.copies}` : undefined;
  const excerpt = hasChildren && open ? undefined : layerExcerpt(selection, html);

  return (
    <li>
      <div
        className="group relative"
        style={{ paddingLeft: depth * 12 }}
        onMouseEnter={() => setHovered(node.instancePath)}
        onMouseLeave={() => setHovered(null)}
      >
        <div
          data-slot="editor-layer"
          data-selected={selected || undefined}
          className={cn(
            "flex h-[30px] w-full items-center gap-1.5 rounded-md pr-2 pl-1 text-left transition-colors",
            selected ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/60",
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={open}
              data-testid="left-rail.layer.toggle"
              aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
              className={cn(
                "grid size-4 shrink-0 place-items-center text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
              onClick={(event) => {
                event.stopPropagation();
                toggleLayerExpand(node.instancePath);
              }}
            >
              <ChevronRight className="size-3" />
            </button>
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
          <button
            data-layer-instance-path={node.instancePath}
            data-layer-name={name}
            data-testid={`layers.node.${node.instancePath}`}
            type="button"
            onClick={() => select(node.instancePath)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {createElement(iconForTag(selection.tag), {
              className: cn(
                "size-[15px] shrink-0",
                selected ? "text-foreground" : "text-muted-foreground",
              ),
            })}
            <span className="shrink-0 text-[12.5px] font-medium">{name}</span>
            {excerpt !== undefined && (
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-[12px]">
                {excerpt}
              </span>
            )}
            {repeat !== undefined && (
              <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">
                {repeat}
              </span>
            )}
          </button>
        </div>
      </div>
      {hasChildren && open && (
        <ul className="m-0 list-none p-0">
          {node.children.map((child) => (
            <TreeRow key={child.instancePath} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LayersPane() {
  const outline = useEditorStore((state) => state.outline);
  const roots = useMemo(() => (outline === null ? [] : authoredTree(outline)), [outline]);
  if (outline === null) {
    return (
      <div className="text-placeholder px-3 py-8 text-center text-xs">
        There is no preview yet, so there are no layers to show.
      </div>
    );
  }
  // The Email itself is the document scope; its blocks are the first level.
  const top = roots.length === 1 && roots[0]?.selection.tag === "html" ? roots[0].children : roots;
  return (
    <ul className="m-0 list-none p-0">
      {top.map((root) => (
        <TreeRow key={root.instancePath} node={root} depth={0} />
      ))}
    </ul>
  );
}

export function LeftRail() {
  const { leftCollapsed, leftWidth, layoutMode } = useEditorStore(
    useShallow((state) => ({
      leftCollapsed: state.leftCollapsed,
      leftWidth: state.leftWidth,
      layoutMode: state.layoutMode,
    })),
  );
  const { toggleLeft } = useEditorStore((state) => state.actions);
  const overlay = layoutMode === "compact" || layoutMode === "narrow";

  return (
    <aside
      aria-label="Layers"
      aria-hidden={leftCollapsed || undefined}
      inert={leftCollapsed || undefined}
      data-editor-rail="left"
      style={{
        width: leftCollapsed ? 0 : leftWidth,
        maxWidth: overlay ? "calc(100% - 48px)" : undefined,
      }}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-background transition-[width,transform,box-shadow] duration-180 ease-out",
        overlay && "absolute inset-y-0 left-0 z-40 shadow-[var(--shadow-floating)]",
        leftCollapsed && "border-r-0",
      )}
    >
      <div className="flex h-full min-w-0 flex-col" style={{ width: leftWidth, maxWidth: "100%" }}>
        <div className="border-border-subtle flex items-center gap-0.5 border-b px-3 py-2">
          <span className="text-foreground text-[12.5px] font-medium">Layers</span>
          <Tip label="Collapse layers" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse layers"
              data-testid="left-rail.collapse"
              onClick={toggleLeft}
              className="text-muted-foreground ml-auto"
            >
              <SidebarLeftHide />
            </Button>
          </Tip>
        </div>

        <ScrollArea.Root data-samva-scroll-area="layers" className="relative min-h-0 flex-1">
          <ScrollArea.Viewport className="size-full">
            <div className="px-2 pt-2.5 pb-5">
              <LayersPane />
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            className="absolute top-0 right-0 bottom-0 flex w-2.5 touch-none p-0.5 select-none"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-[var(--editor-scrollbar-thumb)] hover:bg-[var(--editor-scrollbar-thumb-hover)]" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
    </aside>
  );
}
