import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import { describeChecks, relativeAgo } from "../state/derive";
import { reasonOf, saveStatus, type EditorLayoutMode, type SaveStatus } from "../state/store";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Separator } from "../ui/separator";
import { AttentionSummary } from "./compatibility-report";
import { useContribution } from "./contributions";
import { MoreHorizontal } from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { Tip } from "./ui";

/** What the root hands the status bar. */
export interface StatusBarProps {
  /** Offer Save version beside the status; a guest headline can leave it out. */
  readonly saveVersionOffered?: boolean | undefined;
  readonly guestHeadline?: string | undefined;
}

/** The state an `EditorStatusBar` exposes. */
export interface StatusBarState extends Record<string, unknown> {
  readonly layout: EditorLayoutMode;
  /**
   * Where the draft stands: `idle` (changes not in a version), `checking`, `saving`, `saved`,
   * `error`, or `unavailable` without versions.
   */
  readonly save: string;
}

/**
 * The status bar. With a docked chat beside the work pane its two halves line up with the
 * panes: the checks and the draft under the chat, the version status under the work pane.
 */
export function StatusBar({
  saveVersionOffered = true,
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
  const versioned = useEditorStore((state) => state.versionsCapability?.status === "ready");
  const status = useEditorStore(useShallow(saveStatus));
  const writing = useEditorStore((state) => state.pendingAuthoredSource !== null);
  const [open, setOpen] = useState(false);

  const checksStatus = describeChecks(checks);
  const summary = checksStatus.text;
  const narrow = layoutMode === "narrow";
  const split = docked && layoutMode === "wide" && !chatCollapsed;
  // Only the email workspace has a work pane, and so a Checks tab, beside a docked assistant.
  const checksTab = docked && (doc === null || doc.channel === "email");
  const saveState = saveStateOf(status, versioned);

  // A static guest headline ("Draft saved") would otherwise read as saved while a persist is
  // still queued, blocked, or has failed. The live save note wins whenever it says anything
  // active — including storage/session failures and foreign-change conflicts, which the banners
  // also surface.
  const guestSaveNote =
    status.kind === "failed"
      ? "Couldn't save version"
      : writing || status.kind === "saving"
        ? "Saving…"
        : undefined;

  const indicator = (
    <>
      <span
        data-slot="editor-status-bar-dot"
        data-tone={checksStatus.tone}
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          checksStatus.tone === "error"
            ? "bg-status-error"
            : checksStatus.tone === "warning"
              ? "bg-status-warning"
              : "bg-muted-foreground",
        )}
      />
      {guestHeadline === undefined && !narrow ? (
        <span data-testid="statusbar.checks-summary">
          {checksStatus.parts.length === 0
            ? checksStatus.text
            : checksStatus.parts.map((piece, index) => (
                <span key={piece.severity}>
                  {index > 0 && " · "}
                  <span className={cn(piece.severity === "error" && "text-status-error")}>
                    {piece.text}
                  </span>
                </span>
              ))}
        </span>
      ) : null}
    </>
  );

  return usePart<StatusBarState>(
    "editor-status-bar",
    { ...part },
    {
      state: { layout: layoutMode, save: saveState },
      tag: "footer",
      className:
        "border-border bg-background text-muted-foreground z-30 flex h-8 shrink-0 items-stretch border-t text-xs whitespace-nowrap",
      props: {
        children: (
          <>
            <div
              data-slot="editor-status-bar-start"
              // The half lines up with the chat but never narrower than its own text.
              style={split ? { minWidth: assistantWidth } : undefined}
              className={cn("flex shrink-0 items-center gap-3 px-2", split && "pr-3")}
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
              {guestHeadline !== undefined && (
                <span data-testid="statusbar.guest" className="min-w-0 truncate">
                  {guestSaveNote ?? guestHeadline}
                </span>
              )}
            </div>
            {!split && <Separator orientation="vertical" className="my-2.5" />}
            <div
              data-slot="editor-status-bar-end"
              className="flex min-w-0 flex-1 items-center gap-1 px-2"
            >
              {guestHeadline === undefined ? (
                <SaveStatusLine
                  status={status}
                  versioned={versioned}
                  state={saveState}
                  compact={narrow}
                />
              ) : (
                <span
                  className="sr-only"
                  aria-live="polite"
                  data-testid="statusbar.save-version"
                  data-save-version-state={saveState}
                >
                  {guestSaveNote ??
                    (saveVersionOffered && versioned ? statusText(status, true) : undefined) ??
                    guestHeadline}
                </span>
              )}
              {saveVersionOffered && <SaveStatusActions status={status} versioned={versioned} />}
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

/** The status as `data-save-version-state` names it; unsaved changes are `idle`. */
const saveStateOf = (status: SaveStatus, versioned: boolean): string => {
  if (!versioned) return status.kind === "failed" ? "error" : "unavailable";
  switch (status.kind) {
    case "loading":
    case "checking":
      return "checking";
    case "unsaved":
      return "idle";
    case "failed":
      return "error";
    default:
      return status.kind;
  }
};

const changeCount = (changes: number | null, compact: boolean): string => {
  const counted = changes !== null && changes > 0;
  const noun = `${changes} ${changes === 1 ? "change" : "changes"}`;
  if (compact) return counted ? noun : "Unsaved changes";
  return counted ? `${noun} not in a version yet` : "Changes not in a version yet";
};

/**
 * The one sentence the status bar says about saving. `compact` is the phone's shorter form; the
 * full sentence stays the status's accessible name.
 */
const statusText = (
  status: SaveStatus,
  versioned: boolean,
  compact = false,
): string | undefined => {
  switch (status.kind) {
    case "loading":
    case "checking":
      return undefined;
    case "unsaved":
      return changeCount(status.changes, compact);
    case "saving":
      return versioned && !compact ? "Saving version…" : "Saving…";
    case "saved":
      if (!versioned) return "Saved";
      return status.number === undefined
        ? "Saved as a version"
        : `Saved as version ${status.number}`;
    case "failed":
      return compact ? "Couldn't save" : `Couldn't save: ${status.reason}`;
  }
};

/**
 * The save status. With versions, the draft's own autosave is quiet: it sits in the tooltip, and
 * shows here only when a write fails.
 */
function SaveStatusLine({
  status,
  versioned,
  state,
  compact,
}: {
  readonly status: SaveStatus;
  readonly versioned: boolean;
  readonly state: string;
  readonly compact: boolean;
}) {
  const text = statusText(status, versioned);
  const shown = compact ? statusText(status, versioned, true) : text;
  const line = (
    <span
      aria-live="polite"
      aria-label={shown === text ? undefined : text}
      title={shown === text ? undefined : text}
      data-testid="statusbar.save-version"
      data-save-version-state={state}
      tabIndex={versioned && text !== undefined ? 0 : undefined}
      className={cn("min-w-0 truncate px-1", status.kind === "failed" && "text-status-error")}
    >
      {shown}
    </span>
  );
  // One tree whatever the status says, so the status element stays the same node.
  return (
    <Tip label={<DraftNote />} disabled={!versioned || text === undefined}>
      {line}
    </Tip>
  );
}

/** The draft's own save, for the status tooltip: "Draft saved 2 min ago", "Saving draft…". */
function DraftNote() {
  const { savedAt, saving } = useEditorStore(
    useShallow((state) => ({
      savedAt: state.draftSavedAt,
      saving: state.pendingAuthoredSource !== null,
    })),
  );
  const now = useNow(savedAt !== null);
  if (saving) return <span data-testid="statusbar.draft">Saving draft…</span>;
  return (
    <span data-testid="statusbar.draft">
      {savedAt === null
        ? "Changes are kept in your draft as you go"
        : `Draft saved ${relativeAgo(now, savedAt)}`}
    </span>
  );
}

/** Save version, Retry or Reload for the status, and the menu that discards changes. */
function SaveStatusActions({
  status,
  versioned,
}: {
  readonly status: SaveStatus;
  readonly versioned: boolean;
}) {
  const { saveVersion, retrySave, reload } = useEditorStore((state) => state.actions);
  const blocked = useEditorStore((state) => state.lifecycleBusy);
  const save = () => void saveVersion().catch(() => {});
  if (status.kind === "failed") {
    const retry = status.retry === "version" ? save : status.retry === "draft" ? retrySave : reload;
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={retry}
        disabled={blocked && status.retry !== "reload"}
        data-testid={status.retry === "version" ? "topbar.save-version" : "statusbar.retry"}
        data-editor-control=""
        className="text-foreground"
      >
        {status.retry === "reload" ? "Reload" : "Retry"}
      </Button>
    );
  }
  if (!versioned || (status.kind !== "unsaved" && status.kind !== "saving")) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={save}
        disabled={status.kind === "saving" || blocked}
        data-testid="topbar.save-version"
        data-editor-control=""
        aria-label="Save the current draft as a version"
        title="Save this draft as a version (⌘/Ctrl+S)"
        className="text-foreground"
      >
        Save version
      </Button>
      {status.kind === "unsaved" && <DiscardChanges changes={status.changes} />}
    </>
  );
}

/**
 * "Discard changes" behind a menu beside the status, after a confirm. Offered only where it can
 * work: the host restores its saved version, or this session saved the one to go back to.
 */
function DiscardChanges({ changes }: { readonly changes: number | null }) {
  const { offered, number } = useEditorStore(
    useShallow((state) => ({
      offered:
        state.sourceEditable &&
        (state.lifecycleCapability?.status === "ready" || state.version.saved !== null),
      number: state.version.saved?.number,
    })),
  );
  const { discardChanges } = useEditorStore((state) => state.actions);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!offered) return null;
  const what =
    changes === null || changes === 0
      ? "your changes"
      : `${changes} ${changes === 1 ? "change" : "changes"}`;
  const back = number === undefined ? "the last saved version" : `version ${number}`;
  const discard = () => {
    setDiscarding(true);
    setError(null);
    discardChanges()
      .then(() => setConfirming(false))
      .catch((cause: unknown) => setError(reasonOf(cause, "The changes could not be discarded.")))
      .finally(() => setDiscarding(false));
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="More version actions"
              data-testid="statusbar.version-menu"
              data-editor-control=""
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-48">
          <DropdownMenuItem
            variant="destructive"
            data-testid="statusbar.discard"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Discard changes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && !discarding) setConfirming(false);
        }}
      >
        <AlertDialogContent data-testid="statusbar.discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{`Discard ${what}?`}</AlertDialogTitle>
            <AlertDialogDescription>{`The draft goes back to ${back}.`}</AlertDialogDescription>
            {error !== null && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="statusbar.discard-cancel"
              data-editor-control=""
              disabled={discarding}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              data-testid="statusbar.discard-confirm"
              data-editor-control=""
              disabled={discarding}
              onClick={discard}
            >
              {discarding ? "Discarding…" : "Discard"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The clock, refreshed every 30 seconds while `active` so relative times stay current. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
