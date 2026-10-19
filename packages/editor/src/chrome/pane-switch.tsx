import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import type { FocusedPane } from "../state/store";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { ChatBubble, Eye } from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { useShellChrome } from "./shell-context";
import { segmentedGroupClass, segmentedItemClass } from "./ui-classes";

/** The state an {@link EditorPaneSwitch} exposes. */
export interface EditorPaneSwitchState extends Record<string, unknown> {
  /** The pane on screen. */
  readonly pane: FocusedPane;
  /** The host changed the email since the author last looked at the preview. */
  readonly unseen: boolean;
}

const PANES: ReadonlyArray<FocusedPane> = ["assistant", "preview"];

/**
 * The Chat | Preview switch of a docked workspace narrower than 1280px. Preview carries a dot
 * while the host has changed the email since the author last looked at it. The default top bar
 * holds it; a host that lays out its own chrome places it anywhere inside `EditorRoot`.
 */
export function EditorPaneSwitch({
  compact = false,
  ...props
}: PartProps<"div", EditorPaneSwitchState> & {
  /** Icons only, for a phone-width top bar; each option keeps its name for assistive tech. */
  readonly compact?: boolean | undefined;
}) {
  const { focusedPane, previewUnseen } = useEditorStore(
    useShallow((state) => ({
      focusedPane: state.focusedPane,
      previewUnseen: state.previewUnseen,
    })),
  );
  const setFocusedPane = useEditorStore((state) => state.actions.setFocusedPane);
  const { idBase } = useShellChrome();
  const unseen = previewUnseen && focusedPane !== "preview";
  return usePart(
    "editor-pane-switch",
    { ...props },
    {
      state: { pane: focusedPane, unseen },
      className: "flex min-w-0",
      props: {
        children: (
          <ToggleGroup
            role="tablist"
            aria-label="Editor pane"
            value={[focusedPane]}
            spacing={0}
            onValueChange={(values) => {
              const next = PANES.find((pane) => pane === values[0]);
              if (next !== undefined) setFocusedPane(next);
            }}
            className={cn(segmentedGroupClass, "grid h-8 w-full grid-cols-2", compact && "w-auto")}
          >
            {PANES.map((pane) => (
              <ToggleGroupItem
                key={pane}
                value={pane}
                id={`${idBase}-tab-${pane}`}
                role="tab"
                aria-selected={focusedPane === pane}
                aria-controls={`${idBase}-pane-${pane}`}
                aria-pressed={undefined}
                aria-label={compact ? (pane === "assistant" ? "Chat" : "Preview") : undefined}
                data-pressed={focusedPane === pane ? "" : undefined}
                data-testid={`agent-workspace.tab.${pane}`}
                data-editor-control=""
                className={cn(
                  segmentedItemClass,
                  compact ? "px-2.5" : "gap-1.5 px-3 text-[13px]",
                  "aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm dark:aria-selected:border-input dark:aria-selected:bg-input/30",
                )}
              >
                {pane === "assistant" ? (
                  <ChatBubble className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                {compact ? null : pane === "assistant" ? "Chat" : "Preview"}
                {pane === "preview" && unseen && (
                  <span
                    data-testid="agent-workspace.preview-updated"
                    className="bg-primary size-1.5 rounded-full"
                  >
                    <span className="sr-only">, updated</span>
                  </span>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ),
      },
    },
  );
}
