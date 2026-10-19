/** @vitest-environment happy-dom @jsxImportSource react */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { VersionPicker } from "../src/chrome/version-picker";
import type {
  AsyncEditorHost,
  AsyncLifecycleApi,
  EditableEditorDocument,
  ProjectLifecycleState,
} from "../src/host/types";
import { contractVersion } from "../src/host/types";
import { EditorProvider } from "../src/state/provider";

afterEach(cleanup);

const HEAD = "c".repeat(40);
const OLDER = "b".repeat(40);
const PUBLISHED = "a".repeat(40);

const document: EditableEditorDocument = {
  id: "tmpl_test",
  name: "Welcome",
  rev: "rev_1",
  origin: { kind: "tsx", file: "emails/welcome.tsx", authoredSource: "export default null" },
  access: { kind: "editable" },
  variables: [],
  metadata: {},
  channel: "email",
  preview: { status: "current" },
  fixtures: ["welcome"],
  fixture: "welcome",
  render: {
    revision: "rev_1",
    subject: "Welcome",
    html: '<body data-samva-instance="0"><p data-samva-instance="0.0">Welcome</p></body>',
    text: "Welcome",
    selections: [],
  },
  diagnostics: [],
  incompatibilities: [],
};

const commit = (
  id: string,
  message: string,
  day: number,
  flags: { isHead?: boolean; isPublished?: boolean },
) => ({
  commit: id,
  tree: "d".repeat(40),
  parentCommit: null,
  message,
  committedAt: new Date(`2026-09-0${day}T12:00:00.000Z`),
  isHead: flags.isHead ?? false,
  isPublished: flags.isPublished ?? false,
});

const state = (overrides: Partial<ProjectLifecycleState> = {}): ProjectLifecycleState => ({
  rev: "rev_1",
  baseCommit: HEAD,
  remoteHead: HEAD,
  dirty: false,
  files: [{ path: "emails/welcome.tsx", status: "clean", content: "welcome source" }],
  conflicts: [],
  commits: [
    commit(HEAD, "Update welcome", 3, { isHead: true }),
    commit(OLDER, "Tighten footer", 2, {}),
    commit(PUBLISHED, "Initial template", 1, { isPublished: true }),
  ],
  ...overrides,
});

const unarranged = (name: keyof AsyncLifecycleApi) => (): never => {
  throw new Error(`Unarranged AsyncLifecycleApi.${name}`);
};

const restoredSnapshot = { rev: "rev_2", authoredSource: "export default function Older() {}" };

const mount = (overrides: Partial<AsyncLifecycleApi> = {}, withLifecycle = true) => {
  const inspect = overrides.inspect ?? vi.fn(() => Promise.resolve(state()));
  const restore = overrides.restore ?? vi.fn(() => Promise.resolve(restoredSnapshot));
  const api: AsyncLifecycleApi = {
    inspect,
    restore,
    publish: unarranged("publish"),
    resolveConflict: unarranged("resolveConflict"),
    updateFile: unarranged("updateFile"),
    putAsset: unarranged("putAsset"),
  };
  const host: AsyncEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: { open: () => Promise.resolve({ initial: document, close: () => {} }) },
    writer: { save: () => Promise.resolve({ rev: "rev_1" }) },
    ...(withLifecycle ? { lifecycle: { status: "ready" as const, api } } : {}),
  };
  const view = render(
    <EditorProvider host={host}>
      <VersionPicker />
    </EditorProvider>,
  );
  return { view, restore };
};

const openPicker = async (view: ReturnType<typeof mount>["view"]) => {
  fireEvent.click(await view.findByTestId("preview-bar.versions"));
  return view.findByTestId(`preview-bar.version.${HEAD}`);
};

describe("VersionPicker", () => {
  it("renders nothing without the lifecycle capability", async () => {
    const { view } = mount({}, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.queryByTestId("preview-bar.versions")).toBeNull();
  });

  it("lists the draft and every saved version", async () => {
    const { view } = mount();
    await openPicker(view);

    expect(view.getByTestId("preview-bar.version-latest").textContent).toContain("Saved");
    expect(view.getByTestId(`preview-bar.version.${HEAD}`).textContent).toContain("Current");
    expect(view.getByTestId(`preview-bar.version.${OLDER}`).textContent).toContain(
      "Tighten footer",
    );
    expect(view.getByTestId(`preview-bar.version.${PUBLISHED}`).textContent).toContain("Published");
  });

  it("filters versions by message and says when none match", async () => {
    const { view } = mount();
    await openPicker(view);
    const search = view.getByTestId("preview-bar.versions-search");

    fireEvent.change(search, { target: { value: "FOOTER" } });
    expect(view.getByTestId(`preview-bar.version.${OLDER}`)).toBeTruthy();
    expect(view.queryByTestId(`preview-bar.version.${HEAD}`)).toBeNull();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(view.getByTestId("preview-bar.versions-empty")).toBeTruthy();
  });

  it("asks before restoring and does not restore on select", async () => {
    const { view, restore } = mount();
    await openPicker(view);
    fireEvent.click(view.getByTestId(`preview-bar.version.${OLDER}`));

    const dialog = await view.findByTestId("preview-bar.restore-dialog");
    expect(dialog.textContent).toContain("Restore this version?");
    expect(dialog.textContent).toContain("“Tighten footer” replaces the draft.");
    expect(restore).not.toHaveBeenCalled();
  });

  it("closes without restoring on Cancel", async () => {
    const { view, restore } = mount();
    await openPicker(view);
    fireEvent.click(view.getByTestId(`preview-bar.version.${OLDER}`));
    const dialog = await view.findByTestId("preview-bar.restore-dialog");

    fireEvent.click(view.getByTestId("preview-bar.restore-cancel"));

    await waitFor(() => expect(view.queryByTestId("preview-bar.restore-dialog")).toBeNull());
    expect(dialog.isConnected).toBe(false);
    expect(restore).not.toHaveBeenCalled();
  });

  it("restores once with the commit and acknowledged revision", async () => {
    const { view, restore } = mount();
    await openPicker(view);
    fireEvent.click(view.getByTestId(`preview-bar.version.${OLDER}`));
    fireEvent.click(await view.findByTestId("preview-bar.restore-confirm"));

    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore).toHaveBeenCalledWith({ commit: OLDER, baseRev: "rev_1" });
    await waitFor(() => expect(view.queryByTestId("preview-bar.restore-dialog")).toBeNull());
  });

  it("closes without a dialog when the clean draft's own version is chosen", async () => {
    const { view } = mount();
    await openPicker(view);
    fireEvent.click(view.getByTestId(`preview-bar.version.${HEAD}`));

    await waitFor(() => expect(view.queryByTestId("preview-bar.versions-popup")).toBeNull());
    expect(view.queryByTestId("preview-bar.restore-dialog")).toBeNull();
  });

  it("blocks restore while the draft has unsaved changes", async () => {
    const { view, restore } = mount({ inspect: () => Promise.resolve(state({ dirty: true })) });
    await openPicker(view);
    expect(view.getByTestId("preview-bar.version-latest").textContent).toContain("Unsaved changes");
    fireEvent.click(view.getByTestId(`preview-bar.version.${OLDER}`));

    const dialog = await view.findByTestId("preview-bar.restore-dialog");
    expect(dialog.textContent).toContain(
      "Save a version first, so your unsaved changes stay in the list.",
    );
    const confirm = view.getByTestId("preview-bar.restore-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(restore).not.toHaveBeenCalled();
  });

  it("checks the draft again under the lock and refuses when it moved", async () => {
    const inspect = vi
      .fn<AsyncLifecycleApi["inspect"]>()
      .mockResolvedValueOnce(state())
      .mockResolvedValue(state({ dirty: true }));
    const { view, restore } = mount({ inspect });
    await openPicker(view);
    fireEvent.click(view.getByTestId(`preview-bar.version.${OLDER}`));
    fireEvent.click(await view.findByTestId("preview-bar.restore-confirm"));

    await waitFor(() =>
      expect((view.getByTestId("preview-bar.restore-confirm") as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(restore).not.toHaveBeenCalled();
    expect(view.getByTestId("preview-bar.restore-dialog").textContent).toContain(
      "Save a version first, so your unsaved changes stay in the list.",
    );
  });

  it("keeps the dialog open and shows the error when the restore fails", async () => {
    const restore = vi.fn(() => Promise.reject(new Error("Could not restore")));
    const { view } = mount({ restore });
    await openPicker(view);
    fireEvent.click(view.getByTestId(`preview-bar.version.${OLDER}`));
    fireEvent.click(await view.findByTestId("preview-bar.restore-confirm"));

    expect((await view.findByRole("alert")).textContent).toBe("Could not restore");
    expect(view.getByTestId("preview-bar.restore-dialog")).toBeTruthy();
  });

  it("offers Try again when the versions cannot be loaded", async () => {
    const inspect = vi
      .fn<AsyncLifecycleApi["inspect"]>()
      .mockRejectedValueOnce(new Error("Versions are unavailable"))
      .mockResolvedValue(state());
    const { view } = mount({ inspect });
    fireEvent.click(await view.findByTestId("preview-bar.versions"));

    expect((await view.findByRole("alert")).textContent).toBe("Versions are unavailable");
    fireEvent.click(view.getByTestId("preview-bar.versions-retry"));
    expect(await view.findByTestId(`preview-bar.version.${OLDER}`)).toBeTruthy();
  });
});
