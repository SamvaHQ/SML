/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import type {
  AsyncEditorHost,
  AsyncLifecycleApi,
  ProjectLifecycleState,
  SavedVersion,
} from "@samva/editor/host";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import type { EditorContribution } from "../src/chrome/contributions";
import { EditorShell } from "../src/chrome/shell";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { changeCount, type EditorStore } from "../src/state/store";
import { emitChange, mockEditor, settle, withVersions } from "./mock-host";

afterEach(cleanup);

let storeOf: () => EditorStore = () => {
  throw new Error("not mounted");
};

function StoreProbe() {
  const store = useEditorStoreApi();
  storeOf = () => store;
  return null;
}

const mount = async (host: AsyncEditorHost, contributions?: ReadonlyArray<EditorContribution>) => {
  const view = render(
    <EditorProvider host={host}>
      <StoreProbe />
      <EditorShell contributions={contributions} />
    </EditorProvider>,
  );
  await waitFor(() => expect(storeOf().getState().doc).not.toBeNull());
  // happy-dom measures no frame width; the status reads in full from the standard layout up.
  act(() => storeOf().getState().actions.setLayoutMode("wide"));
  return view;
};

/** One edit to the draft, the way Design makes it, written through the host. */
const edit = async (line: string): Promise<void> => {
  await act(async () => {
    const doc = storeOf().getState().doc!;
    storeOf()
      .getState()
      .actions.applySourceEdit({
        revision: doc.rev,
        source: doc.origin.authoredSource,
        edits: [{ start: 0, end: 0, before: "", after: `${line}\n` }],
        design: { label: line },
      });
    await storeOf().getState().actions.flushSaves();
    await settle();
  });
};

const status = (view: ReturnType<typeof render>) => view.getByTestId("statusbar.save-version");

/** A save the test answers when it chooses. */
const deferredSave = () => {
  const answers: Array<{
    readonly revision: string;
    readonly resolve: (saved: SavedVersion) => void;
    readonly reject: (cause: unknown) => void;
  }> = [];
  const save = (revision: string) =>
    new Promise<SavedVersion>((resolve, reject) => {
      answers.push({ revision, resolve, reject });
    });
  return { answers, save };
};

describe("the status bar's save status", () => {
  it("counts the changes not in a version, then saves, then names the version", async () => {
    const versions = deferredSave();
    const view = await mount(withVersions((await mockEditor()).host, versions.save));
    await waitFor(() => expect(status(view).dataset.saveVersionState).toBe("idle"));
    expect(status(view).textContent).toBe("Changes not in a version yet");
    await edit("// one");
    await edit("// two");
    expect(status(view).textContent).toBe("2 changes not in a version yet");
    const button = view.getByTestId("topbar.save-version") as HTMLButtonElement;
    expect(button.textContent).toBe("Save version");
    // The draft's own autosave is quiet: no sentence of its own beside the status.
    expect(view.queryByTestId("statusbar.draft")).toBeNull();

    fireEvent.click(button);
    await waitFor(() => expect(status(view).dataset.saveVersionState).toBe("saving"));
    expect(status(view).textContent).toBe("Saving version…");
    expect((view.getByTestId("topbar.save-version") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      const answer = versions.answers[0]!;
      answer.resolve({ revision: answer.revision, number: 13 });
      await settle();
    });
    await waitFor(() => expect(status(view).dataset.saveVersionState).toBe("saved"));
    expect(status(view).textContent).toBe("Saved as version 13");
    expect(view.queryByTestId("topbar.save-version")).toBeNull();
  });

  it("shortens the status on a phone and keeps the sentence as its name", async () => {
    const view = await mount(
      withVersions((await mockEditor()).host, async (revision) => ({ revision })),
    );
    await edit("// one");
    await edit("// two");
    act(() => storeOf().getState().actions.setLayoutMode("narrow"));
    expect(status(view).textContent).toBe("2 changes");
    expect(status(view).getAttribute("aria-label")).toBe("2 changes not in a version yet");
  });

  it("says a version without a number is saved", async () => {
    const view = await mount(
      withVersions((await mockEditor()).host, async (revision) => ({ revision })),
    );
    await edit("// one");
    fireEvent.click(view.getByTestId("topbar.save-version"));
    await waitFor(() => expect(status(view).textContent).toBe("Saved as a version"));
  });

  it("says why a save failed and saves on Retry", async () => {
    const versions = deferredSave();
    const view = await mount(withVersions((await mockEditor()).host, versions.save));
    await edit("// one");
    fireEvent.click(view.getByTestId("topbar.save-version"));
    await waitFor(() => expect(versions.answers).toHaveLength(1));
    await act(async () => {
      versions.answers[0]!.reject(new Error("Storage is full."));
      await settle();
    });
    await waitFor(() => expect(status(view).dataset.saveVersionState).toBe("error"));
    expect(status(view).textContent).toBe("Couldn't save: Storage is full.");
    const retry = view.getByTestId("topbar.save-version");
    expect(retry.textContent).toBe("Retry");
    fireEvent.click(retry);
    await waitFor(() => expect(versions.answers).toHaveLength(2));
    await act(async () => {
      const answer = versions.answers[1]!;
      answer.resolve({ revision: answer.revision, number: 4 });
      await settle();
    });
    await waitFor(() => expect(status(view).textContent).toBe("Saved as version 4"));
  });

  it("saves from the keyboard through the same path", async () => {
    const versions = deferredSave();
    const view = await mount(withVersions((await mockEditor()).host, versions.save));
    await edit("// one");
    const name = await view.findByTestId("topbar.name");
    fireEvent.keyDown(name, { key: "s", code: "KeyS", metaKey: true, ctrlKey: true });
    await waitFor(() => expect(versions.answers).toHaveLength(1));
  });

  it("reports the draft itself, quietly, without the host's versions", async () => {
    const view = await mount((await mockEditor()).host);
    await waitFor(() => expect(status(view).textContent).toBe("Saved"));
    expect(status(view).dataset.saveVersionState).toBe("unavailable");
    expect(view.queryByTestId("topbar.save-version")).toBeNull();
    act(() => {
      const doc = storeOf().getState().doc!;
      storeOf().getState().actions.replaceAuthoredSource(`// typed\n${doc.origin.authoredSource}`);
    });
    expect(status(view).textContent).toBe("Saving…");
    await act(async () => {
      await storeOf().getState().actions.flushSaves();
      await settle();
    });
    await waitFor(() => expect(status(view).textContent).toBe("Saved"));

    act(() => storeOf().setState({ storageError: "Browser storage is full." }));
    expect(status(view).textContent).toBe("Couldn't save: Browser storage is full.");
    fireEvent.click(view.getByTestId("statusbar.retry"));
    expect(storeOf().getState().storageError).toBeNull();
  });

  it("does not call a project change the saved version", async () => {
    for (const origin of ["self", "agent"] as const) {
      const editor = await mockEditor();
      // A host can report its own project write (a theme change) as the session's.
      const open: typeof editor.host.document.open = (onChange, ...rest) =>
        editor.host.document.open(
          (change) => onChange(origin === "self" ? { ...change, origin } : change),
          ...rest,
        );
      const view = await mount(
        withVersions({ ...editor.host, document: { open } }, async (revision) => ({
          revision,
          number: 13,
        })),
      );
      await edit("// kept");
      fireEvent.click(view.getByTestId("topbar.save-version"));
      await waitFor(() => expect(status(view).textContent).toBe("Saved as version 13"));
      const saved = storeOf().getState().doc!;
      // The theme or a shared part changed: a new revision, the entry as it was saved.
      await act(() => emitChange(editor, { origin: "agent" }));
      await waitFor(() => expect(storeOf().getState().doc?.rev).not.toBe(saved.rev));
      expect(storeOf().getState().doc?.origin.authoredSource).toBe(saved.origin.authoredSource);
      await waitFor(() => expect(status(view).textContent).toBe("Changes not in a version yet"));
      expect(view.getByTestId("topbar.save-version")).toBeTruthy();
      cleanup();
    }
  });

  it("refuses to keep the draft for a turn when a write conflicted, without versions", async () => {
    await mount((await mockEditor()).host);
    act(() => storeOf().setState({ conflict: true }));
    await expect(storeOf().getState().actions.saveVersion()).rejects.toMatchObject({
      reason: "Your latest changes haven't reached the draft.",
    });
    act(() => storeOf().setState({ conflict: false, storageError: "Browser storage is full." }));
    await expect(storeOf().getState().actions.saveVersion()).rejects.toMatchObject({
      reason: "Browser storage is full.",
    });
  });

  it("leaves a guest headline as it was", async () => {
    const view = await mount((await mockEditor()).host, [
      { slot: "statusbar.headline", id: "guest", headline: "Draft saved", saveVersion: false },
    ]);
    expect(view.getByTestId("statusbar.guest").textContent).toBe("Draft saved");
    act(() => {
      const doc = storeOf().getState().doc!;
      storeOf().getState().actions.replaceAuthoredSource(`// typed\n${doc.origin.authoredSource}`);
    });
    expect(view.getByTestId("statusbar.guest").textContent).toBe("Saving…");
    await act(async () => {
      await storeOf().getState().actions.flushSaves();
      await settle();
    });
    await waitFor(() =>
      expect(view.getByTestId("statusbar.guest").textContent).toBe("Draft saved"),
    );
    act(() => storeOf().setState({ conflict: true }));
    expect(view.getByTestId("statusbar.guest").textContent).toBe("Couldn't save version");
    expect(view.queryByTestId("topbar.save-version")).toBeNull();
  });
});

describe("discarding changes", () => {
  const openDiscard = async (view: ReturnType<typeof render>) => {
    fireEvent.click(await view.findByTestId("statusbar.version-menu"));
    fireEvent.click(await view.findByTestId("statusbar.discard"));
    return view.findByTestId("statusbar.discard-dialog");
  };

  it("puts back the version this session saved, after a confirm", async () => {
    const view = await mount(
      withVersions((await mockEditor()).host, async (revision) => ({ revision, number: 13 })),
    );
    await edit("// kept");
    fireEvent.click(view.getByTestId("topbar.save-version"));
    await waitFor(() => expect(status(view).textContent).toBe("Saved as version 13"));
    const saved = storeOf().getState().doc!.origin.authoredSource;
    await edit("// dropped");
    expect(status(view).textContent).toBe("1 change not in a version yet");

    const dialog = await openDiscard(view);
    expect(dialog.textContent).toContain("Discard 1 change?");
    expect(dialog.textContent).toContain("The draft goes back to version 13.");
    await act(async () => {
      fireEvent.click(view.getByTestId("statusbar.discard-confirm"));
      await settle();
    });
    expect(storeOf().getState().doc?.origin.authoredSource).toBe(saved);
    await act(async () => {
      await storeOf().getState().actions.flushSaves();
      await settle();
    });
    await waitFor(() => expect(status(view).textContent).toBe("Saved as version 13"));
  });

  it("restores the saved head through the host's lifecycle", async () => {
    const editor = await mockEditor();
    let original = "";
    const restores: Array<{ readonly commit: string; readonly baseRev: string }> = [];
    const state = (): ProjectLifecycleState => ({
      rev: "rev_1",
      baseCommit: "c2",
      remoteHead: "c2",
      dirty: true,
      files: [],
      conflicts: [],
      commits: [
        {
          commit: "c2",
          tree: "t2",
          parentCommit: "c1",
          message: "Brand applied",
          committedAt: new Date(),
          isHead: true,
          isPublished: false,
        },
        {
          commit: "c1",
          tree: "t1",
          parentCommit: null,
          message: "First draft",
          committedAt: new Date(),
          isHead: false,
          isPublished: true,
        },
      ],
    });
    const unused = () => Promise.reject(new Error("unused"));
    const lifecycle: AsyncLifecycleApi = {
      inspect: async () => state(),
      publish: unused,
      resolveConflict: unused,
      updateFile: unused,
      putAsset: unused,
      restore: async (input) => {
        restores.push(input);
        const saved = await editor.host.writer.save({
          kind: "authoredSource",
          baseRev: input.baseRev,
          authoredSource: original,
        });
        return { rev: saved.rev, authoredSource: original };
      },
    };
    const view = await mount({
      ...withVersions(editor.host, async (revision) => ({ revision })),
      lifecycle: { status: "ready", api: lifecycle },
    });
    original = storeOf().getState().doc!.origin.authoredSource;
    await edit("// dropped");

    const dialog = await openDiscard(view);
    expect(dialog.textContent).toContain("Discard 1 change?");
    expect(dialog.textContent).toContain("The draft goes back to the last saved version.");
    await act(async () => {
      fireEvent.click(view.getByTestId("statusbar.discard-confirm"));
      await settle(30);
    });
    expect(restores).toHaveLength(1);
    expect(restores[0]?.commit).toBe("c2");
    expect(storeOf().getState().doc?.origin.authoredSource).toBe(original);
    expect(changeCount(storeOf().getState())).toBe(0);
    await waitFor(() => expect(view.queryByTestId("statusbar.discard-dialog")).toBeNull());
  });

  it("is not offered with nothing to go back to", async () => {
    const view = await mount(
      withVersions((await mockEditor()).host, async (r) => ({ revision: r })),
    );
    await edit("// one");
    expect(view.queryByTestId("statusbar.version-menu")).toBeNull();
  });
});
