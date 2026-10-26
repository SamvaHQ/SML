/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import {
  contractVersion,
  DocumentConflict,
  DocumentUnavailable,
  type AsyncEditableEditorHost,
  type DocumentChange,
  type DocumentUpdate,
  type EditableEmailDocument,
} from "@samva/editor/host";
import { previewEmail } from "@samva/markup/edit";
import { compileIssue } from "@samva/markup/markdown";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import { EditorProvider } from "../src/state/provider";
import { useEditorProbe, type EditorProbe } from "./store-probe";

afterEach(cleanup);

const FILE = "issues/news.md";
const HEADER = "---\ntitle: News\nslug: news\ntopic: product\n---\n\n";
const LAYOUT = `import {defineTemplate} from "@samva/markup";
import {jsonSchema} from "@samva/markup/input-schema";
import {Email,IssueContent} from "@samva/markup/email";
export default defineTemplate({id:"layout",schema:jsonSchema({type:"object",properties:{}}),fixtures:{reader:{}},email:{subject:()=>"News",body:()=> <Email><IssueContent /></Email>}});`;

const harness = async (body = "Hello\n\nNeighbor") => {
  let source = HEADER + body;
  let rev = "rev_1";
  let counter = 1;
  let receive: ((change: DocumentChange) => void) | undefined;
  let delayRender = false;
  const delayed: DocumentChange[] = [];
  const content = async () => {
    const compiled = await compileIssue({
      files: { "layout.tsx": LAYOUT, [FILE]: source },
      entry: FILE,
      assetBase: "",
      tailwind: false,
    });
    if (compiled.template === undefined) throw new Error(JSON.stringify(compiled.diagnostics));
    const preview = previewEmail(compiled.template, compiled.fixtures.reader);
    return {
      channel: "email" as const,
      preview: { status: "current" as const },
      fixture: "reader",
      fixtures: ["reader"],
      render: {
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
        selections: preview.selections,
        ...(preview.preheader === undefined ? {} : { preheader: preview.preheader }),
        revision: rev,
      },
      diagnostics: compiled.diagnostics,
      incompatibilities: [],
    };
  };
  const initial: EditableEmailDocument = {
    id: "news",
    name: "News",
    rev,
    origin: {
      kind: "markdown",
      file: FILE,
      authoredSource: source,
      layout: { file: "layout.tsx" },
    },
    variables: [],
    metadata: {},
    access: { kind: "editable" },
    ...(await content()),
  };
  const save = vi.fn<AsyncEditableEditorHost["writer"]["save"]>(async (update) => {
    if (update.kind !== "authoredSource") return { rev };
    if (update.baseRev !== rev)
      throw new DocumentConflict({ expectedRev: update.baseRev, actualRev: rev });
    source = update.authoredSource;
    rev = `rev_${++counter}`;
    const change: DocumentChange = {
      rev,
      origin: "self",
      authoredSource: source,
      ...(await content()),
    };
    if (delayRender) delayed.push(change);
    else receive?.(change);
    return { rev };
  });
  const host: AsyncEditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: {
      open: async (onChange) => {
        receive = onChange;
        return {
          initial,
          close: () => {
            receive = undefined;
          },
        };
      },
    },
    writer: { save },
  };
  let probe!: EditorProbe;
  function Probe() {
    probe = useEditorProbe();
    return null;
  }
  const view = render(
    <EditorProvider host={host}>
      <Probe />
    </EditorProvider>,
  );
  await waitFor(() => expect(probe.doc).not.toBeNull());
  const paragraphs = () =>
    probe.render!.selections.filter(
      (item) => item.tag === "p" && item.origins[0]?.fileName === FILE,
    );
  const path = paragraphs()[0]!.instancePath;
  act(() => probe.select(path));
  return {
    get probe() {
      return probe;
    },
    get source() {
      return source;
    },
    save,
    path,
    view,
    paragraphs,
    external: async (text: string) => {
      source = HEADER + text;
      rev = `rev_${++counter}`;
      receive?.({ rev, origin: "external", authoredSource: source, ...(await content()) });
    },
    writes: () =>
      save.mock.calls
        .map(([input]) => input)
        .filter(
          (input): input is Extract<DocumentUpdate, { kind: "authoredSource" }> =>
            input.kind === "authoredSource",
        ),
    delayRender: () => {
      delayRender = true;
    },
    deliverRender: () => {
      const change = delayed.shift();
      if (change === undefined) throw new Error("No delayed render");
      receive?.(change);
    },
  };
};

describe("Markdown as the open source document", () => {
  it("reads and edits prose without a project lifecycle, keeping source and history in sync", async () => {
    const editor = await harness();
    expect(await editor.probe.inspectMarkdown(editor.path)).toMatchObject({
      properties: [{ name: "children", value: "Hello" }],
    });
    act(() => editor.probe.editMarkdownText(editor.path, "Welcome"));
    await waitFor(() => expect(editor.source).toBe(HEADER + "Welcome\n\nNeighbor"));
    await waitFor(() => expect(editor.probe.lifecycleBusy).toBe(false));
    expect(editor.writes()[0]?.baseRev).toBe("rev_1");
    expect(editor.probe.doc?.origin.authoredSource).toBe(editor.source);
    expect(editor.probe.render?.html).toContain("Welcome");
    act(() => editor.probe.undo());
    await act(() => editor.probe.flushSaves());
    expect(editor.source).toBe(HEADER + "Hello\n\nNeighbor");
  });

  it("replaces frontmatter and applies a revision-fenced Markdown span patch", async () => {
    const editor = await harness();
    const changed = editor.source.replace("title: News", "title: Updated");
    act(() => editor.probe.replaceAuthoredSource(changed));
    await act(() => editor.probe.flushSaves());
    expect(editor.source).toBe(changed);
    act(() =>
      editor.probe.applySourceEdit({
        revision: editor.probe.doc!.rev,
        source: changed,
        edits: [
          {
            start: changed.indexOf("Hello"),
            end: changed.indexOf("Hello") + 5,
            before: "Hello",
            after: "Hi",
          },
        ],
      }),
    );
    await act(() => editor.probe.flushSaves());
    expect(editor.source).toBe(changed.replace("Hello", "Hi"));
    expect(editor.writes().map((input) => input.baseRev)).toEqual(["rev_1", "rev_2"]);
  });

  it("keeps the latest typing during a save and resolves shifted neighbors in the new render", async () => {
    const editor = await harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = editor.save.getMockImplementation()!;
    editor.save.mockImplementationOnce(async (input) => {
      await gate;
      return write(input);
    });
    act(() => editor.probe.editMarkdownText(editor.path, "A much longer paragraph"));
    await waitFor(() => expect(editor.save).toHaveBeenCalledTimes(1));
    act(() => editor.probe.editMarkdownText(editor.path, "A much longer paragraph again"));
    const other = editor.paragraphs()[1]!.instancePath;
    act(() => editor.probe.select(other));
    act(() => editor.probe.editMarkdownText(other, "Neighbor updated"));
    await act(async () => release());
    await waitFor(() =>
      expect(editor.source).toBe(HEADER + "A much longer paragraph again\n\nNeighbor updated"),
    );
    expect(editor.writes().map((input) => input.baseRev)).toEqual(["rev_1", "rev_2", "rev_3"]);
    expect(editor.probe.sourceEditError).toBeNull();
  });

  it("drops queued spans after an external source edit", async () => {
    const editor = await harness();
    act(() => editor.probe.editMarkdownText(editor.path, "Queued"));
    await act(() => editor.external("Someone else's text"));
    await waitFor(() => expect(editor.probe.sourceEditError).toContain("Select it again"));
    expect(editor.save).not.toHaveBeenCalled();
    expect(editor.source).toBe(HEADER + "Someone else's text");
  });

  it("keeps the local source when the host rejects its revision", async () => {
    const editor = await harness();
    editor.save.mockRejectedValueOnce(
      new DocumentConflict({ expectedRev: "rev_1", actualRev: "rev_external" }),
    );
    act(() => editor.probe.editMarkdownText(editor.path, "Local edit"));
    await waitFor(() => expect(editor.probe.conflict).toBe(true));
    expect(editor.probe.doc?.origin.authoredSource).toContain("Local edit");
    expect(editor.source).toBe(HEADER + "Hello\n\nNeighbor");
  });

  it("retains typing after the save acknowledges but before its render arrives", async () => {
    const editor = await harness();
    editor.delayRender();
    act(() => editor.probe.editMarkdownText(editor.path, "First"));
    await waitFor(() => expect(editor.probe.doc?.rev).toBe("rev_2"));
    expect(editor.probe.render?.revision).toBe("rev_1");
    act(() => editor.probe.editMarkdownText(editor.path, "First plus latest typing"));
    expect(editor.probe.sourceEditError).toBeNull();
    act(() => editor.deliverRender());
    await waitFor(() => expect(editor.source).toContain("First plus latest typing"));
    act(() => editor.deliverRender());
    await waitFor(() => expect(editor.probe.lifecycleBusy).toBe(false));
    expect(editor.writes().map((input) => input.baseRev)).toEqual(["rev_1", "rev_2"]);
  });

  it("never rebases queued prose onto an external change through a delayed self render", async () => {
    const editor = await harness();
    editor.delayRender();
    act(() => editor.probe.editMarkdownText(editor.path, "First"));
    await waitFor(() => expect(editor.probe.doc?.rev).toBe("rev_2"));
    act(() => editor.probe.editMarkdownText(editor.path, "Queued"));
    await act(() => editor.external("External text"));
    act(() => editor.deliverRender());
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(editor.writes()).toHaveLength(1);
    expect(editor.source).toBe(HEADER + "External text");
    expect(editor.probe.doc?.origin.authoredSource).toBe(editor.source);
    expect(editor.probe.doc?.rev).toBe("rev_3");
    expect(editor.probe.lifecycleBusy).toBe(false);
  });

  it("keeps text typed during an unavailable save through Retry", async () => {
    const editor = await harness();
    let reject!: (cause: unknown) => void;
    editor.save.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    act(() => editor.probe.editMarkdownText(editor.path, "First"));
    await waitFor(() => expect(editor.save).toHaveBeenCalledTimes(1));
    act(() => editor.probe.editMarkdownText(editor.path, "First plus latest typing"));
    await act(async () => reject(new DocumentUnavailable({ reason: "Offline" })));
    await waitFor(() => expect(editor.probe.storageError).toBe("Offline"));
    act(() => editor.probe.retrySave());
    await waitFor(() => expect(editor.source).toContain("First plus latest typing"));
    await waitFor(() => expect(editor.probe.lifecycleBusy).toBe(false));
    expect(editor.probe.storageError).toBeNull();
    expect(editor.probe.doc?.origin.authoredSource).toBe(editor.source);
  });
});
