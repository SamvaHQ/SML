import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import { Sparkle } from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { useAssistant } from "./use-assistant";

/** The state an `EditorAssistantDock` exposes. */
export interface AssistantDockState extends Record<string, unknown> {
  /** The dock fills its pane (a Chat | Preview switch) rather than a resizable column. */
  readonly focused: boolean;
  /** The dock is off screen: the chat is collapsed, or the switch shows the preview. */
  readonly hidden: boolean;
}

/**
 * The `rail.assistant` region beside the work pane: a column whose width the divider sets in the
 * split layout, and the whole pane behind the Chat | Preview switch below it. The host's
 * contribution owns scroll and composer; the dock stays mounted while hidden, so the host's chat
 * keeps its state.
 */
export function EditorAssistantDock({
  hidden = false,
  ...props
}: PartProps<"aside", AssistantDockState> & { readonly hidden?: boolean | undefined }) {
  const assistant = useAssistant();
  const assistantWidth = useEditorStore((state) => state.assistantWidth);
  const layoutMode = useEditorStore((state) => state.layoutMode);
  // Below the wide layout the chat is one of two switched panes and takes the full width.
  const focused = layoutMode !== "wide";
  const dock = usePart<AssistantDockState>(
    "editor-assistant-dock",
    {
      "aria-label": "Assistant",
      hidden,
      "data-editor-rail": "left",
      "data-testid": "agent-column",
      style: focused ? undefined : { width: assistantWidth },
      ...props,
    },
    {
      state: { focused, hidden },
      tag: "aside",
      className: cn(
        "bg-background min-h-0 min-w-0 flex-col overflow-hidden",
        hidden ? "hidden" : "flex",
        focused ? "h-full w-full flex-1" : "border-border h-full shrink-0 border-r",
      ),
      props: {
        children:
          assistant === null ? null : (
            <div
              className="flex h-full min-h-0 min-w-0 flex-col"
              style={focused ? undefined : { width: assistantWidth, maxWidth: "100%" }}
            >
              <div
                data-slot="editor-assistant-dock-header"
                className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3"
              >
                <Sparkle className="text-primary size-4 shrink-0" />
                <p className="text-foreground truncate text-sm font-medium">Assistant</p>
                {assistant.header !== null && (
                  <div className="ml-auto shrink-0">{assistant.header}</div>
                )}
              </div>
              <div data-slot="editor-assistant-dock-body" className="flex min-h-0 flex-1 flex-col">
                {assistant.panel}
              </div>
            </div>
          ),
      },
    },
  );
  return assistant === null ? null : dock;
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
