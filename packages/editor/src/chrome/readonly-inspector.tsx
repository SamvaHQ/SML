import { Tooltip } from "@base-ui/react/tooltip";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { AttentionSummary } from "./compatibility-report";
import { SidebarRightHide } from "./editor-icons";
import { useEditorPortalContainer } from "./use-editor-portal";

/** Read-only source ownership and diagnostics, without mutation controls. */
export function ReadonlyInspector({
  embedded = false,
}: {
  readonly embedded?: boolean | undefined;
} = {}) {
  const portalContainer = useEditorPortalContainer();
  const { checks, doc, readonlyReason, rightCollapsed, rightWidth } = useEditorStore(
    useShallow((state) => ({
      checks: state.checks,
      doc: state.doc,
      readonlyReason: state.readonlyReason,
      rightCollapsed: state.rightCollapsed,
      rightWidth: state.rightWidth,
    })),
  );
  const { toggleRight } = useEditorStore((state) => state.actions);
  if (!embedded && rightCollapsed) return null;
  return (
    <aside
      data-editor-rail="right"
      style={{ width: embedded ? "100%" : rightWidth }}
      className={
        embedded
          ? "bg-background flex h-full shrink-0 flex-col overflow-hidden"
          : "border-border bg-background flex h-full shrink-0 flex-col overflow-hidden border-l"
      }
    >
      <div className="border-border-subtle flex h-11 items-center border-b px-3">
        <span className="text-[12.5px] font-medium">Template details</span>
        {!embedded && (
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <button
                  type="button"
                  aria-label="Collapse inspector"
                  onClick={toggleRight}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground ml-auto rounded-md p-1.5"
                />
              }
            >
              <SidebarRightHide className="size-[15px]" />
            </Tooltip.Trigger>
            <Tooltip.Portal container={portalContainer}>
              <Tooltip.Positioner side="bottom" sideOffset={5} className="z-[200]">
                <Tooltip.Popup
                  role="tooltip"
                  className="bg-foreground text-background rounded-md px-2 py-1 text-[11px] shadow-[var(--shadow-md)]"
                >
                  Collapse inspector
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </div>
      <div className="samva-editor-scroll min-h-0 flex-1 overflow-y-auto p-4 text-[12.5px]">
        <p className="font-medium">Read-only</p>
        <p className="text-muted-foreground mt-1">{readonlyReason}</p>
        {doc !== null && (
          <p className="text-muted-foreground mt-3 font-mono text-[11.5px] break-all">
            {doc.origin.file}
          </p>
        )}
        <div className="border-border-subtle mt-5 border-t pt-4">
          <AttentionSummary checks={checks} />
        </div>
      </div>
    </aside>
  );
}
