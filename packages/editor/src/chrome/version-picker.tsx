import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Popover } from "@base-ui/react/popover";
import type { ProjectCommit, ProjectLifecycleState } from "@samva/editor/host";
import { Predicate } from "effect";
import { useRef, useState } from "react";

import { useEditorStore } from "../state/context";
import { Check, ChevronDown, Clock, Search } from "./editor-icons";
import { Tip } from "./ui";
import {
  chromePrimary,
  cn,
  focusRing,
  menuItemClass,
  popoverPopupClass,
  revealOnRowHover,
  softRaised,
  toolbarButton,
} from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

type VersionsLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly state: ProjectLifecycleState };

/** The version the author asked to restore, with whether the draft currently allows it. */
interface PendingRestore {
  readonly commit: string;
  readonly message: string;
  readonly blocked: boolean;
}

const errorMessage = (cause: unknown): string =>
  Predicate.hasProperty(cause, "reason") && typeof cause.reason === "string"
    ? cause.reason
    : cause instanceof Error
      ? cause.message
      : String(cause);

const formatDate = (date: Date): string =>
  date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const rowButtonClass = cn(
  menuItemClass,
  "w-full cursor-pointer text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
);

const MutedRow = ({
  children,
  testId,
}: {
  readonly children: string;
  readonly testId?: string | undefined;
}) => (
  <p data-testid={testId} className="text-muted-foreground px-1.5 py-2 text-[12.5px]">
    {children}
  </p>
);

function VersionRow({
  testId,
  title,
  detail,
  marked,
  hint,
  onSelect,
}: {
  readonly testId: string;
  readonly title: string;
  readonly detail: string;
  readonly marked: boolean;
  readonly hint: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <div className="group/row relative">
      <button type="button" data-testid={testId} onClick={onSelect} className={rowButtonClass}>
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {marked ? <Check className="size-3.5" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="w-full truncate text-[13px]">{title}</span>
          <span className="text-muted-foreground w-full truncate text-[11.5px]">{detail}</span>
        </span>
        {hint ? (
          <span
            aria-hidden
            className={cn(
              "text-muted-foreground pointer-events-none shrink-0 text-[11.5px]",
              revealOnRowHover,
            )}
          >
            Restore
          </span>
        ) : null}
      </button>
    </div>
  );
}

/**
 * The version picker at the left of the preview bar. It lists the draft on screen ("Latest") and
 * the saved versions behind it, and restores an older one only after the author confirms.
 */
export function VersionPicker() {
  const portalContainer = useEditorPortalContainer();
  const lifecycleCapability = useEditorStore((state) => state.lifecycleCapability);
  const loadedDocument = useEditorStore((state) => state.doc !== null);
  const { beginLifecycle, endLifecycle, flushSaves, adoptLifecycleSnapshot } = useEditorStore(
    (state) => state.actions,
  );
  const [open, setOpen] = useState(false);
  const latestRequest = useRef(0);
  const [load, setLoad] = useState<VersionsLoad>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const api = lifecycleCapability?.status === "ready" ? lifecycleCapability.api : null;

  if (api === null || !loadedDocument) return null;

  const snapshot = load.status === "ready" ? load.state : null;
  const dirty = snapshot?.dirty ?? false;

  /** Loads the versions; a newer request or a closed popup supersedes an older answer. */
  const loadVersions = () => {
    const request = ++latestRequest.current;
    setLoad({ status: "loading" });
    void flushSaves()
      .then(() => api.inspect())
      .then((state) => {
        if (latestRequest.current === request) setLoad({ status: "ready", state });
      })
      .catch((cause: unknown) => {
        if (latestRequest.current === request) {
          setLoad({ status: "failed", message: errorMessage(cause) });
        }
      });
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      loadVersions();
    } else {
      latestRequest.current++;
    }
  };

  const select = (commit: ProjectCommit) => {
    setOpen(false);
    if (snapshot === null) return;
    if (commit.commit === snapshot.baseCommit && !snapshot.dirty) return;
    setRestoreError(null);
    setPending({
      commit: commit.commit,
      message: commit.message,
      blocked: snapshot.dirty || snapshot.conflicts.length > 0,
    });
  };

  const restore = () => {
    if (pending === null || pending.blocked || restoring) return;
    if (!beginLifecycle()) return;
    setRestoring(true);
    setRestoreError(null);
    void flushSaves()
      .then((baseRev) => api.restore({ commit: pending.commit, baseRev }))
      .then((result) => {
        adoptLifecycleSnapshot(result);
        setPending(null);
      })
      .catch((cause: unknown) => setRestoreError(errorMessage(cause)))
      .finally(() => {
        endLifecycle();
        setRestoring(false);
      });
  };

  const needle = query.trim().toLowerCase();
  const commits = snapshot?.commits.filter(({ message }) => message.toLowerCase().includes(needle));
  const showLatest = needle === "" || "latest".includes(needle);

  return (
    <>
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Tip label="Versions">
          <Popover.Trigger
            aria-label="Versions"
            data-testid="preview-bar.versions"
            disabled={restoring}
            className={cn(toolbarButton, "gap-1 rounded-md px-2")}
          >
            {restoring ? (
              "Restoring…"
            ) : (
              <>
                <span className="inline-flex items-center gap-1 @max-[28rem]/preview-bar:hidden">
                  Latest
                  <ChevronDown className="size-3.5" />
                </span>
                <Clock className="hidden size-3.5 @max-[28rem]/preview-bar:inline-flex" />
              </>
            )}
          </Popover.Trigger>
        </Tip>
        <Popover.Portal container={portalContainer}>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[120]">
            <Popover.Popup
              data-testid="preview-bar.versions-popup"
              className={cn(popoverPopupClass, "w-72 p-1")}
            >
              <label className="border-border flex items-center gap-2 border-b px-1.5 pb-1.5">
                <Search className="text-muted-foreground size-3.5 shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search versions"
                  aria-label="Search versions"
                  data-testid="preview-bar.versions-search"
                  className="placeholder:text-muted-foreground h-6 w-full min-w-0 bg-transparent text-[13px] outline-none"
                />
              </label>
              <div className="samva-editor-scroll max-h-72 overflow-y-auto pt-1">
                {load.status === "loading" ? <MutedRow>Loading versions…</MutedRow> : null}
                {load.status === "failed" ? (
                  <div className="flex flex-col items-start gap-2 px-1.5 py-2">
                    <p role="alert" className="text-destructive text-[12.5px]">
                      {load.message}
                    </p>
                    <button
                      type="button"
                      data-testid="preview-bar.versions-retry"
                      onClick={loadVersions}
                      className={cn(
                        softRaised,
                        "h-7 rounded-md px-2.5 text-xs font-medium",
                        focusRing,
                      )}
                    >
                      Try again
                    </button>
                  </div>
                ) : null}
                {snapshot !== null && commits !== undefined ? (
                  <>
                    {showLatest ? (
                      <VersionRow
                        testId="preview-bar.version-latest"
                        title="Latest"
                        detail={dirty ? "Unsaved changes" : "Saved"}
                        marked
                        hint={false}
                        onSelect={() => setOpen(false)}
                      />
                    ) : null}
                    {commits.map((commit) => {
                      const isBase = commit.commit === snapshot.baseCommit;
                      const detail = [
                        isBase ? "Current" : null,
                        formatDate(commit.committedAt),
                        commit.isPublished ? "Published" : null,
                      ]
                        .filter((part) => part !== null)
                        .join(" · ");
                      return (
                        <VersionRow
                          key={commit.commit}
                          testId={`preview-bar.version.${commit.commit}`}
                          title={commit.message}
                          detail={detail}
                          marked={false}
                          hint={!(isBase && !snapshot.dirty)}
                          onSelect={() => select(commit)}
                        />
                      );
                    })}
                    {!showLatest && commits.length === 0 ? (
                      <MutedRow testId="preview-bar.versions-empty">No versions match</MutedRow>
                    ) : null}
                  </>
                ) : null}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <AlertDialog.Root
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !restoring) setPending(null);
        }}
      >
        <AlertDialog.Portal container={portalContainer}>
          <AlertDialog.Backdrop className="fixed inset-0 z-[110] bg-[var(--editor-backdrop,rgb(0_0_0/0.28))]" />
          <AlertDialog.Popup
            data-testid="preview-bar.restore-dialog"
            className="border-border bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-[111] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-[var(--shadow-floating)]"
          >
            <AlertDialog.Title className="text-[15px] font-semibold">
              Restore this version?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-muted-foreground mt-2 text-[13px]">
              {`“${pending?.message ?? ""}” replaces the draft. Newer versions stay in the list, so you can restore them again.`}
            </AlertDialog.Description>
            {pending?.blocked ? (
              <p className="text-muted-foreground mt-2 text-[13px]">
                Save a version first, so your unsaved changes stay in the list.
              </p>
            ) : null}
            {restoreError !== null ? (
              <p role="alert" className="text-destructive mt-2 text-[13px]">
                {restoreError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <AlertDialog.Close
                data-testid="preview-bar.restore-cancel"
                disabled={restoring}
                className={cn(softRaised, "h-8 rounded-md px-3 text-[13px] font-medium", focusRing)}
              >
                Cancel
              </AlertDialog.Close>
              <button
                type="button"
                data-testid="preview-bar.restore-confirm"
                disabled={restoring || pending?.blocked === true}
                onClick={restore}
                className={cn(chromePrimary, "h-8 px-3 text-[13px]")}
              >
                {restoring ? "Restoring…" : "Restore"}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
