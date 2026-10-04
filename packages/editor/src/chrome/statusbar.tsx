import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { summarizeChecks } from "../state/derive";
import { DEVICE_WIDTH } from "../state/store";
import { AttentionSummary } from "./compatibility-report";
import { cn } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

export function StatusBar({
  saveVersionStatus,
  saveVersionState,
  onSaveVersion,
  saveVersionBusy,
  saveVersionBlocked,
  guestHeadline,
}: {
  readonly saveVersionStatus?: string | undefined;
  readonly saveVersionState?: "idle" | "saving" | "saved" | "error" | undefined;
  readonly onSaveVersion?: (() => void) | undefined;
  readonly saveVersionBusy?: boolean | undefined;
  /** Another lifecycle action (restore, publish, conflict resolution) holds the draft. */
  readonly saveVersionBlocked?: boolean | undefined;
  readonly guestHeadline?: string | undefined;
}) {
  const portalContainer = useEditorPortalContainer();
  const { doc, checks, sizeKb, deviceWidth, layoutMode } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      checks: state.checks,
      sizeKb: state.sizeKb,
      deviceWidth: DEVICE_WIDTH[state.previewDevice],
      layoutMode: state.layoutMode,
    })),
  );
  const { selectDocument } = useEditorStore((state) => state.actions);
  const editable = useEditorStore((state) => state.sourceEditable);
  const pendingAuthoredSource = useEditorStore((state) => state.pendingAuthoredSource);
  const persistTrouble = useEditorStore(
    useShallow((state) => ({ storageError: state.storageError, conflict: state.conflict })),
  );
  const [open, setOpen] = useState(false);

  const { errorCount, warnCount } = summarizeChecks(checks);
  const compact = layoutMode === "compact" || layoutMode === "narrow";
  const pending = checks.filter((check) =>
    check.diagnostics?.some((item) => item.compatibility?.assessment === "unverified"),
  ).length;
  let summary = "No known risks found";
  if (pending > 0) summary = `No known risks · ${pending} need verification`;
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

  return (
    <footer className="border-border bg-background text-muted-foreground z-30 flex min-h-8 items-center gap-4 border-t px-3.5 py-1 text-[11.5px]">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          data-testid="statusbar.checks-trigger"
          aria-label={layoutMode === "narrow" ? summary : undefined}
          onClick={() => selectDocument()}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground",
            guestHeadline === undefined &&
              (layoutMode === "narrow" ? "w-6" : "w-[clamp(96px,18vw,240px)]"),
            open && "bg-muted text-foreground",
          )}
        >
          <span
            className={cn(
              "size-[7px] shrink-0 rounded-full",
              errorCount > 0
                ? "bg-status-error"
                : warnCount > 0
                  ? "bg-status-warning"
                  : "bg-muted-foreground",
            )}
          />
          {guestHeadline === undefined && layoutMode !== "narrow" ? (
            <span className="truncate">{summary}</span>
          ) : null}
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Positioner
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-[80] outline-none"
          >
            <Popover.Popup
              data-testid="statusbar.checks-popup"
              className="samva-editor-shell border-border bg-surface-elevated max-h-[min(560px,70vh)] w-[360px] origin-[var(--transform-origin)] overflow-y-auto rounded-xl border p-3.5 shadow-[var(--shadow-xl)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
            >
              <AttentionSummary checks={checks} editable={editable} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {guestHeadline !== undefined ? (
        <span data-testid="statusbar.guest" className="min-w-0 truncate">
          {guestSaveNote ?? guestHeadline}
        </span>
      ) : (
        !compact && <span className="w-[52px] shrink-0">{doc === null ? "Loading…" : "Draft"}</span>
      )}
      {guestHeadline === undefined ? (
        <span
          aria-live="polite"
          data-testid="statusbar.save-version"
          data-save-version-state={saveVersionState ?? "unavailable"}
          className={cn(
            "truncate",
            layoutMode === "narrow" ? "min-w-0 flex-1" : "w-[150px] shrink-0",
          )}
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
        <button
          type="button"
          onClick={onSaveVersion}
          disabled={saveVersionBusy === true || saveVersionBlocked === true}
          data-testid="topbar.save-version"
          aria-label="Save the current draft as a version"
          title="Save this draft as a version (⌘/Ctrl+S)"
          className="hover:bg-muted hover:text-foreground w-[82px] shrink-0 rounded-md px-1.5 py-0.5 text-left transition-colors"
        >
          {saveVersionBusy === true
            ? "Saving…"
            : saveVersionStatus === "Couldn’t save version"
              ? "Retry"
              : "Save version"}
        </button>
      )}
      <span className="flex-1" />
      {!compact && <span className="w-10 shrink-0 text-right">{sizeKb} KB</span>}
      {layoutMode !== "narrow" && (
        <span className="w-[42px] shrink-0 text-right">
          {doc?.channel === "email" ? `${deviceWidth}px` : (doc?.channel.toUpperCase() ?? "")}
        </span>
      )}
    </footer>
  );
}
