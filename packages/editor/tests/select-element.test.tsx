/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { MOCK_FIXTURE_NAMES, NIMBUS_WELCOME_TSX } from "@samva/editor/mock";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createRef, useLayoutEffect, type RefObject } from "react";

import { LayersPane } from "../src/chrome/left-rail";
import { useEditorStore, useEditorStoreApi } from "../src/state/context";
import { EditorProvider, type EditorProviderProps } from "../src/state/provider";
import type { EditorStore } from "../src/state/store";
import { emitChange, mockEditor } from "./mock-host";

afterEach(cleanup);

/** The heading the mock renders — one authored element, one rendered instance. */
const HEADING_PATH = "0.0.1";

function SelectButton() {
  const select = useEditorStore((state) => state.actions.select);
  const selected = useEditorStore((state) =>
    state.selection.kind === "element" ? state.selection.instancePath : "(none)",
  );
  const revision = useEditorStore((state) =>
    state.selection.kind === "element" ? state.selection.revision : "(none)",
  );
  return (
    <>
      <output data-testid="selected">{selected}</output>
      <output data-testid="revision">{revision}</output>
      <button type="button" data-testid="select" onClick={() => select(HEADING_PATH)}>
        select
      </button>
    </>
  );
}

function CaptureStore({ storeRef }: { storeRef: RefObject<EditorStore | null> }) {
  const store = useEditorStoreApi();
  useLayoutEffect(() => {
    storeRef.current = store;
    return () => {
      storeRef.current = null;
    };
  }, [store, storeRef]);
  return null;
}

function CommitSelection({
  storeRef,
  selectDuringCommit,
  ...provider
}: EditorProviderProps & {
  storeRef: RefObject<EditorStore | null>;
  selectDuringCommit: boolean;
}) {
  // Ancestor layout effects follow the provider's layout commit and precede passive effects.
  useLayoutEffect(() => {
    if (selectDuringCommit) storeRef.current!.getState().actions.select(HEADING_PATH);
  }, [selectDuringCommit, storeRef]);
  return (
    <EditorProvider {...provider}>
      <CaptureStore storeRef={storeRef} />
      {provider.children}
    </EditorProvider>
  );
}

describe("onSelectElement", () => {
  it("uses the committed callback before an ancestor layout effect selects", async () => {
    const editor = await mockEditor();
    const first = vi.fn();
    const second = vi.fn();
    const storeRef = createRef<EditorStore>();
    const view = render(
      <CommitSelection
        host={editor.host}
        onSelectElement={first}
        storeRef={storeRef}
        selectDuringCommit={false}
      >
        <SelectButton />
      </CommitSelection>,
    );
    await waitFor(() => expect(storeRef.current?.getState().render?.revision).toBe("rev_1"));
    const store = storeRef.current;
    view.rerender(
      <CommitSelection
        host={editor.host}
        onSelectElement={second}
        storeRef={storeRef}
        selectDuringCommit
      >
        <SelectButton />
      </CommitSelection>,
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith({
      instancePath: HEADING_PATH,
      revision: "rev_1",
      fixture: MOCK_FIXTURE_NAMES[0],
    });
    expect(storeRef.current).toBe(store);
  });

  it("reports an actual outline row selection through the provider", async () => {
    const editor = await mockEditor();
    const onSelectElement = vi.fn();
    const view = render(
      <EditorProvider host={editor.host} onSelectElement={onSelectElement}>
        <LayersPane />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId(`layers.node.${HEADING_PATH}`)).toBeTruthy());
    expect(onSelectElement).not.toHaveBeenCalled();
    await act(async () => {
      view.getByTestId(`layers.node.${HEADING_PATH}`).click();
    });
    expect(onSelectElement).toHaveBeenCalledExactlyOnceWith({
      instancePath: HEADING_PATH,
      revision: "rev_1",
      fixture: MOCK_FIXTURE_NAMES[0],
    });
  });

  it("reports the user's selection with the render it was made in, and not the editor keeping up", async () => {
    const editor = await mockEditor();
    const onSelectElement = vi.fn();
    const view = render(
      <EditorProvider host={editor.host} onSelectElement={onSelectElement}>
        <SelectButton />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("select")).toBeTruthy());

    await act(async () => {
      view.getByTestId("select").click();
    });
    expect(onSelectElement).toHaveBeenCalledTimes(1);
    expect(onSelectElement).toHaveBeenCalledWith({
      instancePath: HEADING_PATH,
      revision: expect.any(String),
      fixture: MOCK_FIXTURE_NAMES[0],
    });

    const selectedRevision = view.getByTestId("revision").textContent;
    // A foreign change moves the document and the editor rebinds the selection: no gesture.
    await act(() =>
      emitChange(editor, {
        origin: "external",
        authoredSource: NIMBUS_WELCOME_TSX.replace("your first bag is on us", "a new line"),
      }),
    );
    await waitFor(() =>
      expect(view.getByTestId("revision").textContent).not.toBe(selectedRevision),
    );
    expect(view.getByTestId("selected").textContent).toBe(HEADING_PATH);
    expect(onSelectElement).toHaveBeenCalledTimes(1);
  });

  it("reads the latest callback without replacing the document session", async () => {
    const editor = await mockEditor();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <EditorProvider host={editor.host} onSelectElement={first}>
        <SelectButton />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("select")).toBeTruthy());
    view.rerender(
      <EditorProvider host={editor.host} onSelectElement={second}>
        <SelectButton />
      </EditorProvider>,
    );
    await act(async () => {
      view.getByTestId("select").click();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
