import { Tabs } from "@base-ui/react/tabs";
import type { ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";

import { SourceWorkspace } from "../channels/source-workspace";
import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import { summarizeChecks } from "../state/derive";
import { ADDED_WORK_TABS, type WorkTab } from "../state/store";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { CanvasPane } from "./canvas-pane";
import { ChecksPanel } from "./checks-panel";
import { useContribution } from "./contributions";
import { DesignPanel } from "./design-panel";
import {
  Check,
  CheckList,
  Code,
  Compare,
  Eye,
  Layers,
  Plus,
  SidebarLeft,
  SidebarLeftHide,
  Xmark,
} from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { Tip } from "./ui";
import { revealOnRowHover } from "./ui-classes";

/** Each tab's name, glyph, and the line the "+" menu says about it. */
const TAB_META: Record<
  WorkTab,
  {
    readonly label: string;
    readonly hint: string;
    readonly Icon: ComponentType<{ className?: string }>;
  }
> = {
  preview: { label: "Preview", hint: "The email", Icon: Eye },
  source: { label: "Source", hint: "The template's code", Icon: Code },
  design: { label: "Design", hint: "Layers and properties", Icon: Layers },
  review: { label: "Review", hint: "Changes to look over", Icon: Compare },
  checks: { label: "Checks", hint: "Clients, size and links", Icon: CheckList },
};

/** A count beside the Checks tab while anything needs attention. */
function ChecksBadge() {
  const { errorCount, warnCount } = useEditorStore(
    useShallow((state) => {
      const summary = summarizeChecks(state.checks);
      return { errorCount: summary.errorCount, warnCount: summary.warnCount };
    }),
  );
  const count = errorCount + warnCount;
  if (count === 0) return null;
  return (
    <Badge
      variant={errorCount > 0 ? "destructive" : "secondary"}
      data-testid="work-pane.checks-badge"
      className="h-4 min-w-4 px-1 tabular-nums"
    >
      {count}
    </Badge>
  );
}

/** The "+" menu's rows: every view the work pane can add, with a check on the open ones. */
export function AddViewItems() {
  const workTabs = useEditorStore((state) => state.workTabs);
  const openWorkTab = useEditorStore((state) => state.actions.openWorkTab);
  const review = useContribution("rail.review") ?? null;
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Open a view</DropdownMenuLabel>
      {ADDED_WORK_TABS.filter((tab) => tab !== "review" || review !== null).map((tab) => {
        const { label, hint, Icon } = TAB_META[tab];
        return (
          <DropdownMenuItem
            key={tab}
            data-testid={`work-pane.add.${tab}`}
            data-editor-control=""
            onClick={() => openWorkTab(tab)}
            className="py-1.5"
          >
            <Icon className="text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{label}</span>
              <span className="text-muted-foreground text-xs">{hint}</span>
            </span>
            {workTabs.includes(tab) && <Check className="text-muted-foreground" />}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}

/** The state an `EditorWorkPane` exposes. */
export interface WorkPaneState extends Record<string, unknown> {
  /** The tab on screen. */
  readonly tab: WorkTab;
  /** The pane sits beside the chat rather than switching with it. */
  readonly split: boolean;
}

/** One tab of the work pane's tab row: shadcn's ghost button, filled while selected. */
const TAB_CLASS = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "text-muted-foreground data-active:bg-muted data-active:text-foreground shrink-0 text-[13px]",
);

/**
 * The work pane beside a docked assistant: one tab row over the preview and the views an author
 * adds from "+" (Source, Design, Review, Checks). Preview is always there; added tabs close from
 * a × that shows on hover or focus, and always on a touch screen. In the split layout the row
 * starts with the control that collapses the chat so the work pane takes the full width. On a
 * phone, while Preview is the only tab, the row steps aside and the preview bar's menu offers the
 * views instead.
 */
export function EditorWorkPane({
  split,
  visible = true,
  ...props
}: PartProps<"section", WorkPaneState> & {
  readonly split: boolean;
  /** The pane is on screen; a Chat | Preview switch showing the chat hides it. */
  readonly visible?: boolean | undefined;
}) {
  const { workTabs, activeWorkTab, chatCollapsed, narrow } = useEditorStore(
    useShallow((state) => ({
      workTabs: state.workTabs,
      activeWorkTab: state.activeWorkTab,
      chatCollapsed: state.chatCollapsed,
      narrow: state.layoutMode === "narrow",
    })),
  );
  const { openWorkTab, closeWorkTab, setChatCollapsed } = useEditorStore((state) => state.actions);
  const review = useContribution("rail.review") ?? null;
  // Review exists only while the host docks a review surface; a tab left open from a session
  // that had one is not shown, and the pane falls back to Preview rather than a dead tab.
  const tabs = workTabs.filter((tab) => tab !== "review" || review !== null);
  const active: WorkTab =
    activeWorkTab !== "preview" && !tabs.includes(activeWorkTab) ? "preview" : activeWorkTab;
  const chatLabel = chatCollapsed ? "Show chat" : "Collapse chat";
  const rowHidden = narrow && tabs.length === 0;

  return usePart<WorkPaneState>(
    "editor-work-pane",
    { "aria-label": "Work pane", "data-testid": "work-pane", ...props },
    {
      state: { tab: active, split },
      tag: "section",
      className: "bg-background @container/work-pane flex min-h-0 min-w-0 flex-1 flex-col",
      props: {
        children: (
          <Tabs.Root
            value={active}
            onValueChange={(value) => {
              if (value === "preview" || ADDED_WORK_TABS.some((tab) => tab === value))
                openWorkTab(value as WorkTab);
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {!rowHidden && (
              <div
                data-slot="editor-work-pane-header"
                className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2"
              >
                {split && (
                  <Tip label={chatLabel}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={chatLabel}
                      aria-pressed={chatCollapsed}
                      data-testid="work-pane.toggle-chat"
                      data-editor-control=""
                      onClick={() => setChatCollapsed(!chatCollapsed)}
                      className="text-muted-foreground mr-0.5"
                    >
                      {chatCollapsed ? <SidebarLeft /> : <SidebarLeftHide />}
                    </Button>
                  </Tip>
                )}
                <Tabs.List
                  data-slot="editor-work-pane-tabs"
                  aria-label="Work pane views"
                  className={cn(
                    // The list fills the header's height so the phone's 44px hit areas stay
                    // inside it instead of making the row scroll.
                    "samva-editor-scroll-hidden flex h-full min-w-0 items-center gap-1 overflow-x-auto",
                    narrow && "px-2",
                  )}
                >
                  <Tabs.Tab
                    value="preview"
                    data-slot="editor-work-pane-tab"
                    data-testid="work-pane.tab.preview"
                    data-editor-control=""
                    aria-label={narrow ? "Preview" : undefined}
                    className={cn(TAB_CLASS, narrow && "px-2")}
                  >
                    <Eye />
                    {narrow ? null : "Preview"}
                  </Tabs.Tab>
                  {tabs.map((tab) => {
                    const { label, Icon } = TAB_META[tab];
                    return (
                      <span
                        key={tab}
                        data-slot="editor-work-pane-tab-group"
                        className="group/row relative inline-flex shrink-0 items-center"
                      >
                        <Tabs.Tab
                          value={tab}
                          data-slot="editor-work-pane-tab"
                          data-testid={`work-pane.tab.${tab}`}
                          data-editor-control=""
                          aria-label={narrow ? label : undefined}
                          className={cn(TAB_CLASS, narrow ? "px-2" : "pr-7")}
                        >
                          <Icon />
                          {narrow ? null : label}
                          {tab === "review" && review?.badge}
                          {tab === "checks" && <ChecksBadge />}
                        </Tabs.Tab>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Close ${label}`}
                          data-slot="editor-work-pane-tab-close"
                          data-testid={`work-pane.close.${tab}`}
                          data-editor-control=""
                          onClick={() => closeWorkTab(tab)}
                          className={cn(
                            "text-muted-foreground size-5 rounded-sm",
                            narrow ? "relative" : "absolute right-1",
                            revealOnRowHover,
                            // The shown tab keeps its × in view, so its pill never looks lopsided.
                            "group-has-[[data-active]]/row:opacity-100",
                          )}
                        >
                          <Xmark className="size-3" />
                        </Button>
                      </span>
                    );
                  })}
                </Tabs.List>
                <DropdownMenu>
                  <Tip label="Add a view">
                    <DropdownMenuTrigger
                      data-slot="editor-work-pane-add"
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Add a view"
                          data-testid="work-pane.add"
                          data-editor-control=""
                          className="text-muted-foreground"
                        />
                      }
                    >
                      <Plus />
                    </DropdownMenuTrigger>
                  </Tip>
                  <DropdownMenuContent data-testid="work-pane.add-menu" className="w-60">
                    <AddViewItems />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            <Tabs.Panel
              value="preview"
              keepMounted
              data-slot="editor-work-pane-panel"
              data-testid="work-pane.panel.preview"
              className="flex min-h-0 min-w-0 flex-1 outline-none"
            >
              <CanvasPane
                pointing
                active={visible && active === "preview"}
                viewMenu={rowHidden ? <AddViewItems /> : undefined}
              />
            </Tabs.Panel>
            {active === "source" && (
              <Tabs.Panel
                value="source"
                data-slot="editor-work-pane-panel"
                className="flex min-h-0 min-w-0 flex-1 outline-none"
              >
                <SourceWorkspace />
              </Tabs.Panel>
            )}
            {active === "design" && (
              <Tabs.Panel
                value="design"
                data-slot="editor-work-pane-panel"
                className="flex min-h-0 min-w-0 flex-1 outline-none"
              >
                <DesignPanel />
              </Tabs.Panel>
            )}
            {active === "review" && review !== null && (
              <Tabs.Panel
                value="review"
                data-slot="editor-work-pane-panel"
                data-testid="work-pane.panel.review"
                className="samva-editor-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6 outline-none"
              >
                {review.content}
              </Tabs.Panel>
            )}
            {active === "checks" && (
              <Tabs.Panel
                value="checks"
                data-slot="editor-work-pane-panel"
                data-testid="work-pane.panel.checks"
                className="samva-editor-scroll min-h-0 flex-1 overflow-y-auto outline-none"
              >
                <div className="max-w-2xl px-4 pt-4 pb-8">
                  <ChecksPanel />
                </div>
              </Tabs.Panel>
            )}
          </Tabs.Root>
        ),
      },
    },
  );
}
