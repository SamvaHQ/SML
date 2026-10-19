import { ScrollArea } from "@base-ui/react/scroll-area";

import { useEditorStore } from "../state/context";
import { Inspector } from "./inspector";
import { LayersPane } from "./left-rail";
import { ReadonlyInspector } from "./readonly-inspector";

/**
 * The work pane's Design tab: the email's layers beside the properties of what is selected.
 * Side by side when the pane is wide enough, stacked with the layers on top when it is not.
 */
export function DesignPanel() {
  const sourceEditable = useEditorStore((state) => state.sourceEditable);
  return (
    <div
      data-slot="editor-design-panel"
      data-testid="design-panel"
      className="@container/design flex min-h-0 min-w-0 flex-1"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @min-[36rem]/design:flex-row">
        <section
          aria-label="Layers"
          data-slot="editor-layers"
          className="border-border flex max-h-[40%] min-h-0 shrink-0 flex-col border-b @min-[36rem]/design:max-h-none @min-[36rem]/design:w-72 @min-[36rem]/design:border-r @min-[36rem]/design:border-b-0"
        >
          <h2 className="text-muted-foreground px-3 pt-3 pb-1 font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase">
            Layers
          </h2>
          <ScrollArea.Root data-samva-scroll-area="layers" className="relative min-h-0 flex-1">
            <ScrollArea.Viewport className="size-full">
              <div className="px-2 pb-4">
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
        </section>
        <div className="flex min-h-0 min-w-0 flex-1">
          {sourceEditable ? <Inspector embedded checks={false} /> : <ReadonlyInspector embedded />}
        </div>
      </div>
    </div>
  );
}
