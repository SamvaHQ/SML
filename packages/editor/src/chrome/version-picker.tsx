import type { ProjectCommit, ProjectLifecycleState } from "@samva/editor/host";
import { Predicate } from "effect";
import { useRef, useState } from "react";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
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
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Check, ChevronDown, Clock, Search } from "./editor-icons";
import { Tip } from "./ui";
import { revealOnRowHover } from "./ui-classes";

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

const rowButtonClass =
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground relative flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-none select-none";

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
      <button
        type="button"
        data-testid={testId}
        data-editor-control=""
        onClick={onSelect}
        className={rowButtonClass}
      >
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
  const lifecycleCapability = useEditorStore((state) => state.lifecycleCapability);
  const loadedDocument = useEditorStore((state) => state.doc !== null);
  // A read-only template can list its versions but not take one back.
  const editable = useEditorStore((state) => state.editable);
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
    if (pending === null || pending.blocked || restoring || !editable) return;
    if (!beginLifecycle()) return;
    setRestoring(true);
    setRestoreError(null);
    // The draft may have moved while the confirmation was open (an assistant turn, a save
    // elsewhere). Check again under the lifecycle lock, so a restore never replaces changes that
    // are not in a saved version.
    void flushSaves()
      .then(async (baseRev) => {
        const current = await api.inspect();
        if (current.dirty || current.conflicts.length > 0) {
          setLoad({ status: "ready", state: current });
          setPending({ ...pending, blocked: true });
          return;
        }
        adoptLifecycleSnapshot(await api.restore({ commit: pending.commit, baseRev }));
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
      <Popover open={open} onOpenChange={changeOpen}>
        <Tip label="Versions">
          <PopoverTrigger
            data-slot="editor-version-picker"
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Versions"
                data-testid="preview-bar.versions"
                data-editor-control=""
                disabled={restoring}
                className="text-muted-foreground shrink-0 gap-1 px-2"
              />
            }
          >
            {restoring ? (
              "Restoring…"
            ) : (
              <>
                <span className="inline-flex items-center gap-1 @max-[28rem]/preview-bar:hidden">
                  Latest
                  <ChevronDown />
                </span>
                <Clock className="hidden size-3.5 @max-[28rem]/preview-bar:inline-flex" />
              </>
            )}
          </PopoverTrigger>
        </Tip>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          data-testid="preview-bar.versions-popup"
          className="w-72 gap-0 p-1"
        >
          <label className="border-border flex items-center gap-2 border-b px-2 pb-1.5">
            <Search className="text-muted-foreground size-3.5 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search versions"
              aria-label="Search versions"
              data-testid="preview-bar.versions-search"
              data-editor-control=""
              className="placeholder:text-muted-foreground h-7 w-full min-w-0 bg-transparent text-sm outline-none"
            />
          </label>
          <div className="samva-editor-scroll max-h-72 overflow-y-auto pt-1">
            {load.status === "loading" ? <MutedRow>Loading versions…</MutedRow> : null}
            {load.status === "failed" ? (
              <div className="flex flex-col items-start gap-2 px-1.5 py-2">
                <p role="alert" className="text-destructive text-sm">
                  {load.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="preview-bar.versions-retry"
                  data-editor-control=""
                  onClick={loadVersions}
                >
                  Try again
                </Button>
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
        </PopoverContent>
      </Popover>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !restoring) setPending(null);
        }}
      >
        <AlertDialogContent data-testid="preview-bar.restore-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              {`“${pending?.message ?? ""}” replaces the draft. Newer versions stay in the list, so you can restore them again.`}
            </AlertDialogDescription>
            {!editable ? (
              <AlertDialogDescription data-testid="preview-bar.restore-readonly">
                This template is read-only, so its versions can be viewed but not restored.
              </AlertDialogDescription>
            ) : null}
            {editable && pending?.blocked ? (
              <AlertDialogDescription>
                Save a version first, so your unsaved changes stay in the list.
              </AlertDialogDescription>
            ) : null}
            {restoreError !== null ? (
              <p role="alert" className="text-destructive text-sm">
                {restoreError}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="preview-bar.restore-cancel"
              data-editor-control=""
              disabled={restoring}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              data-testid="preview-bar.restore-confirm"
              data-editor-control=""
              disabled={restoring || !editable || pending?.blocked === true}
              onClick={restore}
            >
              {restoring ? "Restoring…" : "Restore"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
