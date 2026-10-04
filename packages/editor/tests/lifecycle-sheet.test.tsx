/** @vitest-environment happy-dom @jsxImportSource react */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { CONFIRM_PUBLISH_LABEL, LifecycleSheet } from "../src/chrome/lifecycle-sheet";
import type { AsyncDocumentWriter, AsyncEditorHost, AsyncLifecycleApi } from "../src/host/types";
import {
  contractVersion,
  type DocumentChange,
  type EditableEditorDocument,
  type ProjectLifecycleState,
} from "../src/host/types";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";

afterEach(cleanup);

const HEAD = "b".repeat(40);
const PARENT = "a".repeat(40);
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

/** A foreign change at `rev`, carrying the whole email payload the host published. */
const externalChange = (rev: string): DocumentChange => ({
  rev,
  origin: "external",
  channel: "email",
  preview: { status: "current" },
  fixtures: document.fixtures,
  fixture: document.fixture,
  render: { ...document.render!, revision: rev },
  diagnostics: [],
  incompatibilities: [],
});

const state = (dirty = false) => ({
  rev: "rev_1",
  baseCommit: HEAD,
  remoteHead: HEAD,
  dirty,
  files: [
    {
      path: "emails/welcome.tsx",
      status: dirty ? ("modified" as const) : ("clean" as const),
      content: "welcome source",
    },
  ],
  conflicts: [],
  commits: [
    {
      commit: HEAD,
      tree: "c".repeat(40),
      parentCommit: PARENT,
      message: "Update welcome",
      committedAt: new Date("2026-09-01T12:00:00.000Z"),
      isHead: true,
      isPublished: false,
    },
    {
      commit: PARENT,
      tree: "d".repeat(40),
      parentCommit: null,
      message: "Initial template",
      committedAt: new Date("2026-08-31T12:00:00.000Z"),
      isHead: false,
      isPublished: true,
    },
  ],
});

type LifecycleOverrides = Partial<AsyncLifecycleApi>;

/**
 * The lifecycle API the sheet drives. A method a case does not
 * arrange throws with its own name, so a sheet that starts calling one fails
 * here instead of reading `undefined` off a silent stub.
 */
const unarranged = (name: keyof AsyncLifecycleApi) => (): never => {
  throw new Error(`Unarranged AsyncLifecycleApi.${name}`);
};

const lifecycleApi = (overrides: LifecycleOverrides): AsyncLifecycleApi => ({
  inspect: overrides.inspect ?? unarranged("inspect"),
  publish: overrides.publish ?? unarranged("publish"),
  restore: overrides.restore ?? unarranged("restore"),
  resolveConflict: overrides.resolveConflict ?? unarranged("resolveConflict"),
  updateFile: overrides.updateFile ?? unarranged("updateFile"),
  putAsset: overrides.putAsset ?? unarranged("putAsset"),
});

const hostFor = (
  api: AsyncLifecycleApi,
  save: AsyncDocumentWriter["save"] = () => Promise.resolve({ rev: "rev_1" }),
): AsyncEditorHost => ({
  contractVersion,
  access: "editable",
  sourceAccess: "editable",
  document: { open: () => Promise.resolve({ initial: document, close: () => {} }) },
  writer: { save },
  lifecycle: { status: "ready", api },
});

type EditorStoreRef = { current: ReturnType<typeof useEditorStoreApi> | null };

function StoreProbe({ target }: { readonly target: EditorStoreRef }) {
  target.current = useEditorStoreApi();
  return null;
}

const mount = (overrides: LifecycleOverrides) =>
  render(
    <EditorProvider host={hostFor(lifecycleApi(overrides))}>
      <LifecycleSheet open onClose={() => {}} />
    </EditorProvider>,
  );

describe("LifecycleSheet", () => {
  it("publishes the exact clean saved commit", async () => {
    const inspect = vi.fn(() => Promise.resolve(state()));
    const publish = vi.fn(() =>
      Promise.resolve({
        publicationId: "tpub_1",
        commit: HEAD,
        publishedAt: new Date("2026-09-01T13:00:00.000Z"),
      }),
    );
    const view = mount({
      inspect,
      publish,
    });
    const button = await view.findByTestId("lifecycle-sheet.confirm-publish");

    expect(button.textContent).toBe(CONFIRM_PUBLISH_LABEL);
    fireEvent.click(button);

    await waitFor(() => expect(publish).toHaveBeenCalledWith({ baseRev: "rev_1", commit: HEAD }));
    expect((await view.findByTestId("lifecycle-sheet.notice")).textContent).toBe(
      "Published the current saved version.",
    );
  });

  it("stages a historical commit and adopts the returned workspace revision", async () => {
    const inspect = vi.fn(() => Promise.resolve(state()));
    const restore = vi.fn(() =>
      Promise.resolve({ rev: "rev_2", authoredSource: "export default function Initial() {}" }),
    );
    const view = mount({
      inspect,
      restore,
    });
    fireEvent.click(await view.findByTestId(`lifecycle-sheet.commit.${PARENT}`));
    fireEvent.click(await view.findByTestId("lifecycle-sheet.restore"));

    await waitFor(() => expect(restore).toHaveBeenCalledWith({ baseRev: "rev_1", commit: PARENT }));
    expect((await view.findByTestId("lifecycle-sheet.notice")).textContent).toContain(
      "Restored the saved version to the draft",
    );
  });

  it("flushes queued edits before restoring with the acknowledged revision", async () => {
    let releaseSave: ((result: { readonly rev: string }) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<{ readonly rev: string }>((resolve) => {
          releaseSave = resolve;
        }),
    );
    const inspect = vi.fn(() => Promise.resolve(state()));
    const restore = vi.fn(() =>
      Promise.resolve({ rev: "rev_3", authoredSource: "export default function Initial() {}" }),
    );
    const storeRef: EditorStoreRef = { current: null };
    const api = lifecycleApi({ inspect, restore });
    const view = render(
      <EditorProvider host={hostFor(api, save)}>
        <StoreProbe target={storeRef} />
        <LifecycleSheet open onClose={() => {}} />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId(`lifecycle-sheet.commit.${PARENT}`));

    act(() => {
      storeRef.current
        ?.getState()
        .actions.replaceAuthoredSource("export default function Edited() {}");
    });
    // The edit is queued after inspection; the restore must fence it before calling the host.
    fireEvent.click(await view.findByTestId("lifecycle-sheet.restore"));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        kind: "authoredSource",
        baseRev: "rev_1",
        authoredSource: "export default function Edited() {}",
      }),
    );
    expect(restore).not.toHaveBeenCalled();

    releaseSave?.({ rev: "rev_2" });
    await waitFor(() => expect(restore).toHaveBeenCalledWith({ baseRev: "rev_2", commit: PARENT }));
  });

  it("gates edits until the restore operation adopts its snapshot", async () => {
    let releaseRestore:
      | ((result: { readonly rev: string; readonly authoredSource: string }) => void)
      | undefined;
    const save = vi.fn(() => Promise.resolve({ rev: "rev_1" }));
    const inspect = vi.fn(() => Promise.resolve(state()));
    const restore = vi.fn(
      () =>
        new Promise<{ readonly rev: string; readonly authoredSource: string }>((resolve) => {
          releaseRestore = resolve;
        }),
    );
    const storeRef: EditorStoreRef = { current: null };
    const view = render(
      <EditorProvider host={hostFor(lifecycleApi({ inspect, restore }), save)}>
        <StoreProbe target={storeRef} />
        <LifecycleSheet open onClose={() => {}} />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId(`lifecycle-sheet.commit.${PARENT}`));
    fireEvent.click(await view.findByTestId("lifecycle-sheet.restore"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith({ baseRev: "rev_1", commit: PARENT }));
    expect(storeRef.current?.getState().lifecycleBusy).toBe(true);

    act(() => {
      storeRef.current
        ?.getState()
        .actions.replaceAuthoredSource("export default function Lost() {}");
    });
    expect(storeRef.current?.getState().doc?.origin).toMatchObject({
      kind: "tsx",
      authoredSource: "export default null",
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      releaseRestore?.({ rev: "rev_2", authoredSource: "export default function Initial() {}" });
    });
    await waitFor(() => expect(storeRef.current?.getState().lifecycleBusy).toBe(false));
    expect(storeRef.current?.getState().doc?.origin).toMatchObject({
      kind: "tsx",
      authoredSource: "export default function Initial() {}",
    });
  });

  it("blocks publish and restore while the working tree is dirty", async () => {
    const view = mount({
      inspect: () => Promise.resolve(state(true)),
    });
    const publish = await view.findByTestId("lifecycle-sheet.confirm-publish");
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect((await view.findByTestId("lifecycle-sheet.cleanliness-warning")).textContent).toContain(
      "draft has unsaved changes",
    );
  });

  it("shows changed binary assets without offering a text editor", async () => {
    const view = mount({
      inspect: () =>
        Promise.resolve({
          ...state(true),
          files: [
            { path: "assets/logo.png", status: "modified" as const, content: null, binary: true },
          ],
        }),
    });
    expect((await view.findByTestId("lifecycle-sheet.binary-file")).textContent).toContain(
      "Unsaved until you save a version.",
    );
    expect(view.queryByTestId("lifecycle-sheet.file-source.assets/logo.png")).toBeNull();
    expect(
      ((await view.findByTestId("lifecycle-sheet.confirm-publish")) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  describe("Add file", () => {
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const png = (name: string, size = PNG.length) => {
      const bytes = new Uint8Array(size);
      bytes.set(PNG);
      return new File([bytes], name, { type: "image/png" });
    };
    const withAsset = (path: string): ProjectLifecycleState => ({
      ...state(true),
      rev: "rev_2",
      files: [
        ...state(false).files,
        { path, status: "added" as const, content: null, binary: true },
      ],
    });
    const pick = async (view: ReturnType<typeof mount>, file: File) => {
      const input = (await view.findByTestId("lifecycle-sheet.add-file-input")) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
    };

    it("adds a picked image beside the entry and selects it", async () => {
      const putAsset = vi.fn(() => Promise.resolve(withAsset("emails/assets/logo.png")));
      const view = mount({ inspect: () => Promise.resolve(state(false)), putAsset });
      const add = await view.findByTestId("lifecycle-sheet.add-file");
      expect(add.textContent).toBe("Add file");
      const input = view.getByTestId("lifecycle-sheet.add-file-input") as HTMLInputElement;
      const opened = vi.spyOn(input, "click").mockImplementation(() => {});
      fireEvent.click(add);
      expect(opened).toHaveBeenCalledOnce();
      expect(input.accept).toBe("image/png,image/jpeg,image/gif,image/webp,.woff2");

      await pick(view, png("logo.png"));

      await waitFor(() => expect(putAsset).toHaveBeenCalledOnce());
      expect(putAsset).toHaveBeenCalledWith({
        path: "emails/assets/logo.png",
        baseRev: "rev_1",
        bytes: new Uint8Array(PNG),
        replace: false,
      });
      expect((await view.findByTestId("lifecycle-sheet.notice")).textContent).toBe(
        "Added emails/assets/logo.png. Save a version to keep this change.",
      );
      expect(view.getByTestId("lifecycle-sheet.file.emails/assets/logo.png")).toBeTruthy();
      expect(view.getByTestId("lifecycle-sheet.replace-file")).toBeTruthy();
    });

    it("refuses a file over 1 MB before writing it", async () => {
      const putAsset = vi.fn();
      const view = mount({ inspect: () => Promise.resolve(state(false)), putAsset });
      await pick(view, png("hero.png", 1024 * 1024 + 1));

      expect((await view.findByRole("alert")).textContent).toBe(
        "hero.png is larger than 1 MB. Choose a smaller file.",
      );
      expect(putAsset).not.toHaveBeenCalled();
    });

    it("asks before replacing a listed file with the same name", async () => {
      const putAsset = vi.fn(() => Promise.resolve(withAsset("emails/assets/logo.png")));
      const view = mount({
        inspect: () => Promise.resolve(withAsset("emails/assets/logo.png")),
        putAsset,
      });
      await pick(view, png("logo.png"));

      expect((await view.findByTestId("lifecycle-sheet.replace-prompt")).textContent).toContain(
        "emails/assets/logo.png already exists.",
      );
      expect(putAsset).not.toHaveBeenCalled();
      fireEvent.click(view.getByTestId("lifecycle-sheet.confirm-replace"));

      await waitFor(() =>
        expect(putAsset).toHaveBeenCalledWith(
          expect.objectContaining({ path: "emails/assets/logo.png", replace: true }),
        ),
      );
      expect((await view.findByTestId("lifecycle-sheet.notice")).textContent).toContain(
        "Replaced emails/assets/logo.png.",
      );
    });

    it("offers to replace when the project already holds the path", async () => {
      const putAsset = vi.fn((input: { readonly replace: boolean }) =>
        input.replace
          ? Promise.resolve(withAsset("emails/assets/logo.png"))
          : Promise.reject(
              Object.assign(new Error("exists"), {
                _tag: "ProjectFileExists",
                path: "emails/assets/logo.png",
                reason: "exists",
              }),
            ),
      );
      const view = mount({ inspect: () => Promise.resolve(state(false)), putAsset });
      await pick(view, png("logo.png"));

      fireEvent.click(await view.findByTestId("lifecycle-sheet.confirm-replace"));
      await waitFor(() => expect(putAsset).toHaveBeenCalledTimes(2));
      expect(putAsset).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: "emails/assets/logo.png", replace: true }),
      );
      expect(view.queryByRole("alert")).toBeNull();
    });

    it("replaces the selected file in place, accepting only its format", async () => {
      const putAsset = vi.fn(() => Promise.resolve(withAsset("assets/logo.png")));
      const view = mount({
        inspect: () => Promise.resolve(withAsset("assets/logo.png")),
        putAsset,
      });
      fireEvent.click(await view.findByTestId("lifecycle-sheet.file.assets/logo.png"));
      const input = view.getByTestId("lifecycle-sheet.add-file-input") as HTMLInputElement;
      vi.spyOn(input, "click").mockImplementation(() => {});
      fireEvent.click(await view.findByTestId("lifecycle-sheet.replace-file"));
      expect(input.accept).toBe(".png");

      await pick(view, png("new-logo.png"));

      await waitFor(() =>
        expect(putAsset).toHaveBeenCalledWith(
          expect.objectContaining({ path: "assets/logo.png", replace: true }),
        ),
      );
    });
  });

  it("blocks publish and restore while a project-file draft is unapplied", async () => {
    const project = {
      ...state(false),
      files: [
        { path: "emails/welcome.tsx", status: "clean" as const, content: "welcome source" },
        { path: "theme.ts", status: "clean" as const, content: "theme source" },
      ],
    };
    const view = mount({
      inspect: () => Promise.resolve(project),
    });

    fireEvent.click(await view.findByTestId(`lifecycle-sheet.commit.${PARENT}`));
    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.theme.ts"));
    const source = await view.findByTestId("lifecycle-sheet.file-source.theme.ts");
    fireEvent.change(source, { target: { value: "local draft" } });

    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.emails/welcome.tsx"));
    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.theme.ts"));
    const restoredSource = (await view.findByTestId(
      "lifecycle-sheet.file-source.theme.ts",
    )) as HTMLTextAreaElement;
    expect(restoredSource.value).toBe("local draft");

    expect(
      (await view.findByTestId("lifecycle-sheet.confirm-publish")) as HTMLButtonElement,
    ).toMatchObject({ disabled: true });
    expect((await view.findByTestId("lifecycle-sheet.restore")) as HTMLButtonElement).toMatchObject(
      { disabled: true },
    );

    fireEvent.change(restoredSource, { target: { value: "theme source" } });
    expect((await view.findByTestId("lifecycle-sheet.restore")) as HTMLButtonElement).toMatchObject(
      {
        disabled: false,
      },
    );
  });

  it("renders the host-owned locked capability", async () => {
    const host: AsyncEditorHost = {
      ...hostFor(lifecycleApi({})),
      lifecycle: {
        status: "locked",
        upsell: { reason: "Publishing requires Pro.", cta: { label: "Upgrade", href: "/billing" } },
      },
    };
    const view = render(
      <EditorProvider host={host}>
        <LifecycleSheet open onClose={() => {}} />
      </EditorProvider>,
    );
    expect((await view.findByTestId("lifecycle-sheet.locked-reason")).textContent).toBe(
      "Publishing requires Pro.",
    );
  });

  it("lists project files and resolves an edited conflicted path", async () => {
    const conflicted = {
      ...state(true),
      files: [
        { path: "emails/welcome.tsx", status: "conflicted" as const, content: "draft source" },
        { path: "theme.ts", status: "clean" as const, content: "theme source" },
      ],
      conflicts: [
        {
          path: "emails/welcome.tsx",
          base: "base source",
          draft: "draft source",
          main: "main source",
        },
      ],
    };
    const resolved = { ...state(true), rev: "rev_2" };
    const resolveConflict = vi.fn(() => Promise.resolve(resolved));
    const view = mount({
      inspect: () => Promise.resolve(conflicted),
      resolveConflict,
    });

    expect(await view.findByTestId("lifecycle-sheet.file.theme.ts")).toBeTruthy();
    const source = await view.findByTestId("lifecycle-sheet.conflict-source.emails/welcome.tsx");
    fireEvent.change(source, { target: { value: "merged source" } });
    fireEvent.click(await view.findByTestId("lifecycle-sheet.resolve-edited.emails/welcome.tsx"));

    await waitFor(() =>
      expect(resolveConflict).toHaveBeenCalledWith({
        path: "emails/welcome.tsx",
        baseRev: "rev_1",
        resolution: { content: "merged source" },
      }),
    );
    expect((await view.findByTestId("lifecycle-sheet.notice")).textContent).toContain(
      "Resolved emails/welcome.tsx",
    );
  });

  it("flushes queued edits before resolving against the acknowledged revision", async () => {
    let releaseSave: ((result: { readonly rev: string }) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<{ readonly rev: string }>((resolve) => {
          releaseSave = resolve;
        }),
    );
    const conflicted = {
      ...state(true),
      conflicts: [
        {
          path: "emails/welcome.tsx",
          base: "base source",
          draft: "draft source",
          main: "main source",
        },
      ],
    };
    const resolveConflict = vi.fn(() => Promise.resolve({ ...state(), rev: "rev_3" }));
    const storeRef: EditorStoreRef = { current: null };
    const view = render(
      <EditorProvider
        host={hostFor(
          lifecycleApi({ inspect: () => Promise.resolve(conflicted), resolveConflict }),
          save,
        )}
      >
        <StoreProbe target={storeRef} />
        <LifecycleSheet open onClose={() => {}} />
      </EditorProvider>,
    );

    const keepDraft = await view.findByTestId("lifecycle-sheet.keep-draft");
    act(() => {
      storeRef.current
        ?.getState()
        .actions.replaceAuthoredSource("export default function Edited() {}");
    });
    fireEvent.click(keepDraft);

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(resolveConflict).not.toHaveBeenCalled();
    expect(storeRef.current?.getState().lifecycleBusy).toBe(true);

    releaseSave?.({ rev: "rev_2" });
    await waitFor(() =>
      expect(resolveConflict).toHaveBeenCalledWith({
        path: "emails/welcome.tsx",
        baseRev: "rev_2",
        resolution: "draft",
      }),
    );
    expect(storeRef.current?.getState().lifecycleBusy).toBe(false);
  });

  it("edits a selected project file through the workspace lifecycle", async () => {
    const project = {
      ...state(false),
      files: [
        { path: "emails/welcome.tsx", status: "clean" as const, content: "welcome source" },
        { path: "theme.ts", status: "clean" as const, content: "theme source" },
      ],
    };
    const updated = {
      ...project,
      rev: "rev_2",
      dirty: true,
      files: project.files.map((file) =>
        file.path === "theme.ts"
          ? { ...file, status: "modified" as const, content: "updated theme" }
          : file,
      ),
    };
    const updateFile = vi.fn(() => Promise.resolve(updated));
    const view = mount({
      inspect: () => Promise.resolve(project),
      updateFile,
    });

    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.theme.ts"));
    const source = await view.findByTestId("lifecycle-sheet.file-source.theme.ts");
    fireEvent.change(source, { target: { value: "updated theme" } });
    fireEvent.click(await view.findByTestId("lifecycle-sheet.apply-file.theme.ts"));

    await waitFor(() =>
      expect(updateFile).toHaveBeenCalledWith({
        path: "theme.ts",
        baseRev: "rev_1",
        content: "updated theme",
      }),
    );
    expect((await view.findByTestId("lifecycle-sheet.notice")).textContent).toContain(
      "Updated theme.ts",
    );
  });

  it("locks a project file draft while Apply is pending", async () => {
    const project = {
      ...state(false),
      files: [
        { path: "emails/welcome.tsx", status: "clean" as const, content: "welcome source" },
        { path: "theme.ts", status: "clean" as const, content: "theme source" },
      ],
    };
    const updated = {
      ...project,
      rev: "rev_2",
      dirty: true,
      files: project.files.map((file) =>
        file.path === "theme.ts"
          ? { ...file, status: "modified" as const, content: "submitted theme" }
          : file,
      ),
    };
    let finishUpdate: ((state: ProjectLifecycleState) => void) | undefined;
    const updateFile = vi.fn(
      () =>
        new Promise<ProjectLifecycleState>((resolve) => {
          finishUpdate = resolve;
        }),
    );
    const view = mount({
      inspect: () => Promise.resolve(project),
      updateFile,
    });

    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.theme.ts"));
    const source = (await view.findByTestId(
      "lifecycle-sheet.file-source.theme.ts",
    )) as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: "submitted theme" } });
    fireEvent.click(await view.findByTestId("lifecycle-sheet.apply-file.theme.ts"));

    await waitFor(() => expect(updateFile).toHaveBeenCalledOnce());
    expect(source.disabled).toBe(true);
    finishUpdate?.(updated);
    await waitFor(() =>
      expect(
        (view.getByTestId("lifecycle-sheet.file-source.theme.ts") as HTMLTextAreaElement).disabled,
      ).toBe(false),
    );
  });

  it("keeps a selected file when the document revision changes", async () => {
    let emitChange: ((change: DocumentChange) => void) | undefined;
    const project = {
      ...state(false),
      files: [
        { path: "emails/welcome.tsx", status: "clean" as const, content: "welcome source" },
        { path: "theme.ts", status: "clean" as const, content: "theme source" },
      ],
    };
    const nextProject = { ...project, rev: "rev_2" };
    let inspectionCount = 0;
    const inspect = vi.fn(() => Promise.resolve(inspectionCount++ === 0 ? project : nextProject));
    const api = lifecycleApi({ inspect });
    const host = {
      ...hostFor(api),
      document: {
        open: (onChange) => {
          emitChange = onChange;
          return Promise.resolve({ initial: document, close: () => {} });
        },
      },
    } as AsyncEditorHost;
    const view = render(
      <EditorProvider host={host}>
        <LifecycleSheet open onClose={() => {}} />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.theme.ts"));
    const source = await view.findByTestId("lifecycle-sheet.file-source.theme.ts");
    fireEvent.change(source, { target: { value: "local draft" } });
    emitChange?.(externalChange("rev_2"));

    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    expect(
      ((await view.findByTestId("lifecycle-sheet.file-source.theme.ts")) as HTMLTextAreaElement)
        .value,
    ).toBe("local draft");
  });

  it("resets a file draft when the selected file changes externally", async () => {
    let emitChange: ((change: DocumentChange) => void) | undefined;
    const project = {
      ...state(false),
      files: [
        { path: "emails/welcome.tsx", status: "clean" as const, content: "welcome source" },
        { path: "theme.ts", status: "clean" as const, content: "theme source" },
      ],
    };
    const nextProject = {
      ...project,
      rev: "rev_2",
      files: project.files.map((file) =>
        file.path === "theme.ts" ? { ...file, content: "external source" } : file,
      ),
    };
    let externallyChanged = false;
    const inspect = vi.fn(() => Promise.resolve(externallyChanged ? nextProject : project));
    const api = lifecycleApi({ inspect });
    const host = {
      ...hostFor(api),
      document: {
        open: (onChange) => {
          emitChange = onChange;
          return Promise.resolve({ initial: document, close: () => {} });
        },
      },
    } as AsyncEditorHost;
    const view = render(
      <EditorProvider host={host}>
        <LifecycleSheet open onClose={() => {}} />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId("lifecycle-sheet.file.theme.ts"));
    const source = await view.findByTestId("lifecycle-sheet.file-source.theme.ts");
    fireEvent.change(source, { target: { value: "local draft" } });
    externallyChanged = true;
    emitChange?.(externalChange("rev_2"));

    await waitFor(() => {
      expect(
        (view.getByTestId("lifecycle-sheet.file-source.theme.ts") as HTMLTextAreaElement).value,
      ).toBe("external source");
    });
  });
});
