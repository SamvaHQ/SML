import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, type ComponentType } from "react";

import { SourceWorkspace } from "../channels/source-workspace";
import { workspaceTabId } from "../channels/workspace-tabs";
import { WorkspaceTabs, type WorkspaceView } from "../channels/workspace-ui";
import { useEditorStore, useEditorStoreApi } from "../state/context";
import type { FocusedPane } from "../state/store";
import { AssistantColumn } from "./assistant-rail";
import { CanvasPane } from "./canvas-pane";
import { useContribution } from "./contributions";
import { DesignRail } from "./design-rail";
import { Eye, Layers, Sparkle } from "./editor-icons";
import { Inspector } from "./inspector";
import { LeftRail } from "./left-rail";
import { ReadonlyInspector } from "./readonly-inspector";
import { ResizeHandle } from "./resize";
import { SourceHistory } from "./source-controls";
import { cn, tabOptionClass } from "./ui-classes";

/** Pane switcher affordances mirror the surfaces they open: Sparkle for the Assistant rail, Eye for preview, Layers for Design. */
const PANE_META: Record<
  FocusedPane,
  {
    readonly label: string;
    readonly tip: string;
    readonly Icon: ComponentType<{ className?: string }>;
  }
> = {
  assistant: { label: "Assistant", tip: "Show the assistant", Icon: Sparkle },
  preview: { label: "Preview", tip: "Show the preview", Icon: Eye },
  design: { label: "Design", tip: "Show designs, layers, and inspector", Icon: Layers },
};

/** The email-specific Assistant, canvas, and Design composition. */
export function EmailWorkspace() {
  const sourceEditable = useEditorStore((state) => state.sourceEditable);
  const leftCollapsed = useEditorStore((state) => state.leftCollapsed);
  const rightCollapsed = useEditorStore((state) => state.rightCollapsed);
  const layoutMode = useEditorStore((state) => state.layoutMode);
  const assistantDocked = useContribution("rail.assistant") !== undefined;
  const designReview = useContribution("rail.review");
  const view = useEditorStore((state) => state.workspaceView);
  const focusedPane = useEditorStore((state) => state.focusedPane);
  const setFocusedPane = useEditorStore((state) => state.actions.setFocusedPane);
  const store = useEditorStoreApi();
  const setView = (value: WorkspaceView) => store.setState({ workspaceView: value });
  const paneBase = useId();
  const tablet = assistantDocked && layoutMode === "compact";
  const mobile = assistantDocked && layoutMode === "narrow";
  const focused = tablet || mobile;
  const focusedPanes: ReadonlyArray<FocusedPane> = tablet
    ? ["assistant", "preview", "design"]
    : ["assistant", "preview"];
  const activeFocusedPane =
    view === "source" ? "preview" : focusedPanes.includes(focusedPane) ? focusedPane : "assistant";

  if (assistantDocked) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspaceTabs
          value={view}
          onChange={(next) => {
            setView(next);
            if (focused) setFocusedPane("preview");
          }}
          idBase={paneBase}
          panelId={`${paneBase}-view-panel`}
        />
        {focused && (
          <ToggleGroup
            role="tablist"
            value={[activeFocusedPane]}
            onValueChange={(values) => {
              const next = values[0];
              if (focusedPanes.some((pane) => pane === next)) {
                setFocusedPane(next as FocusedPane);
                if (next !== "preview" && view === "source") setView("visual");
              }
            }}
            aria-label="Editor pane"
            className="border-border bg-background flex h-11 shrink-0 items-center gap-1 border-b p-1.5"
          >
            {focusedPanes.map((pane) => {
              const { Icon, label, tip } = PANE_META[pane];
              return (
                <Toggle
                  key={pane}
                  id={`${paneBase}-tab-${pane}`}
                  type="button"
                  role="tab"
                  aria-selected={activeFocusedPane === pane}
                  aria-controls={`${paneBase}-pane-${pane}`}
                  aria-pressed={undefined}
                  value={pane}
                  title={tip}
                  data-testid={`agent-workspace.tab.${pane}`}
                  className={cn(tabOptionClass, "h-8 flex-1 px-2.5 text-[12px]")}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {label}
                  {pane === "design" && designReview?.badge}
                </Toggle>
              );
            })}
          </ToggleGroup>
        )}
        <div
          className="relative flex min-h-0 min-w-0 flex-1"
          data-agent-workspace-layout={focused ? "focused" : "split"}
        >
          <div
            id={`${paneBase}-pane-assistant`}
            role={focused ? "tabpanel" : undefined}
            aria-labelledby={focused ? `${paneBase}-tab-assistant` : undefined}
            hidden={focused && activeFocusedPane !== "assistant"}
            className={cn(
              !focused && "contents",
              focused && activeFocusedPane === "assistant" && "flex h-full min-h-0 min-w-0 flex-1",
            )}
          >
            <AssistantColumn hidden={focused && activeFocusedPane !== "assistant"} />
          </div>
          {!focused && <ResizeHandle side="assistant" />}
          <div
            id={`${paneBase}-pane-preview`}
            role={focused ? "tabpanel" : undefined}
            aria-labelledby={focused ? `${paneBase}-tab-preview` : undefined}
            hidden={focused && activeFocusedPane !== "preview"}
            className={cn(
              "min-h-0 min-w-0 flex-1",
              (!focused || activeFocusedPane === "preview") && "flex",
            )}
          >
            <div
              id={`${paneBase}-view-panel`}
              role="tabpanel"
              aria-labelledby={workspaceTabId(paneBase, view)}
              className="flex min-h-0 min-w-0 flex-1"
            >
              {view === "source" ? <SourceWorkspace /> : <CanvasPane pointing />}
            </div>
          </div>
          {!focused && <ResizeHandle side="right" />}
          <div
            id={`${paneBase}-pane-design`}
            role={tablet ? "tabpanel" : undefined}
            aria-labelledby={tablet ? `${paneBase}-tab-design` : undefined}
            hidden={focused && activeFocusedPane !== "design"}
            className={cn(
              !focused && "contents",
              focused && activeFocusedPane === "design" && "flex h-full min-h-0 min-w-0 flex-1",
            )}
          >
            {mobile ? null : <DesignRail focused={focused} />}
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
