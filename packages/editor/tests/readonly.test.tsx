/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { ReadonlyEditorDocument } from "@samva/editor/host";
import type { AsyncReadonlyEditorHost } from "@samva/editor/host";
import { MOCK_FIXTURE_NAMES } from "@samva/editor/mock";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { EditorShell } from "../src/chrome/shell";
import { EditorProvider } from "../src/state/provider";
import { emitChange, mockEditor, settle, type MockEditor } from "./mock-host";
import { useEditorProbe, type EditorProbe } from "./store-probe";

afterEach(cleanup);

const REASON = "This template is managed in code.";

const READONLY_ACCESS: ReadonlyEditorDocument["access"] = { kind: "readonly", reason: REASON };

/**
 * The mock host presented the way a code-owned template reaches the editor: the
 * same executed render and change stream, with a read-only document and no
 * writer at the type level.
 */
const readonlyEditor = async (): Promise<{
  readonly editor: MockEditor;
  readonly host: AsyncReadonlyEditorHost;
}> => {
  const editor = await mockEditor();
  const host: AsyncReadonlyEditorHost = {
    contractVersion: editor.host.contractVersion,
    access: "readonly",
    sourceAccess: "readonly",
    fixtures: editor.host.fixtures,
    assets: editor.host.assets,
    lifecycle: {
      status: "ready",
      api: {
        inspect: vi.fn(),
        publish: vi.fn(),
        restore: vi.fn(),
        resolveConflict: vi.fn(),
        updateFile: vi.fn(),
        putAsset: vi.fn(),
      },
    },
    document: {
      open: async (onChange, onError, onComplete) => {
        const opened = await editor.host.document.open(onChange, onError, onComplete);
        return {
          initial: { ...opened.initial, access: READONLY_ACCESS },
          close: opened.close,
        };
      },
    },
  };
  return { editor, host };
};

function ActionProbe({ onReady }: { onReady: (value: EditorProbe) => void }) {
  const editor = useEditorProbe();
  onReady(editor);
  return (
    <>
      <output data-testid="authored">{editor.doc?.origin.authoredSource ?? ""}</output>
      <output data-testid="name">{editor.doc?.name ?? ""}</output>
      <output data-testid="fixture">
        {editor.doc?.channel === "email" ? (editor.doc.fixture ?? "") : ""}
      </output>
      <output data-testid="subject">{editor.render?.subject ?? ""}</output>
      <output data-testid="access">{editor.editable ? "editable" : editor.readonlyReason}</output>
      <output data-testid="source-editable">{String(editor.sourceEditable)}</output>
    </>
  );
}

describe("readonly documents", () => {
  it("centrally rejects every write action while live external changes still refresh", async () => {
    const { editor, host } = await readonlyEditor();
    // A host that contradicts its own `access` must still be refused: the gate is
    // the document, not the absence of a callable writer. The type forbids that
    // writer, so it is attached at runtime.
    const unreachableSave = vi.fn(() => Promise.resolve({ rev: "impossible" }));
    const malformedHost = Object.defineProperty({ ...host }, "writer", {
      value: { save: unreachableSave },
      enumerable: true,
    });

    let probe: EditorProbe | null = null;
    const view = render(
      <EditorProvider host={malformedHost}>
        <ActionProbe onReady={(value) => (probe = value)} />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("access").textContent).toBe(REASON));
    expect(view.getByTestId("source-editable").textContent).toBe("false");
    const authored = view.getByTestId("authored").textContent;

    act(() => {
      const value = probe!;
      value.replaceAuthoredSource("export default function Changed() {}");
      value.applySourceEdit({
        revision: value.doc?.rev ?? "",
        source: authored ?? "",
        edits: [{ start: 0, end: 0, before: "", after: "// changed\n" }],
      });
      value.rename("Changed");
      value.saveMetadata({ fromDefault: { email: "changed@example.com" } });
      value.retrySave();
    });

    expect(unreachableSave).not.toHaveBeenCalled();
    expect(view.getByTestId("name").textContent).toBe("Welcome — first bag on us");
    expect(view.getByTestId("authored").textContent).toBe(authored);

    await act(() =>
      emitChange(editor, {
        origin: "external",
        authoredSource: "export default function Updated() {}",
      }),
    );
    await waitFor(() => expect(view.getByTestId("authored").textContent).toContain("Updated"));
  });

  it("still views another fixture, because rendering one is not an edit", async () => {
    const { host } = await readonlyEditor();
    let probe: EditorProbe | null = null;
    const view = render(
      <EditorProvider host={host}>
        <ActionProbe onReady={(value) => (probe = value)} />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId("fixture").textContent).toBe(MOCK_FIXTURE_NAMES[0]),
    );

    await act(async () => {
      probe!.viewFixture(MOCK_FIXTURE_NAMES[1]!);
      await settle();
    });

    await waitFor(() =>
      expect(view.getByTestId("fixture").textContent).toBe(MOCK_FIXTURE_NAMES[1]),
    );
    expect(view.getByTestId("subject").textContent).toContain("Grace");
    expect(view.getByTestId("access").textContent).toBe(REASON);
  });

  it("hides mutation affordances while preserving preview chrome", async () => {
    const { host } = await readonlyEditor();
    const view = render(
      <EditorProvider host={host}>
        <EditorShell exportable />
      </EditorProvider>,
    );

    await waitFor(() => view.getByTestId("topbar.readonly-badge"));
    expect(view.getByTestId("topbar.name").getAttribute("contenteditable")).toBe("false");
    // The host declares a ready lifecycle; a read-only document still has nothing to publish.
    expect(view.queryByTestId("topbar.publish")).toBeNull();
    expect(view.queryByTestId("topbar.preview")).not.toBeNull();
    expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();

    // The authored entry is readable but not typable when the host owns the source.
    fireEvent.click(view.getByTestId("workspace.tab.source"));
    expect(
      (view.getByTestId("source-workspace.authored-tsx") as HTMLTextAreaElement).readOnly,
    ).toBe(true);
  });
});
