import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { Button } from "../ui/button";
import { AttentionSummary } from "./compatibility-report";
import { SidebarRightHide } from "./editor-icons";
import { Tip } from "./ui";

/** Read-only source ownership and diagnostics, without mutation controls. */
export function ReadonlyInspector({
  embedded = false,
}: {
  readonly embedded?: boolean | undefined;
} = {}) {
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
          <Tip label="Collapse inspector" side="bottom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse inspector"

              onClick={toggleRight}
              className="text-muted-foreground ml-auto"
            >
              <SidebarRightHide />
            </Button>
          </Tip>
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
