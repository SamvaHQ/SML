import { ContextMenu } from "@base-ui/react/context-menu";
import type { ReactElement, ReactNode, RefObject } from "react";

import { cn } from "./ui-classes";

const itemClass = cn(
  "samva-editor-context-item",
  "grid min-h-8 grid-cols-[1fr_auto] items-center gap-5 rounded-md px-2.5 text-[12.5px] text-foreground outline-none",
  "data-[highlighted]:bg-sel-soft data-[highlighted]:text-accent-email",
);

/** One step of the ancestor walk: what to select, and how it reads. */
export interface AncestorEntry {
  readonly instancePath: string;
  readonly label: string;
  /** Compiler-generated wrappers are named as such rather than passed off as markup. */
  readonly generated: boolean;
}

/**
 * The canvas context menu: the chain from the clicked element out to the document
 * root, so a nested target can be reached without hunting for it in the layers
 * rail. Selection is read-only, so nothing here changes the template.
 */
export function NodeContextMenu({
  children,
  ancestors,
  onSelect,
  onOpenChange,
  portalContainer,
  open,
  anchor,
}: {
  readonly children: ReactElement;
  /** Innermost first: the clicked element, then each enclosing element. */
  readonly ancestors: ReadonlyArray<AncestorEntry>;
  readonly onSelect: (instancePath: string) => void;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly portalContainer?: RefObject<HTMLElement | null> | undefined;
  readonly open?: boolean | undefined;
  readonly anchor?: { readonly getBoundingClientRect: () => DOMRect } | undefined;
}): ReactNode {
  return (
    <ContextMenu.Root open={open} onOpenChange={onOpenChange}>
      <ContextMenu.Trigger render={children} />
      <ContextMenu.Portal container={portalContainer}>
        <ContextMenu.Positioner anchor={anchor} sideOffset={2}>
          <ContextMenu.Popup
            aria-label="Select element"
            data-testid="node-context-menu.popup"
            className="samva-editor-context-popup samva-editor-shell border-border bg-surface-elevated z-50 min-w-52 rounded-lg border p-1 shadow-[var(--shadow-lg)] outline-none"
          >
            <div className="text-muted-foreground px-2.5 py-1 text-[11px]">Select</div>
            {ancestors.map((entry) => (
              <ContextMenu.Item
                key={entry.instancePath}
                className={itemClass}
                data-testid={`node-context-menu.item.${entry.instancePath}`}
                onClick={() => onSelect(entry.instancePath)}
              >
                <span>{entry.label}</span>
                {entry.generated ? (
                  <span className="text-muted-foreground text-[11px]">generated</span>
                ) : null}
              </ContextMenu.Item>
            ))}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
