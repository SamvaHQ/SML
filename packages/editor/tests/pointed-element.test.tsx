/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import type { EditorContribution } from "../src/chrome/contributions";
import { EditorRoot, EditorWorkspace } from "../src/chrome/shell";
import type { EditorAssistantWorkspace } from "../src/chrome/use-assistant";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import type { EditorStore } from "../src/state/store";
import { mockEditor } from "./mock-host";

afterEach(cleanup);

let storeOf: () => EditorStore = () => {
  throw new Error("not mounted");
};

function StoreProbe() {
  const store = useEditorStoreApi();
  storeOf = () => store;
  return null;
}

const mount = async () => {
  let workspace: EditorAssistantWorkspace | null = null;
  const assistant: EditorContribution = {
    slot: "rail.assistant",
    id: "assistant",
    render: (controls) => {
      workspace = controls.workspace;
      return <div data-testid="test.assistant" />;
    },
  };
  const view = render(
    <EditorProvider host={(await mockEditor()).host}>
      <EditorRoot contributions={[assistant]}>
        <EditorWorkspace />
        <StoreProbe />
      </EditorRoot>
    </EditorProvider>,
  );
  await waitFor(() => expect(storeOf().getState().render).not.toBeNull());
  const paths = storeOf()
    .getState()
    .render!.selections.filter((entry) => entry.authored)
    .map((entry) => entry.instancePath);
  return {
    view,
    paths,
    pointed: () => (workspace as EditorAssistantWorkspace | null)?.pointedElement ?? null,
  };
};

describe("the element the assistant points at", () => {
  it("follows a selection in point mode", async () => {
    const { paths, pointed } = await mount();
    act(() => storeOf().getState().actions.select(paths[1]!));
    expect(pointed()).toMatchObject({ instancePath: paths[1], originIndex: 0 });
    act(() => storeOf().getState().actions.selectDocument());
    expect(pointed()).toBeNull();
  });

  it("ignores a selection in Design until the author asks the agent about it", async () => {
    const { view, paths, pointed } = await mount();
    act(() => storeOf().getState().actions.setCanvasMode("design"));
    act(() => storeOf().getState().actions.select(paths[1]!));
    expect(pointed()).toBeNull();

    // The Design inspector's element panel.
    const ask = await view.findByTestId("source.ask-agent");
    expect(ask.textContent).toBe("Ask agent about this");
    fireEvent.click(ask);
    expect(pointed()).toMatchObject({ instancePath: paths[1], originIndex: 0 });

    // Selecting something else in Design keeps the element the author asked about.
    act(() => storeOf().getState().actions.select(paths[2]!));
    expect(pointed()).toMatchObject({ instancePath: paths[1] });

    act(() => storeOf().getState().actions.setCanvasMode("point"));
    expect(pointed()).toBeNull();
  });

  it("ignores a selection while pinning", async () => {
    const { paths, pointed } = await mount();
    act(() => storeOf().getState().actions.setCanvasMode("pin"));
    act(() => storeOf().getState().actions.select(paths[1]!));
    expect(pointed()).toBeNull();
  });
});
