import type {
  AsyncEditableEditorHost,
  AsyncLifecycleApi,
  DocumentChange,
  EditorDocument,
  ProjectCommit,
  ProjectLifecycleState,
} from "@samva/editor/host";
import { toAsyncHost } from "@samva/editor/host/effect";
import type { MockHostControls } from "@samva/editor/mock";
import { type EditorContribution, EditorShell } from "@samva/editor/shell";
import { Effect } from "effect";
import { useState } from "react";

import { useEditorStoreApi } from "../src/state/context";

// `?demo=workspace` runs the editor the way Samva's dashboard does: a docked assistant beside
// the tabbed work pane, a review surface, saved versions to restore, a host-reported sent size,
// and a host signal for work in flight. Everything here is the harness's stand-in for the host.

const MINUTE = 60_000;

const DEMO_VERSIONS: ReadonlyArray<{ readonly message: string; readonly ago: number }> = [
  { message: "Shorter hero and one button", ago: 4 * MINUTE },
  { message: "Brand applied", ago: 52 * MINUTE },
  { message: "Nimbus look and welcome email", ago: 3 * 60 * MINUTE },
  { message: "First draft", ago: 26 * 60 * MINUTE },
];

/** The sent email links its images instead of inlining them, so it weighs less than the preview. */
const SENT_SHARE = 0.42;

const withSentSize = <T extends EditorDocument | DocumentChange>(value: T): T =>
  value.channel === "email" && value.render !== null
    ? {
        ...value,
        render: {
          ...value.render,
          sentBytes: Math.round(new TextEncoder().encode(value.render.html).length * SENT_SHARE),
        },
      }
    : value;

/**
 * The mock host with what the dashboard adds: versions (saved head + history), a lifecycle with
 * a few saved versions to restore, and renders that carry the sent size.
 */
export const createWorkspaceHost = (controls: MockHostControls): AsyncEditableEditorHost => {
  const mock = toAsyncHost(controls.host);
  let rev = "rev_1";
  let source = "";
  const now = Date.now();
  const commits: ProjectCommit[] = DEMO_VERSIONS.map((version, index) => ({
    commit: `c${DEMO_VERSIONS.length - index}`,
    tree: `t${DEMO_VERSIONS.length - index}`,
    parentCommit:
      index === DEMO_VERSIONS.length - 1 ? null : `c${DEMO_VERSIONS.length - index - 1}`,
    message: version.message,
    committedAt: new Date(now - version.ago),
    isHead: index === 0,
    isPublished: index === 1,
  }));
  const state = (): ProjectLifecycleState => ({
    rev,
    baseCommit: commits[0]!.commit,
    remoteHead: commits[0]!.commit,
    dirty: false,
    files: [],
    conflicts: [],
    commits,
  });
  const lifecycle: AsyncLifecycleApi = {
    inspect: async () => state(),
    publish: async ({ commit }) => ({
      publicationId: `pub_${commit}`,
      commit,
      publishedAt: new Date(),
    }),
    // Restoring writes the version's source as the next draft, the way a host's restore does.
    restore: async ({ baseRev }) => {
      const saved = await mock.writer.save({
        kind: "authoredSource",
        baseRev,
        authoredSource: source,
      });
      return { rev: saved.rev, authoredSource: source };
    },
    resolveConflict: async () => state(),
    updateFile: async () => state(),
    putAsset: async () => state(),
  };
  return {
    ...mock,
    document: {
      open: async (onChange, onError, onComplete) => {
        const opened = await mock.document.open(
          (change) => {
            rev = change.rev;
            if (change.authoredSource !== undefined) source = change.authoredSource;
            onChange(withSentSize(change));
          },
          onError,
          onComplete,
        );
        rev = opened.initial.rev;
        source = opened.initial.origin.authoredSource;
        return { ...opened, initial: withSentSize(opened.initial) };
      },
    },
    versions: {
      status: "ready",
      api: { save: async (revision) => revision, savedRevision: async () => null },
    },
    lifecycle: { status: "ready", api: lifecycle },
  };
};

const BUSY_FOR_MS = 2_500;

/** The shell as the dashboard mounts it, with the harness's assistant and review surface. */
export function WorkspaceDemoShell({
  controls,
  frameStart,
}: {
  readonly controls: MockHostControls;
  readonly frameStart: EditorContribution;
}) {
  const store = useEditorStoreApi();
  const holdBusy =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("busy");
  const [busy, setBusy] = useState(holdBusy);

  const simulateTurn = () => {
    setBusy(true);
    setTimeout(() => {
      // oxlint-disable-next-line eslint/no-restricted-properties -- the harness drives its mock host from a click
      void Effect.runPromise(controls.emit({ origin: "agent" })).then(() => setBusy(holdBusy));
    }, BUSY_FOR_MS);
  };

  const openInNewTab = () => {
    const render = store.getState().render;
    if (render === null) return;
    const url = URL.createObjectURL(new Blob([render.html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
  };

  return (
    <EditorShell
      previewBusy={busy}
      onOpenPreview={openInNewTab}
      contributions={[
        frameStart,
        {
          slot: "rail.assistant",
          id: "demo-assistant",
          header: <span className="text-muted-foreground text-[11px]">Demo</span>,
          render: ({ workspace, openReview }) => (
            <div
              data-testid="dev-app.demo-assistant"
              className="flex flex-col gap-3 p-4 text-[13px]"
            >
              <p>A host-owned chat docked beside the work pane.</p>
              <p className="text-muted-foreground">
                {workspace.checks.errors} errors · {workspace.checks.warnings} warnings ·{" "}
                {workspace.layers.length} layers · {workspace.layout} layout
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="dev-app.simulate-turn"
                  onClick={simulateTurn}
                  className="border-border hover:bg-muted rounded-md border px-2.5 py-1.5"
                >
                  Simulate a turn
                </button>
                <button
                  type="button"
                  data-testid="dev-app.open-review"
                  onClick={() => openReview?.()}
                  className="border-border hover:bg-muted rounded-md border px-2.5 py-1.5"
                >
                  Open review
                </button>
              </div>
            </div>
          ),
        },
        {
          slot: "rail.review",
          id: "demo-review",
          badge: (
            <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[10.5px] font-semibold">
              2
            </span>
          ),
          content: (
            <div data-testid="dev-app.demo-review" className="space-y-2 text-[13px]">
              <p className="font-medium">2 changes since the saved version</p>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5">
                <li>Hero heading shortened</li>
                <li>Button now reads “Claim your free bag”</li>
              </ul>
            </div>
          ),
        },
      ]}
    />
  );
}
