/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type {
  AsyncEditorHost,
  AsyncLifecycleApi,
  AsyncReadonlyEditorHost,
  ProjectLifecycleState,
} from "@samva/editor/host";
import { previewEmail } from "@samva/markup/edit";
import { compileIssue } from "@samva/markup/markdown";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";

import { MarkdownControls } from "../src/chrome/markdown-controls";
import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { emitChange, mockEditor } from "./mock-host";
import { useEditorProbe, type EditorProbe } from "./store-probe";

afterEach(cleanup);

const ENTRY = "layout.tsx";
const ISSUE = "issues/news.md";
const metadata = "---\ntitle: News\nslug: news\ntopic: product\n---\n";
const layout = `import {defineTemplate} from "@samva/markup";
import {jsonSchema} from "@samva/markup/input-schema";
import {Email,IssueContent} from "@samva/markup/email";
export default defineTemplate({id:"layout",schema:jsonSchema({type:"object",properties:{}}),fixtures:{welcome:{}},email:{subject:()=>"News",body:()=> <Email><IssueContent /></Email>}});`;

const unused = (): never => {
  throw new Error("Unscripted lifecycle operation");
};

const harness = async (
  body = "Hello",
  mode: "editable" | "readonly" | "no-lifecycle" = "editable",
  extra: ReactNode = null,
) => {
  const base = await mockEditor();
  const project: Record<string, string> = { [ENTRY]: layout, [ISSUE]: metadata + body };
  const fileWrites: Parameters<AsyncLifecycleApi["updateFile"]>[0][] = [];
  const buildRender = async () => {
    const compiled = await compileIssue({
      files: project,
      entry: ISSUE,
      assetBase: "",
      tailwind: false,
    });
    if (compiled.template === undefined) throw new Error(JSON.stringify(compiled.diagnostics));
    const preview = previewEmail(compiled.template, compiled.fixtures.welcome);
    return {
      subject: preview.subject,
      ...(preview.preheader === undefined ? {} : { preheader: preview.preheader }),
      html: preview.html,
      text: preview.text,
      selections: preview.selections,
    };
  };
  let preview = await buildRender();
  let revision = "rev_1";
  const state = (): ProjectLifecycleState => ({
    rev: revision,
    baseCommit: "c1",
    remoteHead: "c1",
    dirty: false,
    files: Object.entries(project).map(([path, content]) => ({ path, content, status: "clean" })),
    conflicts: [],
    commits: [],
  });
  const inspect = vi.fn(async () => state());
  const api: AsyncLifecycleApi = {
    inspect,
    updateFile: async (input) => {
      fileWrites.push(input);
      if (input.content !== null) project[input.path] = input.content;
      revision = "rev_2";
      return state();
    },
    publish: unused,
    restore: unused,
    resolveConflict: unused,
    putAsset: unused,
  };
  const editable = {
    ...base.host,
    ...(mode === "no-lifecycle" ? {} : { lifecycle: { status: "ready" as const, api } }),
    document: {
      open: async (
        ...[onChange, onError, onComplete]: Parameters<typeof base.host.document.open>
      ) => {
        const opened = await base.host.document.open(
          (change) =>
            onChange(
              change.channel === "email"
                ? { ...change, render: { ...preview, revision: change.rev } }
                : change,
            ),
          onError,
          onComplete,
        );
        if (opened.initial.channel !== "email") throw new Error("Expected email document");
        return {
          ...opened,
          initial: {
            ...opened.initial,
            origin: { ...opened.initial.origin, file: ENTRY, authoredSource: layout },
            render: { ...preview, revision: opened.initial.rev },
          },
        };
      },
    },
  } satisfies AsyncEditorHost;
  const { writer: _writer, ...reader } = editable;
  const readonly: AsyncReadonlyEditorHost = {
    ...reader,
    access: "readonly",
    document: {
      open: async (...args) => {
        const opened = await editable.document.open(...args);
        return {
          ...opened,
          initial: { ...opened.initial, access: { kind: "readonly", reason: "Shared preview" } },
        };
      },
    },
  };
  let probe: EditorProbe;
  function Probe() {
    probe = useEditorProbe();
    return null;
  }
  const view = render(
    <EditorProvider host={mode === "readonly" ? readonly : editable}>
      <Probe />
      {extra}
    </EditorProvider>,
  );
  await waitFor(() => expect(probe.doc).not.toBeNull());
  const path = probe!.render!.selections.find(
    (item) => item.tag === "p" && item.origins[0]?.fileName === ISSUE,
  )!.instancePath;
  act(() => probe.select(path));
  return {
    get probe() {
      return probe!;
    },
    path,
    fileWrites,
    inspect,
    state,
    view,
    publish: async (nextBody?: string) => {
      if (nextBody !== undefined) project[ISSUE] = metadata + nextBody;
      preview = await buildRender();
      revision = "rev_2";
      await emitChange(base, { origin: "external", authoredSource: layout });
    },
  };
};

describe("Markdown editing through the real editor store", () => {
  it("reads the selected prose and saves the exact content through the lifecycle", async () => {
    const editor = await harness();
    expect(await editor.probe.inspectMarkdown(editor.path)).toMatchObject({
      tag: "p",
      properties: [{ name: "children", value: "Hello" }],
    });
    const before = editor.probe.render;
    act(() => editor.probe.editMarkdownText(editor.path, "Welcome"));
    await waitFor(() => expect(editor.fileWrites).toHaveLength(1));
    expect(editor.fileWrites[0]).toEqual({
      path: ISSUE,
      baseRev: "rev_1",
      content: metadata + "Welcome",
    });
    expect(editor.probe.doc?.origin).toMatchObject({
      kind: "tsx",
      file: ENTRY,
      authoredSource: layout,
    });
    expect(editor.probe.render).toBe(before);
    await act(() => editor.publish());
    await waitFor(() => expect(editor.probe.render?.html).toContain("Welcome"));
  });

  it("coalesces a burst of typing into the latest text", async () => {
    const editor = await harness();
    act(() => editor.probe.editMarkdownText(editor.path, "W"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    act(() => {
      editor.probe.editMarkdownText(editor.path, "We");
      editor.probe.editMarkdownText(editor.path, "Welcome");
    });
    await waitFor(() => expect(editor.fileWrites).toHaveLength(1));
    expect(editor.fileWrites[0]?.content).toBe(metadata + "Welcome");
    expect(editor.inspect).toHaveBeenCalledTimes(1);
  });

  it("refuses mixed prose and formatting without writing", async () => {
    const editor = await harness("[Read](https://example.com) more");
    act(() => editor.probe.editMarkdownText(editor.path, "Replacement"));
    await waitFor(() => expect(editor.probe.sourceEditError).toContain("includes formatting"));
    expect(editor.fileWrites).toEqual([]);
    expect(editor.probe.lifecycleBusy).toBe(false);
  });

  it.each(["readonly", "no-lifecycle"] as const)(
    "does not write through a %s host",
    async (mode) => {
      const editor = await harness("Hello", mode);
      expect(await editor.probe.inspectMarkdown(editor.path)).toBeNull();
      act(() => editor.probe.editMarkdownText(editor.path, "Changed"));
      expect(editor.probe.sourceEditError).not.toBeNull();
      expect(editor.inspect).not.toHaveBeenCalled();
      expect(editor.fileWrites).toEqual([]);
    },
  );

  it("drops a queued edit when a newer document occupies the same path", async () => {
    const editor = await harness();
    act(() => editor.probe.editMarkdownText(editor.path, "Changed"));
    await act(() => editor.publish("Other content"));
    await waitFor(() => expect(editor.probe.sourceEditError).toContain("Select it again"));
    expect(editor.fileWrites).toEqual([]);
  });

  it("rechecks the selection after the asynchronous project inspection", async () => {
    const editor = await harness();
    let finish!: (state: ProjectLifecycleState) => void;
    editor.inspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => editor.probe.editMarkdownText(editor.path, "Changed"));
    await waitFor(() => expect(editor.inspect).toHaveBeenCalledTimes(1));
    act(() => editor.probe.selectDocument());
    await act(async () => finish(editor.state()));
    await waitFor(() => expect(editor.probe.lifecycleBusy).toBe(false));
    expect(editor.probe.sourceEditError).toContain("Select it again");
    expect(editor.fileWrites).toEqual([]);
  });

  it("cancels pending writes when the provider unmounts", async () => {
    const editor = await harness();
    act(() => editor.probe.editMarkdownText(editor.path, "Changed"));
    editor.view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(editor.fileWrites).toEqual([]);
    expect(editor.inspect).not.toHaveBeenCalled();
  });

  it("reports a read failure and releases the lifecycle gate", async () => {
    const editor = await harness();
    editor.inspect.mockRejectedValueOnce(new Error("Unavailable"));
    act(() => editor.probe.editMarkdownText(editor.path, "Changed"));
    await waitFor(() =>
      expect(editor.probe.sourceEditError).toBe("Couldn't save this change. Try again."),
    );
    expect(editor.probe.lifecycleBusy).toBe(false);
    expect(editor.fileWrites).toEqual([]);
  });

  it("refuses edits while the assistant or another lifecycle operation owns the project", async () => {
    const editor = await harness();
    act(() => editor.probe.setHostBusy(true));
    act(() => editor.probe.editMarkdownText(editor.path, "Changed"));
    expect(editor.probe.sourceEditError).not.toBeNull();
    act(() => {
      editor.probe.setHostBusy(false);
      editor.probe.beginLifecycle();
    });
    act(() => editor.probe.editMarkdownText(editor.path, "Changed again"));
    expect(editor.inspect).not.toHaveBeenCalled();
    expect(editor.fileWrites).toEqual([]);
  });

  it("edits the selected text from the inspector without naming the file", async () => {
    function SelectedControls() {
      const selection = useEditorStore((state) => state.selection);
      const selections = useEditorStore((state) => state.render?.selections);
      const entry =
        selection.kind === "element"
          ? selections?.find((item) => item.instancePath === selection.instancePath)
          : undefined;
      return entry === undefined ? null : <MarkdownControls selection={entry} />;
    }
    const editor = await harness("Hello", "editable", <SelectedControls />);
    const field = (await editor.view.findByTestId("markdown.text")) as HTMLTextAreaElement;
    expect(field.value).toBe("Hello");
    expect(editor.view.container.textContent).not.toContain(ISSUE);
    fireEvent.change(field, { target: { value: "Welcome" } });
    await waitFor(() => expect(editor.fileWrites).toHaveLength(1));
    expect(editor.fileWrites[0]?.content).toBe(metadata + "Welcome");
  });

  it("reads the text again after its own save is rendered", async () => {
    const editor = await harness();
    act(() => editor.probe.editMarkdownText(editor.path, "Welcome, friend."));
    await waitFor(() => expect(editor.fileWrites).toHaveLength(1));
    await act(() => editor.publish("Welcome\\, friend\\."));
    await waitFor(() => expect(editor.probe.render?.html).toContain("Welcome, friend."));
    expect(editor.probe.selection.kind).toBe("element");
    expect(await editor.probe.inspectMarkdown(editor.path)).toMatchObject({
      properties: [{ name: "children", value: "Welcome, friend." }],
    });
  });
});
