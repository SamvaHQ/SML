import { Dialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import type {
  ProjectCommit,
  ProjectConflict,
  ProjectFile,
  ProjectLifecycleState,
} from "@samva/editor/host";
import { Predicate } from "effect";
import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../state/context";
import { cn, focusRing } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

export const CONFIRM_PUBLISH_LABEL = "Publish saved version";

/** The picker offers the images and fonts a template project stores as files. */
const ADD_FILE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,.woff2";
/** The largest file the project stores, checked here so an oversized pick fails before upload. */
const MAX_PROJECT_FILE_BYTES = 1024 * 1024;

/** New files land in an `assets` folder beside the template entry. */
const addedFilePath = (entryPath: string | undefined, name: string): string => {
  const slash = entryPath?.lastIndexOf("/") ?? -1;
  const directory = entryPath === undefined || slash < 0 ? "" : entryPath.slice(0, slash + 1);
  return `${directory}assets/${name}`;
};

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(dot) : "";
};

const isFileExists = (error: unknown): boolean =>
  Predicate.hasProperty(error, "_tag") && error._tag === "ProjectFileExists";

const errorMessage = (error: unknown): string =>
  Predicate.hasProperty(error, "reason") && typeof error.reason === "string"
    ? error.reason
    : "The template project operation failed.";

const commitLabel = (commit: ProjectCommit): string =>
  commit.isPublished ? "Published" : commit.isHead ? "Current saved version" : "Saved version";

function ProjectFileEditor({
  file,
  content,
  busy,
  onChange,
  onApply,
  onReplace,
}: {
  readonly file: ProjectFile;
  readonly content: string;
  readonly busy: boolean;
  readonly onChange: (content: string) => void;
  readonly onApply: (content: string) => void;
  readonly onReplace: () => void;
}) {
  const conflicted = file.status === "conflicted";
  return (
    <div className="border-border space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="truncate font-mono text-xs font-semibold">{file.path}</h4>
        <span className="text-muted-foreground shrink-0 text-xs">{file.status}</span>
      </div>
      {file.binary === true ? (
        <div className="space-y-3" data-testid="lifecycle-sheet.binary-file">
          {file.status === "deleted" ? (
            <p className="text-muted-foreground text-xs">
              Removed from the draft. Save a version to keep this change.
            </p>
          ) : (
            <>
              {(file.status === "added" || file.status === "modified") && (
                <p className="text-muted-foreground text-xs">Unsaved until you save a version.</p>
              )}
              <button
                type="button"
                disabled={busy}
                data-testid="lifecycle-sheet.replace-file"
                onClick={onReplace}
                className={cn(
                  "border-border hover:bg-muted rounded-md border px-3 py-2 text-xs disabled:opacity-50",
                  focusRing,
                )}
              >
                Replace file
              </button>
            </>
          )}
        </div>
      ) : conflicted ? (
        <p className="text-muted-foreground text-xs">
          Resolve this file below before editing its workspace source.
        </p>
      ) : (
        <>
          <textarea
            aria-label={`Project source for ${file.path}`}
            data-testid={`lifecycle-sheet.file-source.${file.path}`}
            value={content}
            onChange={(event) => onChange(event.target.value)}
            disabled={busy}
            spellCheck={false}
            className="border-border bg-surface-inset text-foreground min-h-52 w-full resize-y rounded-md border p-3 font-mono text-xs outline-none disabled:opacity-60"
          />
          <button
            type="button"
            disabled={busy || content === file.content}
            data-testid={`lifecycle-sheet.apply-file.${file.path}`}
            onClick={() => onApply(content)}
            className={cn(
              "bg-primary text-primary-foreground rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50",
              focusRing,
            )}
          >
            Apply file
          </button>
        </>
      )}
    </div>
  );
}

function ConflictCard({
  conflict,
  busy,
  onResolve,
}: {
  readonly conflict: ProjectConflict;
  readonly busy: boolean;
  readonly onResolve: (resolution: "draft" | "main" | { readonly content: string }) => void;
}) {
  const [content, setContent] = useState(conflict.draft ?? conflict.main ?? "");
  return (
    <article className="border-status-warning/45 space-y-3 rounded-lg border p-4">
      <h4 className="font-mono text-xs font-semibold">{conflict.path}</h4>
      <details className="border-border rounded-md border">
        <summary className="hover:bg-muted cursor-pointer px-3 py-2 text-xs font-medium">
          Compare base, draft, and main
        </summary>
        <div className="divide-border border-border divide-y border-t">
          {(
            [
              ["Base", conflict.base],
              ["Draft", conflict.draft],
              ["Latest saved version", conflict.main],
            ] as const
          ).map(([label, source]) => (
            <div key={label} className="space-y-1 p-3">
              <p className="text-muted-foreground text-[11px] font-medium">{label}</p>
              <pre className="samva-editor-scroll max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap">
                {source ?? "File does not exist"}
              </pre>
            </div>
          ))}
        </div>
      </details>
      <textarea
        aria-label={`Resolved source for ${conflict.path}`}
        data-testid={`lifecycle-sheet.conflict-source.${conflict.path}`}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
        className="border-border bg-surface-inset text-foreground min-h-40 w-full resize-y rounded-md border p-3 font-mono text-xs outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve("draft")}
          data-testid="lifecycle-sheet.keep-draft"
          className={cn(
            "border-border hover:bg-muted rounded-md border px-3 py-2 text-xs",
            focusRing,
          )}
        >
          Keep draft
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve("main")}
          className={cn(
            "border-border hover:bg-muted rounded-md border px-3 py-2 text-xs",
            focusRing,
          )}
        >
          Use saved version
        </button>
        <button
          type="button"
          disabled={busy}
          data-testid={`lifecycle-sheet.resolve-edited.${conflict.path}`}
          onClick={() => onResolve({ content })}
          className={cn(
            "bg-primary text-primary-foreground rounded-md px-3 py-2 text-xs font-medium",
            focusRing,
          )}
        >
          Use edited source
        </button>
      </div>
    </article>
  );
}

export function LifecycleSheet({
  open,
  onClose,
  onLockedAction,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onLockedAction?: (() => void) | undefined;
}) {
  if (!open) return null;
  return <OpenLifecycleSheet onClose={onClose} onLockedAction={onLockedAction} />;
}

function OpenLifecycleSheet({
  onClose,
  onLockedAction,
}: {
  readonly onClose: () => void;
  readonly onLockedAction?: (() => void) | undefined;
}) {
  const portalContainer = useEditorPortalContainer();
  const doc = useEditorStore((state) => state.doc);
  const lifecycleCapability = useEditorStore((state) => state.lifecycleCapability);
  const { beginLifecycle, endLifecycle, flushSaves, adoptLifecycleSnapshot } = useEditorStore(
    (state) => state.actions,
  );
  const ready = doc !== null && lifecycleCapability?.status === "ready";
  const [loaded, setLoaded] = useState<ProjectLifecycleState | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileDrafts, setFileDrafts] = useState<
    Readonly<Record<string, { readonly baseContent: string; readonly content: string }>>
  >({});
  const [busy, setBusy] = useState<"loading" | "publish" | "restore" | "resolve" | "file" | null>(
    () => (ready ? "loading" : null),
  );
  const filePicker = useRef<HTMLInputElement>(null);
  /** Where the next picked file goes: a new path beside the entry, or over an existing file. */
  const pickTarget = useRef<{ readonly replacePath: string } | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{
    readonly path: string;
    readonly bytes: Uint8Array;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [lastReady, setLastReady] = useState(ready);
  if (ready !== lastReady) {
    setLastReady(ready);
    if (ready) {
      setBusy("loading");
      setLoaded(null);
      setError(null);
      setNotice(null);
      setSelectedCommit(null);
      setSelectedFilePath(null);
      setFileDrafts({});
      setPendingReplace(null);
    }
  }

  useEffect(() => {
    if (lifecycleCapability?.status !== "ready") return;
    let cancelled = false;
    void flushSaves()
      .then(() => lifecycleCapability.api.inspect())
      .then((state) => {
        if (cancelled) return;
        setLoaded(state);
        const entryPath = doc?.origin.kind === "tsx" ? doc.origin.file : undefined;
        setSelectedFilePath((currentPath) =>
          currentPath !== null && state.files.some(({ path }) => path === currentPath)
            ? currentPath
            : entryPath !== undefined && state.files.some(({ path }) => path === entryPath)
              ? entryPath
              : (state.files[0]?.path ?? null),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, flushSaves, lifecycleCapability]);

  if (lifecycleCapability === undefined) return null;
  if (lifecycleCapability.status === "locked") {
    return (
      <Dialog.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <Dialog.Portal container={portalContainer}>
          <Dialog.Backdrop className="fixed inset-0 z-[110] bg-[var(--editor-backdrop,rgb(0_0_0/0.28))]" />
          <Dialog.Viewport className="fixed inset-0 z-[111] grid place-items-center p-4">
            <Dialog.Popup className="border-border bg-popover w-full max-w-lg rounded-xl border p-5 shadow-[var(--shadow-floating)]">
              <Dialog.Title className="text-base font-semibold">
                Publishing is unavailable
              </Dialog.Title>
              <Dialog.Description
                className="text-muted-foreground mt-2 text-sm"
                data-testid="lifecycle-sheet.locked-reason"
              >
                {lifecycleCapability.upsell.reason}
              </Dialog.Description>
              <a
                data-testid="lifecycle-sheet.upsell-cta"
                className={cn(
                  "bg-primary text-primary-foreground mt-4 inline-flex rounded-md px-3 py-2 text-sm font-medium",
                  focusRing,
                )}
                href={lifecycleCapability.upsell.cta.href}
                onClick={(event) => {
                  if (onLockedAction === undefined) return;
                  event.preventDefault();
                  onLockedAction();
                }}
              >
                {lifecycleCapability.upsell.cta.label}
              </a>
              <Dialog.Close
                className={cn(
                  "border-border hover:bg-muted mt-4 ml-2 inline-flex rounded-md border px-3 py-2 text-sm font-medium",
                  focusRing,
                )}
              >
                Close
              </Dialog.Close>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const selected = loaded?.commits.find(({ commit }) => commit === selectedCommit);
  const selectedFile = loaded?.files.find(({ path }) => path === selectedFilePath);
  const selectedFileSource = selectedFile?.content ?? "";
  const selectedFileDraft = selectedFile === undefined ? undefined : fileDrafts[selectedFile.path];
  const selectedFileContent =
    selectedFileDraft?.baseContent === selectedFileSource
      ? selectedFileDraft.content
      : selectedFileSource;
  const fileDraftDirty =
    loaded?.files.some((file) => {
      const draft = fileDrafts[file.path];
      const source = file.content ?? "";
      return draft?.baseContent === source && draft.content !== source;
    }) ?? false;
  const clean =
    loaded !== null && !loaded.dirty && loaded.conflicts.length === 0 && !fileDraftDirty;
  const current = loaded?.commits.find(({ commit }) => commit === loaded.baseCommit);
  const publishable = clean && loaded?.baseCommit === loaded.remoteHead;
  const refresh = async () => setLoaded(await lifecycleCapability.api.inspect());

  const publish = () => {
    if (loaded === null || !publishable || busy !== null) return;
    if (!beginLifecycle()) return;
    setBusy("publish");
    setError(null);
    void lifecycleCapability.api
      .publish({ baseRev: loaded.rev, commit: loaded.baseCommit })
      .then(async () => {
        await refresh();
        setNotice("Published the current saved version.");
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => {
        endLifecycle();
        setBusy(null);
      });
  };

  const restore = () => {
    if (loaded === null || selected === undefined || selected.isHead || !clean || busy !== null)
      return;
    if (!beginLifecycle()) return;
    setBusy("restore");
    setError(null);
    void flushSaves()
      .then((baseRev) => lifecycleCapability.api.restore({ commit: selected.commit, baseRev }))
      .then(async (result) => {
        adoptLifecycleSnapshot(result);
        await refresh();
        setSelectedCommit(null);
        setNotice("Restored the saved version to the draft. Save a version to keep this restore.");
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => {
        endLifecycle();
        setBusy(null);
      });
  };

  const resolveConflict = (
    conflict: ProjectConflict,
    resolution: "draft" | "main" | { readonly content: string },
  ) => {
    if (loaded === null || busy !== null) return;
    if (!beginLifecycle()) return;
    setBusy("resolve");
    setError(null);
    void flushSaves()
      .then((baseRev) =>
        lifecycleCapability.api.resolveConflict({ path: conflict.path, baseRev, resolution }),
      )
      .then((state) => {
        setLoaded(state);
        setNotice(`Resolved ${conflict.path}.`);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => {
        endLifecycle();
        setBusy(null);
      });
  };

  const updateFile = (file: ProjectFile, content: string) => {
    if (loaded === null || busy !== null) return;
    setBusy("file");
    setError(null);
    void lifecycleCapability.api
      .updateFile({ path: file.path, baseRev: loaded.rev, content })
      .then((state) => {
        setLoaded(state);
        setFileDrafts((drafts) => {
          const { [file.path]: _applied, ...remaining } = drafts;
          return remaining;
        });
        setNotice(`Updated ${file.path}.`);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(null));
  };

  const putAsset = (path: string, bytes: Uint8Array, replace: boolean) => {
    if (loaded === null || busy !== null) return;
    setBusy("file");
    setError(null);
    setNotice(null);
    setPendingReplace(null);
    void lifecycleCapability.api
      .putAsset({ path, baseRev: loaded.rev, bytes, replace })
      .then((state) => {
        setLoaded(state);
        setSelectedFilePath(path);
        setNotice(`${replace ? "Replaced" : "Added"} ${path}. Save a version to keep this change.`);
      })
      .catch((cause: unknown) => {
        if (isFileExists(cause)) setPendingReplace({ path, bytes });
        else setError(errorMessage(cause));
      })
      .finally(() => setBusy(null));
  };

  const pickFile = (replacePath: string | null) => {
    const input = filePicker.current;
    if (input === null) return;
    pickTarget.current = replacePath === null ? null : { replacePath };
    input.accept = replacePath === null ? ADD_FILE_ACCEPT : extensionOf(replacePath);
    input.value = "";
    input.click();
  };

  const onFilePicked = (file: File | undefined) => {
    const target = pickTarget.current;
    pickTarget.current = null;
    if (file === undefined || loaded === null) return;
    if (file.size > MAX_PROJECT_FILE_BYTES) {
      setNotice(null);
      setError(`${file.name} is larger than 1 MB. Choose a smaller file.`);
      return;
    }
    const entryPath = doc?.origin.kind === "tsx" ? doc.origin.file : undefined;
    const path = target?.replacePath ?? addedFilePath(entryPath, file.name);
    void file
      .arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        if (target === null && loaded.files.some((existing) => existing.path === path)) {
          setError(null);
          setNotice(null);
          setPendingReplace({ path, bytes });
          return;
        }
        putAsset(path, bytes, target !== null);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  return (
    <Drawer.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()} swipeDirection="right">
      <Drawer.Portal container={portalContainer}>
        <Drawer.Backdrop className="fixed inset-0 z-[110] bg-[var(--editor-backdrop,rgb(0_0_0/0.28))]" />
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-[111] flex justify-end">
          <Drawer.Popup className="border-border bg-popover pointer-events-auto flex h-full w-full max-w-2xl flex-col border-l shadow-[var(--shadow-floating)]">
            <header className="border-border flex items-center justify-between border-b px-5 py-4">
              <div>
                <Drawer.Title className="text-base font-semibold">
                  Publish and saved versions
                </Drawer.Title>
                <Drawer.Description className="text-muted-foreground mt-0.5 text-xs">
                  Save keeps a named version. Restore brings an older version into your draft.
                </Drawer.Description>
              </div>
              <Drawer.Close
                data-testid="lifecycle-sheet.close"
                className={cn("hover:bg-muted rounded-md px-2 py-1 text-sm", focusRing)}
              >
                Close
              </Drawer.Close>
            </header>

            <div className="samva-editor-scroll min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
              {busy === "loading" && (
                <p className="text-muted-foreground text-sm">Loading saved versions…</p>
              )}
              {error !== null && (
                <p className="text-status-error text-sm" role="alert">
                  {error}
                </p>
              )}
              {notice !== null && (
                <p
                  className="text-status-success text-sm"
                  role="status"
                  data-testid="lifecycle-sheet.notice"
                >
                  {notice}
                </p>
              )}

              {loaded !== null && (
                <>
                  <section className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Current saved version</h3>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {current?.message ?? "Current saved version"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={publish}
                        disabled={!publishable || busy !== null}
                        data-testid="lifecycle-sheet.confirm-publish"
                        className={cn(
                          "bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50",
                          focusRing,
                        )}
                      >
                        {busy === "publish" ? "Publishing…" : CONFIRM_PUBLISH_LABEL}
                      </button>
                    </div>
                    {!clean && (
                      <p
                        className="text-muted-foreground text-xs"
                        data-testid="lifecycle-sheet.cleanliness-warning"
                      >
                        {loaded.conflicts.length > 0
                          ? "Resolve workspace conflicts before Save or Publish."
                          : "The draft has unsaved changes. Save a version before publishing or restoring."}
                      </p>
                    )}
                    {clean && loaded.baseCommit !== loaded.remoteHead && (
                      <p className="text-muted-foreground text-xs">
                        The saved version changed elsewhere. Refresh before publishing.
                      </p>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Project files</h3>
                      <button
                        type="button"
                        disabled={busy !== null}
                        data-testid="lifecycle-sheet.add-file"
                        onClick={() => pickFile(null)}
                        className={cn(
                          "border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                          focusRing,
                        )}
                      >
                        Add file
                      </button>
                      <input
                        ref={filePicker}
                        type="file"
                        accept={ADD_FILE_ACCEPT}
                        hidden
                        data-testid="lifecycle-sheet.add-file-input"
                        onChange={(event) => onFilePicked(event.target.files?.[0])}
                      />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Add PNG, JPEG, GIF, or WebP images and WOFF2 fonts up to 1 MB.
                    </p>
                    {pendingReplace !== null && (
                      <div
                        className="border-status-warning/45 space-y-3 rounded-lg border p-3"
                        data-testid="lifecycle-sheet.replace-prompt"
                      >
                        <p className="text-xs">
                          <span className="font-mono">{pendingReplace.path}</span> already exists.
                          Replace it with the file you chose?
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy !== null}
                            data-testid="lifecycle-sheet.confirm-replace"
                            onClick={() =>
                              putAsset(pendingReplace.path, pendingReplace.bytes, true)
                            }
                            className={cn(
                              "bg-primary text-primary-foreground rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50",
                              focusRing,
                            )}
                          >
                            Replace file
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setPendingReplace(null)}
                            className={cn(
                              "border-border hover:bg-muted rounded-md border px-3 py-2 text-xs",
                              focusRing,
                            )}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="border-border divide-border divide-y rounded-lg border">
                      {loaded.files.map((file) => (
                        <button
                          type="button"
                          key={file.path}
                          data-testid={`lifecycle-sheet.file.${file.path}`}
                          onClick={() => setSelectedFilePath(file.path)}
                          className={cn(
                            "hover:bg-muted flex w-full items-center justify-between gap-4 px-3 py-2 text-left",
                            focusRing,
                            selectedFilePath === file.path && "bg-muted",
                          )}
                        >
                          <span className="truncate font-mono text-xs">{file.path}</span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {file.status}
                          </span>
                        </button>
                      ))}
                    </div>
                    {selectedFile !== undefined && (
                      <ProjectFileEditor
                        // Keep an in-progress draft across unrelated document revisions, but
                        // reset it when this file's authoritative content changes underneath it.
                        key={`${selectedFile.path}:${selectedFile.content ?? ""}`}
                        file={selectedFile}
                        content={selectedFileContent}
                        busy={busy !== null}
                        onChange={(content) =>
                          setFileDrafts((drafts) => {
                            if (content === selectedFileSource) {
                              const { [selectedFile.path]: _reverted, ...remaining } = drafts;
                              return remaining;
                            }
                            return {
                              ...drafts,
                              [selectedFile.path]: {
                                baseContent: selectedFileSource,
                                content,
                              },
                            };
                          })
                        }
                        onApply={(content) => updateFile(selectedFile, content)}
                        onReplace={() => pickFile(selectedFile.path)}
                      />
                    )}
                  </section>

                  {loaded.conflicts.length > 0 && (
                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold">Resolve conflicts</h3>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Choose either side or edit the final file. Save remains blocked until
                          every path is resolved.
                        </p>
                      </div>
                      {loaded.conflicts.map((conflict) => (
                        <ConflictCard
                          key={conflict.path}
                          conflict={conflict}
                          busy={busy !== null}
                          onResolve={(resolution) => resolveConflict(conflict, resolution)}
                        />
                      ))}
                    </section>
                  )}

                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Saved versions</h3>
                    <div className="space-y-2">
                      {loaded.commits.map((commit) => (
                        <button
                          key={commit.commit}
                          type="button"
                          data-testid={`lifecycle-sheet.commit.${commit.commit}`}
                          onClick={() => setSelectedCommit(commit.commit)}
                          className={cn(
                            "border-border hover:bg-muted flex w-full items-start justify-between gap-4 rounded-lg border p-3 text-left",
                            selectedCommit === commit.commit && "ring-primary ring-2",
                            focusRing,
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {commit.message}
                            </span>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {commit.committedAt.toLocaleString()}
                            </span>
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {commitLabel(commit)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {selected !== undefined && !selected.isHead && (
                    <section className="border-border space-y-3 rounded-lg border p-4">
                      <div>
                        <h3 className="text-sm font-semibold">Restore saved version</h3>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Bring “{selected.message}” into the current draft. Save a version when you
                          want to keep the restored draft.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={restore}
                        disabled={!clean || busy !== null}
                        data-testid="lifecycle-sheet.restore"
                        className={cn(
                          "border-border hover:bg-muted rounded-md border px-3 py-2 text-sm",
                          focusRing,
                        )}
                      >
                        {busy === "restore" ? "Restoring…" : "Restore this version"}
                      </button>
                    </section>
                  )}
                </>
              )}
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
