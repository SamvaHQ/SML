import { SourceWorkspace } from "../channels/source-workspace";
import { WorkspaceTabs, type WorkspaceView } from "../channels/workspace-ui";
import { cn } from "../lib/utils";
import { useEditorStore, useEditorStoreApi } from "../state/context";
import { EditorAssistantDock } from "./assistant-rail";
import { CanvasPane } from "./canvas-pane";
import { useContribution } from "./contributions";
import { Inspector } from "./inspector";
import { LeftRail } from "./left-rail";
import { ReadonlyInspector } from "./readonly-inspector";
import { ResizeHandle } from "./resize";
import { useShellChrome } from "./shell-context";
import { SourceHistory } from "./source-controls";
import { EditorWorkPane } from "./work-pane";

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
  const { idBase: paneBase } = useShellChrome();

  if (assistantDocked) {
    // One tree for both layouts, so crossing 1280px never remounts the host's assistant.
    const focused = layoutMode !== "wide";
    const chatHidden = focused ? focusedPane !== "assistant" : chatCollapsed;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <EditorAssistantDock hidden={chatHidden} />
          </div>
          {!focused && !chatCollapsed && <ResizeHandle side="assistant" />}
          <div
            id={`${paneBase}-pane-preview`}
            role={focused ? "tabpanel" : undefined}
            aria-labelledby={focused ? `${paneBase}-tab-preview` : undefined}
            hidden={focused && focusedPane !== "preview"}
            className="flex min-h-0 min-w-0 flex-1"
          >
            <EditorWorkPane split={!focused} visible={!focused || focusedPane === "preview"} />
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
