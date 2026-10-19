import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import { summarizeChecks } from "../state/derive";
import type { EditorLayoutMode } from "../state/store";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Separator } from "../ui/separator";
import { AttentionSummary } from "./compatibility-report";
import { useContribution } from "./contributions";
import { usePart, type PartProps } from "./part";

/** What the root hands the status bar about saving versions. */
export interface StatusBarProps {
  readonly saveVersionStatus?: string | undefined;
  readonly saveVersionState?: "idle" | "saving" | "saved" | "error" | undefined;
  readonly onSaveVersion?: (() => void) | undefined;
  readonly saveVersionBusy?: boolean | undefined;
  /** Another lifecycle action (restore, publish, conflict resolution) holds the draft. */
  readonly saveVersionBlocked?: boolean | undefined;
  readonly guestHeadline?: string | undefined;
}

/** The state an `EditorStatusBar` exposes. */
export interface StatusBarState extends Record<string, unknown> {
  readonly layout: EditorLayoutMode;
  /** Where the draft stands: idle, saving, saved, error, or unavailable without versions. */
  readonly save: string;
}

/**
 * The status bar. With a docked chat beside the work pane its two halves line up with the
 * panes: the checks and the draft under the chat, the version status under the work pane.
 */
export function StatusBar({
  saveVersionStatus,
  saveVersionState,
  onSaveVersion,
  saveVersionBusy,
  saveVersionBlocked,
  guestHeadline,
  part,
}: StatusBarProps & {
  /** The part's own props: `className`, `render` and attributes from the host. */
  readonly part?: PartProps<"footer", StatusBarState> | undefined;
}) {
  const { doc, checks, sizeKb, layoutMode, assistantWidth, chatCollapsed } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      checks: state.checks,
      sizeKb: state.sizeKb,
      layoutMode: state.layoutMode,
      assistantWidth: state.assistantWidth,
      chatCollapsed: state.chatCollapsed,
    })),
  );
  const docked = useContribution("rail.assistant") !== undefined;
  const { selectDocument, openWorkTab, setFocusedPane } = useEditorStore((state) => state.actions);
  const editable = useEditorStore((state) => state.sourceEditable);
  const pendingAuthoredSource = useEditorStore((state) => state.pendingAuthoredSource);
  const persistTrouble = useEditorStore(
    useShallow((state) => ({ storageError: state.storageError, conflict: state.conflict })),
  );
  const [open, setOpen] = useState(false);

  const { errorCount, warnCount } = summarizeChecks(checks);
  const narrow = layoutMode === "narrow";
  const split = docked && layoutMode === "wide" && !chatCollapsed;
  // Only the email workspace has a work pane, and so a Checks tab, beside a docked assistant.
  const checksTab = docked && (doc === null || doc.channel === "email");
  const pending = checks.filter((check) =>
    check.diagnostics?.some((item) => item.compatibility?.assessment === "unverified"),
  ).length;
  let summary = "No issues found";
  if (pending > 0) summary = `${pending} check${pending > 1 ? "s" : ""} to review`;
  if (warnCount > 0) summary = `${warnCount} warning${warnCount > 1 ? "s" : ""}`;
  if (errorCount > 0) summary = `${errorCount} check${errorCount > 1 ? "s" : ""} failing`;
  if (checks.length === 0) summary = "No checks yet";

  // A static guest headline ("Draft saved") would otherwise read as saved while a persist is
  // still queued, blocked, or has failed. The live save note wins whenever it says anything
  // active — including storage/session failures and foreign-change conflicts, which the banners
  // also surface.
  const guestSaveNote =
    saveVersionState === "error" || persistTrouble.storageError !== null || persistTrouble.conflict
      ? "Couldn't save version"
      : pendingAuthoredSource !== null || saveVersionBusy === true
        ? "Saving…"
        : undefined;

  const indicator = (
    <>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          errorCount > 0
            ? "bg-status-error"
            : warnCount > 0
              ? "bg-status-warning"
              : "bg-muted-foreground",
        )}
      />
      {guestHeadline === undefined && !narrow ? summary : null}
    </>
  );

  return usePart<StatusBarState>(
    "editor-status-bar",
    { ...part },
    {
      state: { layout: layoutMode, save: saveVersionState ?? "unavailable" },
      tag: "footer",
      className:
        "border-border bg-background text-muted-foreground z-30 flex h-8 shrink-0 items-stretch border-t text-xs whitespace-nowrap",
      props: {
        children: (
          <>
            <div
              data-slot="editor-status-bar-start"
              style={split ? { width: assistantWidth } : undefined}
              className={cn("flex min-w-0 shrink-0 items-center gap-3 px-2", split && "pr-3")}
            >
              {checksTab ? (
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="statusbar.checks-trigger"
                  data-editor-control=""
                  aria-label={narrow ? summary : undefined}
                  onClick={() => {
                    openWorkTab("checks");
                    setFocusedPane("preview");
                  }}
                  className="text-muted-foreground font-normal"
                >
                  {indicator}
                </Button>
              ) : (
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="xs"
                        data-testid="statusbar.checks-trigger"
                        data-editor-control=""
                        aria-label={narrow ? summary : undefined}
                        onClick={() => selectDocument()}
                        className="text-muted-foreground font-normal"
                      />
                    }
                  >
                    {indicator}
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    sideOffset={8}
                    data-testid="statusbar.checks-popup"
                    className="max-h-[min(560px,70vh)] w-[360px] overflow-y-auto p-3.5"
                  >
                    <AttentionSummary checks={checks} editable={editable} />
                  </PopoverContent>
                </Popover>
              )}
              {guestHeadline !== undefined ? (
                <span data-testid="statusbar.guest" className="min-w-0 truncate">
                  {guestSaveNote ?? guestHeadline}
                </span>
              ) : (
                !narrow && <span>{doc === null ? "Loading…" : "Draft"}</span>
              )}
            </div>
            {!split && <Separator orientation="vertical" className="my-2.5" />}
            <div
              data-slot="editor-status-bar-end"
              className="flex min-w-0 flex-1 items-center gap-1 px-2"
            >
              {guestHeadline === undefined ? (
                <span
                  aria-live="polite"
                  data-testid="statusbar.save-version"
                  data-save-version-state={saveVersionState ?? "unavailable"}
                  className="px-1"
                >
                  {saveVersionStatus ?? "Autosaved just now"}
                </span>
              ) : (
                <span
                  className="sr-only"
                  aria-live="polite"
                  data-testid="statusbar.save-version"
                  data-save-version-state={saveVersionState ?? "unavailable"}
                >
                  {guestSaveNote ?? saveVersionStatus ?? guestHeadline}
                </span>
              )}
              {onSaveVersion !== undefined && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={onSaveVersion}
                  disabled={saveVersionBusy === true || saveVersionBlocked === true}
                  data-testid="topbar.save-version"
                  data-editor-control=""
                  aria-label="Save the current draft as a version"
                  title="Save this draft as a version (⌘/Ctrl+S)"
                  className="text-foreground"
                >
                  {saveVersionBusy === true
                    ? "Saving…"
                    : saveVersionStatus === "Couldn’t save version"
                      ? "Retry"
                      : "Save version"}
                </Button>
              )}
              <span className="flex-1" />
              {/* An email's width and size sit in its preview bar; other channels report theirs here. */}
              {!narrow && doc !== null && doc.channel !== "email" && (
                <span className="px-1">
                  {sizeKb} KB · {doc.channel.toUpperCase()}
                </span>
              )}
            </div>
          </>
        ),
      },
    },
  );
}
