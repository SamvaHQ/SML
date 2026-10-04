import { ScrollArea } from "@base-ui/react/scroll-area";
import { Tooltip } from "@base-ui/react/tooltip";
import { createElement } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { ChevronRight, SidebarLeftHide } from "./editor-icons";
import { selectionLabel, type EmailOutlineNode } from "./email-outline";
import { iconForTag } from "./icons";
import { cn } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

// ---------------------------------------------------------------------------
// Layers — the render's element tree, selectable. Every row names one rendered
// instance: its tag, whether the renderer generated it, and which iteration of a
// repeated authoring it is. Selection is read-only; the authoring is edited in
// the source.
// ---------------------------------------------------------------------------

function TreeRow({ node, depth }: { node: EmailOutlineNode; depth: number }) {
  const { selectedPath, expandedLayers } = useEditorStore(
    useShallow((state) => ({
      selectedPath: state.selection.kind === "element" ? state.selection.instancePath : null,
      expandedLayers: state.expandedLayers,
    })),
  );
  const { select, toggleLayerExpand, setHovered } = useEditorStore((state) => state.actions);
  const hasChildren = node.children.length > 0;
  const open = expandedLayers.has(node.instancePath);
  const selected = selectedPath === node.instancePath;
  const { selection } = node;

  return (
    <li>
      <div
        className="group relative"
        style={{ paddingLeft: depth * 12 }}
        onMouseEnter={() => setHovered(node.instancePath)}
        onMouseLeave={() => setHovered(null)}
      >
        <div
          className={cn(
            "flex h-[30px] w-full items-center gap-1.5 rounded-[7px] pr-2 pl-1.5 text-left transition-colors",
            selected ? "bg-sel-soft text-accent-email" : "text-foreground hover:bg-muted",
          )}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={open}
              data-testid="left-rail.layer.toggle"
              aria-label={`${open ? "Collapse" : "Expand"} ${selectionLabel(selection)}`}
              className={cn(
                "grid size-3.5 shrink-0 place-items-center text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
              onClick={(event) => {
                event.stopPropagation();
                toggleLayerExpand(node.instancePath);
              }}
            >
              <ChevronRight className="size-[11px]" />
            </button>
          ) : (
            <span aria-hidden className="size-3.5 shrink-0" />
          )}
          <button
            data-layer-instance-path={node.instancePath}
            data-testid={`layers.node.${node.instancePath}`}
            type="button"
            onClick={() => select(node.instancePath)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {createElement(iconForTag(selection.tag), {
              className: cn(
                "size-[15px] shrink-0",
                selected ? "text-accent-email" : "text-muted-foreground",
              ),
            })}
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              {selectionLabel(selection)}
            </span>
            {!selection.authored && (
              <span className="text-placeholder shrink-0 text-[10px]">generated</span>
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
  if (outline === null) {
    return (
      <div className="text-placeholder px-3 py-8 text-center text-xs">
        There is no preview yet, so there are no layers to show.
      </div>
    );
  }
  return (
    <ul className="m-0 list-none p-0">
      {outline.roots.map((root) => (
        <TreeRow key={root.instancePath} node={root} depth={0} />
      ))}
    </ul>
  );
}

export function LeftRail() {
  const portalContainer = useEditorPortalContainer();
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
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <button
                  type="button"
                  aria-label="Collapse layers"
                  data-testid="left-rail.collapse"
                  onClick={toggleLeft}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground ml-auto rounded-md p-1.5"
                />
              }
            >
              <SidebarLeftHide className="size-[15px]" />
            </Tooltip.Trigger>
            <Tooltip.Portal container={portalContainer}>
              <Tooltip.Positioner side="bottom" sideOffset={5} className="z-[200]">
                <Tooltip.Popup
                  role="tooltip"
                  className="bg-foreground text-background rounded-md px-2 py-1 text-[11px] shadow-[var(--shadow-md)]"
                >
                  Collapse layers
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
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
