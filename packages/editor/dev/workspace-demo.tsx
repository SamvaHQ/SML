import type {
  AsyncEditableEditorHost,
  AsyncLifecycleApi,
  DocumentChange,
  EditorDocument,
  ProjectCommit,
  ProjectLifecycleState,
} from "@samva/editor/host";
import { type EditorContribution, EditorShell } from "@samva/editor/shell";
import { useState } from "react";

import { useEditorStoreApi } from "../src/state/context";
import type { CompiledHostControls } from "./compiled-host";
import { DemoChat } from "./demo-chat";
import { NIMBUS_THEME_CSS, NIMBUS_THEME_FILE } from "./nimbus-template";

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

/**
 * The compiled host reports the delivered HTML's size; a render without one falls back to a
 * share of the preview, since the sent email links its images instead of inlining them.
 */
const SENT_SHARE = 0.42;

const withSentSize = <T extends EditorDocument | DocumentChange>(value: T): T =>
  value.channel === "email" && value.render !== null && value.render.sentBytes === undefined
    ? {
        ...value,
        render: {
          ...value.render,
          sentBytes: Math.round(new TextEncoder().encode(value.render.html).length * SENT_SHARE),
        },
      }
    : value;

/**
 * The compiled host with what the dashboard adds: versions (saved head + history), a lifecycle
 * with a few saved versions to restore, and renders that carry the sent size.
 */
export const createWorkspaceHost = (controls: CompiledHostControls): AsyncEditableEditorHost => {
  const mock = controls.host;
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
    // The theme, so Design's color swatches show the template's own colors.
    files: [{ path: NIMBUS_THEME_FILE, status: "clean", content: NIMBUS_THEME_CSS }],
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
    versions: demoVersions(),
    lifecycle: { status: "ready", api: lifecycle },
  };
};

const BUSY_FOR_MS = 2_500;

/** How long the harness takes to save a version, so Apply's wait is on screen. */
const SAVE_FOR_MS = 600;

/**
 * Versions the way the dashboard saves them: after a moment, and named. `?applyFail` makes every
 * save fail and `?applyHold` keeps it in flight, so both states can be looked at.
 */
function demoVersions(): NonNullable<AsyncEditableEditorHost["versions"]> {
  const query = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  return {
    status: "ready",
    api: {
      save: (revision) =>
        new Promise<string>((resolve, reject) => {
          if (query?.has("applyHold") === true) return;
          setTimeout(() => {
            if (query?.has("applyFail") === true)
              // oxlint-disable-next-line samva/no-error-constructor -- the harness stands in for a host whose save rejects with an Error
              reject(new Error("The workspace is out of space."));
            else resolve(revision);
          }, SAVE_FOR_MS);
        }),
      savedRevision: async () => null,
    },
  };
}

const DEV_BUTTON = "border-border hover:bg-muted rounded-md border px-2 py-1 text-[12px]";

/** The harness's own controls; shown only with `dev=1` so screenshots show a plain chat. */
const developerControlsRequested =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dev") === "1";

/** The shell as the dashboard mounts it, with the harness's assistant and review surface. */
export function WorkspaceDemoShell({
  controls,
  frameStart,
}: {
  readonly controls: CompiledHostControls;
  readonly frameStart: EditorContribution;
}) {
  const store = useEditorStoreApi();
  const holdBusy =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("busy");
  const [busy, setBusy] = useState(holdBusy);

  const simulateTurn = () => {
    setBusy(true);
    setTimeout(() => {
      void controls.emit({ origin: "agent" }).then(() => setBusy(holdBusy));
    }, BUSY_FOR_MS);
  };

  const emit = (input: Parameters<CompiledHostControls["emit"]>[0]) => void controls.emit(input);

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
          render: ({ openReview, workspace, removePin, clearPins }) => (
            <DemoChat
              composer={{ design: workspace.design, pins: workspace.pins, removePin, clearPins }}
              developer={
                developerControlsRequested ? (
                  <div
                    data-testid="dev-app.developer"
                    className="border-border bg-surface-inset flex flex-col gap-1.5 rounded-lg border p-2"
                  >
                    <span className="text-muted-foreground text-[11px] font-medium">Developer</span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        data-testid="dev-app.simulate-turn"
                        onClick={simulateTurn}
                        className={DEV_BUTTON}
                      >
                        Simulate a turn
                      </button>
                      <button
                        type="button"
                        data-testid="dev-app.stale-preview"
                        onClick={() =>
                          emit({
                            origin: "agent",
                            staleReason: "the headline closes a tag it never opened.",
                          })
                        }
                        className={DEV_BUTTON}
                      >
                        Break the latest edit
                      </button>
                      <button
                        type="button"
                        data-testid="dev-app.unbuilt-preview"
                        onClick={() => emit({ origin: "agent", broken: "not-built" })}
                        className={DEV_BUTTON}
                      >
                        Clear the preview
                      </button>
                      <button
                        type="button"
                        data-testid="dev-app.restore-preview"
                        onClick={() => emit({ origin: "agent", broken: false })}
                        className={DEV_BUTTON}
                      >
                        Restore the preview
                      </button>
                      <button
                        type="button"
                        data-testid="dev-app.open-review"
                        onClick={() => openReview?.()}
                        className={DEV_BUTTON}
                      >
                        Open review
                      </button>
                    </div>
                  </div>
                ) : null
              }
            />
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
