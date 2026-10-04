/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { SourceHistory } from "../src/chrome/source-controls";
import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { emitChange, mockEditor } from "./mock-host";

afterEach(cleanup);
function Probe() {
  const doc = useEditorStore((state) => state.doc);
  const actions = useEditorStore((state) => state.actions);
  return (
    <>
      <output data-testid="source">{doc?.origin.authoredSource}</output>
      <button
        data-testid="probe.edit"
        type="button"
        onClick={() => {
          if (doc !== null)
            actions.applySourceEdit({
              revision: doc.rev,
              source: doc.origin.authoredSource,
              edits: [{ start: 0, end: 0, before: "", after: "// Visual edit\n" }],
            });
        }}
      >
        Edit source
      </button>
      <button
        data-testid="probe.stale"
        type="button"
        onClick={() => {
          if (doc !== null)
            actions.applySourceEdit({
              revision: "stale",
              source: doc.origin.authoredSource,
              edits: [],
            });
        }}
      >
        Stale edit
      </button>
      <button
        data-testid="probe.flush"
        type="button"
        onClick={() => {
          void actions.flushSaves();
        }}
      >
        Flush
      </button>
      <SourceHistory />
    </>
  );
}

describe("source history persistence boundary", () => {
  it("undoes and redoes authored source through the real host writer", async () => {
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <Probe />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("source").textContent).toContain("WelcomeEmail"));
    const original = view.getByTestId("source").textContent!;
    fireEvent.click(view.getByTestId("probe.edit"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() =>
      expect(view.getByTestId("source").textContent).toBe(`// Visual edit\n${original}`),
    );
    fireEvent.click(view.getByTestId("source.undo"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() => expect(view.getByTestId("source").textContent).toBe(original));
    fireEvent.click(view.getByTestId("source.redo"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() =>
      expect(view.getByTestId("source").textContent).toBe(`// Visual edit\n${original}`),
    );
  });
  it("rejects stale revisions and preserves foreign edits when undo conflicts", async () => {
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <Probe />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("source").textContent).toContain("WelcomeEmail"));
    fireEvent.click(view.getByTestId("probe.stale"));
    expect(view.getByRole("alert").textContent).toContain("stale");
    fireEvent.click(view.getByTestId("probe.edit"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const foreign = `// Agent change\n${view.getByTestId("source").textContent!}`;
    await act(() => emitChange(editor, { origin: "agent", authoredSource: foreign }));
    fireEvent.click(view.getByTestId("source.undo"));
    expect(view.getByTestId("source").textContent).toBe(foreign);
    expect(view.getByRole("alert").textContent).toContain("History conflicts");
  });
});
