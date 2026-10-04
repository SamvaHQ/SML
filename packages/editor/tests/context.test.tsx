/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { AsyncEditableEditorHost } from "@samva/editor/host";
import { MOCK_FIXTURE_NAMES, NIMBUS_WELCOME_TSX } from "@samva/editor/mock";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { emitChange, mockEditor, settle, type MockEditor } from "./mock-host";

afterEach(cleanup);

const AGENT_TSX = NIMBUS_WELCOME_TSX.replace(
  "your first bag is on us",
  "your first bag is on the house",
);

/** The heading the mock renders — one authored element, one rendered instance. */
const HEADING_PATH = "0.0.1";
/** The Outlook wrapper the Button primitive generates around its anchor. */
const GENERATED_PATH = "0.0.3";

function DocumentProbe() {
  const { authoredSource, name, fromEmail, metadataError } = useEditorStore(
    useShallow((state) => ({
      authoredSource: state.doc?.origin.authoredSource ?? "",
      name: state.doc?.name ?? "(none)",
      fromEmail: state.doc?.metadata.fromDefault?.email ?? "(none)",
      metadataError: state.metadataError,
    })),
  );
  const { rename, saveMetadata } = useEditorStore((state) => state.actions);
  return (
    <>
      <output data-testid="authored">{authoredSource}</output>
      <output data-testid="name">{name}</output>
      <output data-testid="from">{fromEmail}</output>
      <output data-testid="error">{metadataError ?? "(no-error)"}</output>
      <button type="button" onClick={() => rename("Renamed")} data-testid="probe.rename">
        rename
      </button>
      <button
        type="button"
        onClick={() => saveMetadata({ fromDefault: { email: "new@nimbus.example" } })}
        data-testid="probe.save-meta"
      >
        save-meta
      </button>
    </>
  );
}

describe("open() subscription gap", () => {
  it("applies a change published during the open handshake", async () => {
    const editor = await mockEditor();
    // Publish after the subscription attaches but before `initial` is handed
    // back: the change must be replayed onto the document, never dropped.
    const host: AsyncEditableEditorHost = {
      ...editor.host,
      document: {
        open: async (onChange, onError, onComplete) => {
          const opened = await editor.host.document.open(onChange, onError, onComplete);
          await emitChange(editor, { origin: "agent", authoredSource: AGENT_TSX });
          return opened;
        },
      },
    };

    const view = render(
      <EditorProvider host={host}>
        <DocumentProbe />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("authored").textContent).toContain("on the house"));
  });

  it("delivers post-initial changes too", async () => {
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <DocumentProbe />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId("name").textContent).toBe("Welcome — first bag on us"),
    );

    await act(() => emitChange(editor, { origin: "external", authoredSource: AGENT_TSX }));
    await waitFor(() => expect(view.getByTestId("authored").textContent).toContain("on the house"));
  });
});

function SelectionProbe() {
  const { selection, fixture, revision, subject, outline } = useEditorStore(
    useShallow((state) => ({
      selection: state.selection,
      fixture: state.doc?.channel === "email" ? state.doc.fixture : null,
      revision: state.render?.revision ?? "(none)",
      subject: state.render?.subject ?? "(none)",
      outline: state.outline,
    })),
  );
  const { select, viewFixture } = useEditorStore((state) => state.actions);
  const selected = selection.kind === "element" ? outline?.index.get(selection.instancePath) : null;
  return (
    <>
      <output data-testid="selection">
        {selection.kind === "element"
          ? `${selection.instancePath}@${selection.revision}/${selection.fixture}`
          : selection.kind}
      </output>
      <output data-testid="selected-authoring">
        {selected === undefined || selected === null
          ? "(none)"
          : `${selected.tag}:${selected.authored ? "authored" : "generated"}:${
              selected.origins[0]?.lineNumber ?? "?"
            }`}
      </output>
      <output data-testid="render">{`${revision}/${fixture ?? "(none)"}`}</output>
      <output data-testid="subject">{subject}</output>
      <button type="button" data-testid="probe.select" onClick={() => select(HEADING_PATH)}>
        select heading
      </button>
      <button
        type="button"
        data-testid="probe.select-generated"
        onClick={() => select(GENERATED_PATH)}
      >
        select wrapper
      </button>
      <button type="button" data-testid="probe.select-missing" onClick={() => select("9.9")}>
        select missing
      </button>
      <button
        type="button"
        data-testid="probe.view-fixture"
        onClick={() => viewFixture(MOCK_FIXTURE_NAMES[1]!)}
      >
        view other fixture
      </button>
    </>
  );
}

const mountSelection = async (): Promise<{
  readonly editor: MockEditor;
  readonly view: ReturnType<typeof render>;
}> => {
  const editor = await mockEditor();
  const view = render(
    <EditorProvider host={editor.host}>
      <SelectionProbe />
    </EditorProvider>,
  );
  await waitFor(() => expect(view.getByTestId("render").textContent).toBe("rev_1/welcome"));
  return { editor, view };
};

describe("selection against the render it was taken from", () => {
  it("resolves a click to one rendered instance, pinned to the revision and fixture", async () => {
    const { view } = await mountSelection();

    fireEvent.click(view.getByTestId("probe.select"));
    expect(view.getByTestId("selection").textContent).toBe(`${HEADING_PATH}@rev_1/welcome`);
    expect(view.getByTestId("selected-authoring").textContent).toBe("h1:authored:20");
  });

  it("presents a generated wrapper by the authoring that asked for it", async () => {
    const { view } = await mountSelection();

    fireEvent.click(view.getByTestId("probe.select-generated"));
    expect(view.getByTestId("selection").textContent).toBe(`${GENERATED_PATH}@rev_1/welcome`);
    // The wrapper is not authored markup: its first origin is the Button call.
    expect(view.getByTestId("selected-authoring").textContent).toBe("table:generated:24");
  });

  it("falls back to document scope for an instance path this render does not have", async () => {
    const { view } = await mountSelection();

    fireEvent.click(view.getByTestId("probe.select-missing"));
    expect(view.getByTestId("selection").textContent).toBe("document");
  });

  it("rebinds the selection to a later revision that kept the same authoring there", async () => {
    const { editor, view } = await mountSelection();
    fireEvent.click(view.getByTestId("probe.select"));

    await act(() => emitChange(editor, { origin: "agent", authoredSource: AGENT_TSX }));

    await waitFor(() => expect(view.getByTestId("render").textContent).toBe("rev_2/welcome"));
    expect(view.getByTestId("selection").textContent).toBe(`${HEADING_PATH}@rev_2/welcome`);
  });

  it("drops the selection when the entry stops building and there is no render", async () => {
    const { editor, view } = await mountSelection();
    fireEvent.click(view.getByTestId("probe.select"));

    await act(() => emitChange(editor, { origin: "external", broken: true }));

    await waitFor(() => expect(view.getByTestId("render").textContent).toBe("(none)/(none)"));
    expect(view.getByTestId("selection").textContent).toBe("document");
  });

  it("re-renders another fixture at the same revision and rebinds the selection to it", async () => {
    const { view } = await mountSelection();
    fireEvent.click(view.getByTestId("probe.select"));
    expect(view.getByTestId("subject").textContent).toContain("Ada");

    await act(async () => {
      fireEvent.click(view.getByTestId("probe.view-fixture"));
      await settle();
    });

    // A fixture switch is a re-render, not an edit: the revision holds.
    await waitFor(() => expect(view.getByTestId("render").textContent).toBe("rev_1/returning"));
    expect(view.getByTestId("subject").textContent).toContain("Grace");
    expect(view.getByTestId("selection").textContent).toBe(`${HEADING_PATH}@rev_1/returning`);
  });
});

describe("metadata save failure", () => {
  const failingHost = async (): Promise<AsyncEditableEditorHost> => {
    const editor = await mockEditor();
    return { ...editor.host, writer: { save: () => Promise.reject(new Error("save failed")) } };
  };

  it("rolls a failed rename back to the saved name and surfaces an error", async () => {
    const view = render(
      <EditorProvider host={await failingHost()}>
        <DocumentProbe />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId("name").textContent).toBe("Welcome — first bag on us"),
    );

    fireEvent.click(view.getByTestId("probe.rename"));

    await waitFor(() => expect(view.getByTestId("error").textContent).toContain("template name"));
    // Optimistic "Renamed" was rolled back — the UI never shows unsaved data.
    expect(view.getByTestId("name").textContent).toBe("Welcome — first bag on us");
  });

  it("rolls a failed envelope-defaults save back to the saved metadata", async () => {
    const view = render(
      <EditorProvider host={await failingHost()}>
        <DocumentProbe />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("from").textContent).toBe("hello@nimbus.example"));

    fireEvent.click(view.getByTestId("probe.save-meta"));

    await waitFor(() => expect(view.getByTestId("error").textContent).toContain("sender defaults"));
    expect(view.getByTestId("from").textContent).toBe("hello@nimbus.example");
  });
});

// The isolation suites below are the acceptance tests for the store's
// subscription boundaries: they render probes using the PRODUCTION selector
// idioms (single-field selectors, one useShallow object, the stable actions
// object) and assert that unrelated transitions never re-render them. The
// editor dist gets no React Compiler, so this isolation is load-bearing.

function EditorRenderProbe({ onRender }: { onRender: () => void }) {
  const { doc, expandedLayers } = useEditorStore(
    useShallow((state) => ({ doc: state.doc, expandedLayers: state.expandedLayers })),
  );
  onRender();
  return (
    <div data-testid="render-probe-doc" data-expanded-count={expandedLayers.size}>
      {doc?.name ?? "loading"}
    </div>
  );
}

function HoverRenderProbe({ onRender }: { onRender: () => void }) {
  // Validity is derived in the selector: a candidate that left the render reads
  // as null, so a hover can never highlight a ghost.
  const hoveredTag = useEditorStore((state) =>
    state.hoveredCandidatePath === null
      ? "not-hovered"
      : (state.outline?.index.get(state.hoveredCandidatePath)?.tag ?? "not-hovered"),
  );
  const { setHovered } = useEditorStore((state) => state.actions);
  onRender();
  return (
    <button type="button" data-testid="hover-probe.toggle" onClick={() => setHovered(HEADING_PATH)}>
      {hoveredTag}
    </button>
  );
}

describe("hover render isolation", () => {
  it("does not rerender unrelated store consumers on pointer hover", async () => {
    const editorRender = vi.fn();
    const hoverRender = vi.fn();
    const { host } = await mockEditor();

    const view = render(
      <EditorProvider host={host}>
        <EditorRenderProbe onRender={editorRender} />
        <HoverRenderProbe onRender={hoverRender} />
      </EditorProvider>,
    );
    await waitFor(() => {
      const probe = view.getByTestId("render-probe-doc");
      expect(probe.textContent).toBe("Welcome — first bag on us");
      expect(Number(probe.dataset.expandedCount)).toBeGreaterThan(0);
    });

    const editorRendersBeforeHover = editorRender.mock.calls.length;
    const hoverRendersBeforeHover = hoverRender.mock.calls.length;
    fireEvent.click(view.getByTestId("hover-probe.toggle"));

    await waitFor(() => expect(view.getByTestId("hover-probe.toggle").textContent).toBe("h1"));
    expect(hoverRender.mock.calls.length).toBeGreaterThan(hoverRendersBeforeHover);
    expect(editorRender).toHaveBeenCalledTimes(editorRendersBeforeHover);
  });
});

function DocumentOnlyProbe({ onRender }: { onRender: () => void }) {
  const doc = useEditorStore((state) => state.doc);
  onRender();
  return <output data-testid="document-only">{doc?.name ?? "loading"}</output>;
}

function LayoutOnlyProbe({ onRender }: { onRender: () => void }) {
  const previewDevice = useEditorStore((state) => state.previewDevice);
  onRender();
  return <output data-testid="layout-only">{previewDevice}</output>;
}

function SelectionControl() {
  const selection = useEditorStore((state) => state.selection);
  const { select } = useEditorStore((state) => state.actions);
  return (
    <button
      type="button"
      data-testid="selection-control.toggle"
      onClick={() => select(HEADING_PATH)}
    >
      {selection.kind === "element" ? "Selected node" : "Select node"}
    </button>
  );
}

function ActionsOnlyProbe({ onRender }: { onRender: () => void }) {
  useEditorStore((state) => state.actions);
  onRender();
  return null;
}

function LayoutControl() {
  const previewDevice = useEditorStore((state) => state.previewDevice);
  const { setPreviewDevice } = useEditorStore((state) => state.actions);
  return (
    <button
      type="button"
      data-testid="layout-control.toggle"
      onClick={() => setPreviewDevice("mobile")}
    >
      {previewDevice}
    </button>
  );
}

describe("selector subscription boundaries", () => {
  it("does not rerender document or layout consumers when selection changes", async () => {
    const documentRender = vi.fn();
    const layoutRender = vi.fn();
    const { host } = await mockEditor();
    const view = render(
      <EditorProvider host={host}>
        <DocumentOnlyProbe onRender={documentRender} />
        <LayoutOnlyProbe onRender={layoutRender} />
        <SelectionControl />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId("document-only").textContent).toBe("Welcome — first bag on us"),
    );

    const documentRendersBefore = documentRender.mock.calls.length;
    const layoutRendersBefore = layoutRender.mock.calls.length;
    fireEvent.click(view.getByTestId("selection-control.toggle"));

    await waitFor(() =>
      expect(view.getByTestId("selection-control.toggle").textContent).toBe("Selected node"),
    );
    expect(documentRender).toHaveBeenCalledTimes(documentRendersBefore);
    expect(layoutRender).toHaveBeenCalledTimes(layoutRendersBefore);
  });

  it("keeps stable actions and document consumers isolated from layout updates", async () => {
    const actionsRender = vi.fn();
    const documentRender = vi.fn();
    const { host } = await mockEditor();
    const view = render(
      <EditorProvider host={host}>
        <ActionsOnlyProbe onRender={actionsRender} />
        <DocumentOnlyProbe onRender={documentRender} />
        <LayoutControl />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId("document-only").textContent).toBe("Welcome — first bag on us"),
    );

    const actionRendersBefore = actionsRender.mock.calls.length;
    const documentRendersBefore = documentRender.mock.calls.length;
    fireEvent.click(view.getByTestId("layout-control.toggle"));

    await waitFor(() =>
      expect(view.getByTestId("layout-control.toggle").textContent).toBe("mobile"),
    );
    expect(actionsRender).toHaveBeenCalledTimes(actionRendersBefore);
    expect(documentRender).toHaveBeenCalledTimes(documentRendersBefore);
  });
});
