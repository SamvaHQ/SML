/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import type { AsyncEditorHost } from "@samva/editor/host";
import { previewEmail } from "@samva/markup/edit";
import { compileIssue } from "@samva/markup/markdown";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { SourceWorkspace } from "../src/channels/source-workspace";
import { SourceControls } from "../src/chrome/source-controls";
import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { mockEditor } from "./mock-host";
import { useEditorProbe, type EditorProbe } from "./store-probe";

afterEach(cleanup);

const LAYOUT = "layout.tsx";
const ISSUE = "issues/news.md";
const issue = "---\ntitle: News\nslug: news\ntopic: product\n---\nHello";
const layout = `import {defineTemplate} from "@samva/markup";
import {jsonSchema} from "@samva/markup/input-schema";
import {Email,IssueContent} from "@samva/markup/email";
export default defineTemplate({id:"layout",schema:jsonSchema({type:"object",properties:{}}),fixtures:{welcome:{}},email:{subject:()=>"News",body:()=> <Email><IssueContent /></Email>}});`;

/** A host whose email document is a Markdown issue inside a static layout. */
const markdownDocument = async () => {
  const base = await mockEditor();
  const compiled = await compileIssue({
    files: { [LAYOUT]: layout, [ISSUE]: issue },
    entry: ISSUE,
    assetBase: "",
    tailwind: false,
  });
  if (compiled.template === undefined) throw new Error(JSON.stringify(compiled.diagnostics));
  const preview = previewEmail(compiled.template, compiled.fixtures.welcome);
  const host = {
    ...base.host,
    document: {
      open: async (...args: Parameters<typeof base.host.document.open>) => {
        const opened = await base.host.document.open(...args);
        if (opened.initial.channel !== "email") throw new Error("Expected email document");
        return {
          ...opened,
          initial: {
            ...opened.initial,
            origin: {
              kind: "markdown" as const,
              file: ISSUE,
              authoredSource: issue,
              layout: { file: LAYOUT },
            },
            render: {
              subject: preview.subject,
              html: preview.html,
              text: preview.text,
              selections: preview.selections,
              revision: opened.initial.rev,
            },
          },
        };
      },
    },
  } satisfies AsyncEditorHost;
  return { host, selections: preview.selections };
};

describe("Markdown source documents", () => {
  it("shows the authored Markdown and edits it through the source", async () => {
    const { host } = await markdownDocument();
    let probe!: EditorProbe;
    function Probe() {
      probe = useEditorProbe();
      return null;
    }
    const view = render(
      <EditorProvider host={host}>
        <Probe />
        <SourceWorkspace />
      </EditorProvider>,
    );
    const field = (await view.findByTestId(
      "source-workspace.authored-markdown",
    )) as HTMLTextAreaElement;
    expect(field.value).toBe(issue);
    expect(view.queryByTestId("source-workspace.authored-tsx")).toBeNull();
    expect(field.getAttribute("aria-label")).toBe(`Authored Markdown · ${ISSUE}`);
    fireEvent.change(field, { target: { value: issue.replace("Hello", "Welcome") } });
    await waitFor(() => expect(probe.doc?.origin.authoredSource).toContain("Welcome"));
  });

  it("offers text controls for the issue's own spans and nothing TSX for the layout's", async () => {
    const { host, selections } = await markdownDocument();
    const own = selections.find((item) => item.tag === "p" && item.origins[0]?.fileName === ISSUE)!;
    const layoutSpan = selections.find((item) => item.origins[0]?.fileName === LAYOUT)!;
    function Controls({ path }: { readonly path: string }) {
      const entry = useEditorStore((state) =>
        state.render?.selections.find((item) => item.instancePath === path),
      );
      return entry === undefined ? null : <SourceControls selection={entry} />;
    }
    const mount = (path: string) =>
      render(
        <EditorProvider host={host}>
          <Controls path={path} />
        </EditorProvider>,
      );
    const prose = mount(own.instancePath);
    // The host here offers no project files, so the text itself is not readable; what matters is
    // that the Markdown controls, not the TSX ones, own the span.
    await prose.findByTestId("markdown.unavailable");
    expect(prose.queryByTestId("source.unavailable")).toBeNull();
    cleanup();
    const frame = mount(layoutSpan.instancePath);
    const note = await frame.findByTestId("source.layout-readonly");
    expect(note.textContent).toContain(LAYOUT);
    expect(frame.queryByTestId("markdown.text")).toBeNull();
    expect(frame.container.querySelector("[data-slot=editor-element-controls]")).toBeNull();
  });
});
