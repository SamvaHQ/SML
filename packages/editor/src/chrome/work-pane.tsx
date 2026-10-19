import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import type { ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";

import { SourceWorkspace } from "../channels/source-workspace";
import { useEditorStore } from "../state/context";
import { summarizeChecks } from "../state/derive";
import { ADDED_WORK_TABS, type AddedWorkTab, type WorkTab } from "../state/store";
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
import { Tip } from "./ui";
import {
  cn,
  focusRing,
  iconButton,
  menuItemClass,
  menuLabelClass,
  menuPopupClass,
  revealOnRowHover,
  tabOptionClass,
} from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

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

const TAB_CLASS = cn(tabOptionClass, "h-7 shrink-0 px-2 text-[12.5px]");

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
    <span
      data-testid="work-pane.checks-badge"
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums",
        errorCount > 0
          ? "bg-status-error/15 text-status-error"
          : "bg-status-warning/20 text-foreground",
      )}
    >
      {count}
    </span>
  );
}

/**
 * The work pane beside a docked assistant: one tab bar over the preview and the views an author
 * adds from "+" (Source, Design, Review, Checks). Preview is always there; added tabs close from
 * a × that shows on hover or focus, and always on a touch screen. In the split layout the bar
 * starts with the control that collapses the chat so the work pane takes the full width.
 */
export function WorkPane({
  split,
  visible = true,
}: {
  readonly split: boolean;
  /** The pane is on screen; a Chat | Preview switch showing the chat hides it. */
  readonly visible?: boolean | undefined;
}) {
  const portalContainer = useEditorPortalContainer();
  const { workTabs, activeWorkTab, chatCollapsed } = useEditorStore(
    useShallow((state) => ({
      workTabs: state.workTabs,
      activeWorkTab: state.activeWorkTab,
      chatCollapsed: state.chatCollapsed,
    })),
  );
  const { openWorkTab, closeWorkTab, setChatCollapsed } = useEditorStore((state) => state.actions);
  const review = useContribution("rail.review") ?? null;
  // Review exists only while the host docks a review surface; a tab left open from a session
  // that had one is not shown, and the pane falls back to Preview rather than a dead tab.
  const offered = (tab: AddedWorkTab) => tab !== "review" || review !== null;
  const tabs = workTabs.filter(offered);
  const active: WorkTab =
    activeWorkTab !== "preview" && !tabs.includes(activeWorkTab) ? "preview" : activeWorkTab;
  const chatLabel = chatCollapsed ? "Show chat" : "Collapse chat";

  return (
    <section
      aria-label="Work pane"
      data-testid="work-pane"
      className="bg-background flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <Tabs.Root
        value={active}
        onValueChange={(value) => {
          if (value === "preview" || ADDED_WORK_TABS.some((tab) => tab === value))
            openWorkTab(value as WorkTab);
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div className="border-border flex h-11 shrink-0 items-center gap-1 border-b px-2">
          {split && (
            <Tip label={chatLabel}>
              <button
                type="button"
                aria-label={chatLabel}
                aria-pressed={chatCollapsed}
                data-testid="work-pane.toggle-chat"
                data-editor-control=""
                onClick={() => setChatCollapsed(!chatCollapsed)}
                className={cn(iconButton, "mr-0.5")}
              >
                {chatCollapsed ? (
                  <SidebarLeft className="size-[15px]" />
                ) : (
                  <SidebarLeftHide className="size-[15px]" />
                )}
              </button>
            </Tip>
          )}
          <Tabs.List
            aria-label="Work pane views"
            className="samva-editor-scroll-hidden flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            <Tabs.Tab
              value="preview"
              data-testid="work-pane.tab.preview"
              data-editor-control=""
              className={TAB_CLASS}
            >
              <Eye className="size-3.5" />
              Preview
            </Tabs.Tab>
            {tabs.map((tab) => {
              const { label, Icon } = TAB_META[tab];
              return (
                <span key={tab} className="group/row relative inline-flex shrink-0 items-center">
                  <Tabs.Tab
                    value={tab}
                    data-testid={`work-pane.tab.${tab}`}
                    data-editor-control=""
                    // At phone width the close control takes a full touch target beside
                    // the tab rather than sitting over its label.
                    className={cn(TAB_CLASS, "pr-7 @max-[720px]/samva-editor:pr-2")}
                  >
                    <Icon className="size-3.5" />
                    {label}
                    {tab === "review" && review?.badge}
                    {tab === "checks" && <ChecksBadge />}
                  </Tabs.Tab>
                  <button
                    type="button"
                    aria-label={`Close ${label}`}
                    data-testid={`work-pane.close.${tab}`}
                    data-editor-control=""
                    onClick={() => closeWorkTab(tab)}
                    className={cn(
                      "text-muted-foreground hover:bg-muted hover:text-foreground absolute right-1 grid size-5 place-items-center rounded-sm outline-none @max-[720px]/samva-editor:static",
                      focusRing,
                      revealOnRowHover,
                    )}
                  >
                    <Xmark className="size-3" />
                  </button>
                </span>
              );
            })}
          </Tabs.List>
          <Menu.Root>
            <Tip label="Add a view">
              <Menu.Trigger
                aria-label="Add a view"
                data-testid="work-pane.add"
                data-editor-control=""
                className={iconButton}
              >
                <Plus className="size-4" />
              </Menu.Trigger>
            </Tip>
            <Menu.Portal container={portalContainer}>
              <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-[120]">
                <Menu.Popup data-testid="work-pane.add-menu" className={cn(menuPopupClass, "w-60")}>
                  <div className={menuLabelClass}>Open a view</div>
                  {ADDED_WORK_TABS.filter(offered).map((tab) => {
                    const { label, hint, Icon } = TAB_META[tab];
                    const open = tabs.includes(tab);
                    return (
                      <Menu.Item
                        key={tab}
                        data-testid={`work-pane.add.${tab}`}
                        onClick={() => openWorkTab(tab)}
                        className={cn(menuItemClass, "py-1.5")}
                      >
                        <Icon className="text-muted-foreground size-4" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span>{label}</span>
                          <span className="text-muted-foreground text-xs">{hint}</span>
                        </span>
                        {open && <Check className="text-muted-foreground size-3.5" />}
                      </Menu.Item>
                    );
                  })}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <Tabs.Panel
          value="preview"
          keepMounted
          data-testid="work-pane.panel.preview"
          className="flex min-h-0 min-w-0 flex-1 outline-none"
        >
          <CanvasPane pointing active={visible && active === "preview"} />
        </Tabs.Panel>
        {active === "source" && (
          <Tabs.Panel value="source" className="flex min-h-0 min-w-0 flex-1 outline-none">
            <SourceWorkspace />
          </Tabs.Panel>
        )}
        {active === "design" && (
          <Tabs.Panel value="design" className="flex min-h-0 min-w-0 flex-1 outline-none">
            <DesignPanel />
          </Tabs.Panel>
        )}
        {active === "review" && review !== null && (
          <Tabs.Panel
            value="review"
            data-testid="work-pane.panel.review"
            className="samva-editor-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-5 outline-none"
          >
            {review.content}
          </Tabs.Panel>
        )}
        {active === "checks" && (
          <Tabs.Panel
            value="checks"
            data-testid="work-pane.panel.checks"
            className="samva-editor-scroll min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <div className="mx-auto max-w-2xl px-4 pt-4 pb-8">
              <ChecksPanel />
            </div>
          </Tabs.Panel>
        )}
      </Tabs.Root>
    </section>
  );
}
