import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { Sparkle } from "./editor-icons";
import { cn } from "./ui-classes";
import { useAssistant } from "./use-assistant";

/**
 * The `rail.assistant` region beside the email preview: no inspector toggle, no collapse. The
 * host's contribution owns scroll and composer.
 */
export function AssistantColumn({ hidden = false }: { readonly hidden?: boolean }) {
  const assistant = useAssistant();
  const assistantWidth = useEditorStore((state) => state.assistantWidth);
  const layoutMode = useEditorStore((state) => state.layoutMode);
  const focused = layoutMode === "compact" || layoutMode === "narrow";
  if (assistant === null) return null;
  return (
    <aside
      aria-label="Assistant"
      hidden={hidden}
      data-editor-rail="left"
      data-testid="agent-column"
      style={focused ? undefined : { width: assistantWidth }}
      className={cn(
        "min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        hidden ? "hidden" : "flex",
        focused && "h-full w-full flex-1",
        !focused && "h-full shrink-0 border-r border-border",
      )}
    >
      <div
        className="flex h-full min-h-0 min-w-0 flex-col"
        style={focused ? undefined : { width: assistantWidth, maxWidth: "100%" }}
      >
        <div className="border-border-subtle flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-2">
          <Sparkle className="text-accent-orange size-[15px] shrink-0" />
          <p className="text-foreground truncate text-[13px] leading-none font-semibold">
            Assistant
          </p>
          {assistant.header !== null && <div className="ml-auto shrink-0">{assistant.header}</div>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{assistant.panel}</div>
      </div>
    </aside>
  );
}

/**
 * The `rail.assistant` region as an additive right column, for the form-based channel workspaces
 * (SMS, WhatsApp) that dock no inspector. Renders nothing when the host contributes no assistant;
 * the workspace's own form stays put beside it.
 */
export function AssistantRail() {
  const assistant = useAssistant();
  const { rightCollapsed, rightWidth, layoutMode } = useEditorStore(
    useShallow((state) => ({
      rightCollapsed: state.rightCollapsed,
      rightWidth: state.rightWidth,
      layoutMode: state.layoutMode,
    })),
  );
  if (assistant === null) return null;
  const overlay = layoutMode === "compact" || layoutMode === "narrow";

  return (
    <aside
      aria-label="Assistant"
      aria-hidden={rightCollapsed || undefined}
      inert={rightCollapsed || undefined}
      data-editor-rail="right"
      style={{
        width: rightCollapsed ? 0 : rightWidth,
        maxWidth: overlay ? "calc(100% - 48px)" : undefined,
      }}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-background transition-[width,transform,box-shadow] duration-180 ease-out",
        overlay && "absolute inset-y-0 right-0 z-40 shadow-[var(--shadow-floating)]",
        rightCollapsed && "border-l-0",
      )}
    >
      <div className="flex h-full min-w-0 flex-col" style={{ width: rightWidth, maxWidth: "100%" }}>
        <div className="flex min-h-0 flex-1 flex-col">{assistant.panel}</div>
      </div>
    </aside>
  );
}
