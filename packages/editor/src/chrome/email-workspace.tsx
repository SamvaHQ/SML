import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, type ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";

import { SourceWorkspace } from "../channels/source-workspace";
import { WorkspaceTabs, type WorkspaceView } from "../channels/workspace-ui";
import { useEditorStore, useEditorStoreApi } from "../state/context";
import type { FocusedPane } from "../state/store";
import { AssistantColumn } from "./assistant-rail";
import { CanvasPane } from "./canvas-pane";
import { useContribution } from "./contributions";
import { ChatBubble, Eye } from "./editor-icons";
import { Inspector } from "./inspector";
import { LeftRail } from "./left-rail";
import { ReadonlyInspector } from "./readonly-inspector";
import { ResizeHandle } from "./resize";
import { SourceHistory } from "./source-controls";
import { cn, tabOptionClass, tabTroughClass } from "./ui-classes";
import { WorkPane } from "./work-pane";

/** The two panes a docked workspace switches between when its frame is narrower than 1280px. */
const PANE_META: Record<
  FocusedPane,
  {
    readonly label: string;
    readonly tip: string;
    readonly Icon: ComponentType<{ className?: string }>;
  }
> = {
  assistant: { label: "Chat", tip: "Show the chat", Icon: ChatBubble },
  preview: { label: "Preview", tip: "Show the preview and its views", Icon: Eye },
};

const FOCUSED_PANES: ReadonlyArray<FocusedPane> = ["assistant", "preview"];

/**
 * The Chat | Preview switch of a docked workspace too narrow for both panes. Preview carries a
 * dot while the host has changed the email since the author last looked at it.
 */
function PaneSwitch({ idBase }: { readonly idBase: string }) {
  const { focusedPane, previewUnseen } = useEditorStore(
    useShallow((state) => ({
      focusedPane: state.focusedPane,
      previewUnseen: state.previewUnseen,
    })),
  );
  const setFocusedPane = useEditorStore((state) => state.actions.setFocusedPane);
  return (
    <div className="border-border bg-background shrink-0 border-b px-2.5 py-2">
      <ToggleGroup
        role="tablist"
        value={[focusedPane]}
        onValueChange={(values) => {
          const next = values[0];
          if (FOCUSED_PANES.some((pane) => pane === next)) setFocusedPane(next as FocusedPane);
        }}
        aria-label="Editor pane"
        className={cn("grid w-full grid-cols-2", tabTroughClass)}
      >
        {FOCUSED_PANES.map((pane) => {
          const { Icon, label, tip } = PANE_META[pane];
          const unseen = pane === "preview" && previewUnseen && focusedPane !== "preview";
          return (
            <Toggle
              key={pane}
              id={`${idBase}-tab-${pane}`}
              type="button"
              role="tab"
              aria-selected={focusedPane === pane}
              aria-controls={`${idBase}-pane-${pane}`}
              aria-pressed={undefined}
              value={pane}
              title={tip}
              data-testid={`agent-workspace.tab.${pane}`}
              data-editor-control=""
              className={cn(tabOptionClass, "h-7 w-full px-2.5 text-[12.5px]")}
            >
              <Icon className="size-3.5" />
              {label}
              {unseen && (
                <span
                  data-testid="agent-workspace.preview-updated"
                  className="bg-accent-email size-1.5 rounded-full"
                >
                  <span className="sr-only">, updated</span>
                </span>
              )}
            </Toggle>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

/**
 * The email workspace. With a docked assistant: chat and a tabbed work pane side by side from
 * 1280px of frame width, a Chat | Preview switch below it. Without one: layers, canvas and
 * inspector around the Visual | Source switch.
 */
export function EmailWorkspace() {
  const sourceEditable = useEditorStore((state) => state.sourceEditable);
  const leftCollapsed = useEditorStore((state) => state.leftCollapsed);
  const rightCollapsed = useEditorStore((state) => state.rightCollapsed);
  const layoutMode = useEditorStore((state) => state.layoutMode);
  const chatCollapsed = useEditorStore((state) => state.chatCollapsed);
  const focusedPane = useEditorStore((state) => state.focusedPane);
  const assistantDocked = useContribution("rail.assistant") !== undefined;
  const view = useEditorStore((state) => state.workspaceView);
  const store = useEditorStoreApi();
  const setView = (value: WorkspaceView) => store.setState({ workspaceView: value });
  const paneBase = useId();

  if (assistantDocked) {
    // One tree for both layouts, so crossing 1280px never remounts the host's assistant.
    const focused = layoutMode !== "wide";
    const chatHidden = focused ? focusedPane !== "assistant" : chatCollapsed;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {focused && <PaneSwitch idBase={paneBase} />}
        <div
          className="relative flex min-h-0 min-w-0 flex-1"
          data-agent-workspace-layout={focused ? "focused" : "split"}
        >
          <div
            id={`${paneBase}-pane-assistant`}
            role={focused ? "tabpanel" : undefined}
            aria-labelledby={focused ? `${paneBase}-tab-assistant` : undefined}
            hidden={chatHidden}
            className={cn(!focused && "contents", focused && "flex h-full min-h-0 min-w-0 flex-1")}
          >
            <AssistantColumn hidden={chatHidden} />
          </div>
          {!focused && !chatCollapsed && <ResizeHandle side="assistant" />}
          <div
            id={`${paneBase}-pane-preview`}
            role={focused ? "tabpanel" : undefined}
            aria-labelledby={focused ? `${paneBase}-tab-preview` : undefined}
            hidden={focused && focusedPane !== "preview"}
            className="flex min-h-0 min-w-0 flex-1"
          >
            <WorkPane split={!focused} visible={!focused || focusedPane === "preview"} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SourceHistory />
      <WorkspaceTabs value={view} onChange={setView}>
        {view === "source" ? (
          <SourceWorkspace />
        ) : (
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <LeftRail />
            {!leftCollapsed && <ResizeHandle side="left" />}
            <CanvasPane />
            {!rightCollapsed && <ResizeHandle side="right" />}
            {sourceEditable ? <Inspector /> : <ReadonlyInspector />}
          </div>
        )}
      </WorkspaceTabs>
    </div>
  );
}
