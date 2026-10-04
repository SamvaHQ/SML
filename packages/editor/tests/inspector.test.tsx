/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { Inspector } from "../src/chrome/inspector";
import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { emitChange, mockEditor } from "./mock-host";

afterEach(cleanup);

const HEADING = "0.0.1";
/** The Outlook table the Button primitive generates around its anchor. */
const WRAPPER = "0.0.3";
/** The second of three rows one authored `<Row>` produced inside a map. */
const SECOND_ROW = "0.0.4.1";

function Scopes() {
  const { select, selectDocument, selectEnvelope } = useEditorStore((state) => state.actions);
  return (
    <>
      {[HEADING, WRAPPER, SECOND_ROW].map((instancePath) => (
        <button
          key={instancePath}
          type="button"
          data-testid={`scope.${instancePath}`}
          onClick={() => select(instancePath)}
        >
          {instancePath}
        </button>
      ))}
      <button type="button" data-testid="scope.document" onClick={selectDocument}>
        document
      </button>
      <button type="button" data-testid="scope.envelope" onClick={selectEnvelope}>
        envelope
      </button>
    </>
  );
}

const mountInspector = async () => {
  const editor = await mockEditor();
  const view = render(
    <EditorProvider host={editor.host}>
      <Scopes />
      <Inspector />
    </EditorProvider>,
  );
  await waitFor(() => expect(view.container.textContent).toContain("src/Welcome.tsx"));
  return { editor, view };
};

describe("Inspector document scope", () => {
  it("names the entry, the fixture on screen, and the declared variables", async () => {
    const { view } = await mountInspector();

    expect(view.container.textContent).toContain("Document");
    expect(view.container.textContent).toContain("src/Welcome.tsx");
    expect(view.container.textContent).toContain("welcome");
    expect(view.container.textContent).toContain("firstName");
    expect(view.container.textContent).toContain("claimUrl");
    // Values come from the fixture the toolbar selected, not from editable samples.
    expect(view.container.textContent).toContain("values of the fixture selected in the toolbar");
  });
});

describe("Inspector envelope scope", () => {
  it("shows the rendered subject and preview text, and the editable send defaults", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId("scope.envelope"));
    expect(view.container.textContent).toContain("Envelope");
    expect(view.container.textContent).toContain("Ada, your first bag is on us");
    expect(view.container.textContent).toContain("Freshly roasted, free shipping, no strings.");
    expect((view.getByTestId("inspector.envelope.from-email") as HTMLInputElement).value).toBe(
      "hello@nimbus.example",
    );
  });
});

describe("Inspector element scope", () => {
  it("identifies an authored element by tag, instance path, and where it was written", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${HEADING}`));
    expect(view.container.textContent).toContain("Element");
    expect(view.container.textContent).toContain("Authored");
    expect(view.container.textContent).toContain(HEADING);
    expect(view.container.textContent).toContain("src/Welcome.tsx:20:9");
    expect(view.container.textContent).toContain("This authoring renders one element here.");
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("h1");
  });

  it("presents a generated wrapper as generated, pointing at the call that asked for it", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${WRAPPER}`));
    expect(view.container.textContent).toContain("Generated");
    // origins[0] is the authored Button, not the table the compiler emitted.
    expect(view.container.textContent).toContain("src/Welcome.tsx:24:9");
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("table · generated");
  });

  it("lists the enclosing call sites, innermost first", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${HEADING}`));
    // The one ordered list in the element panel is the call-site chain.
    const callSites = view.container.querySelector("ol");
    expect([...(callSites?.querySelectorAll("li") ?? [])].map((item) => item.textContent)).toEqual([
      "src/Welcome.tsx:18:7",
      "src/Welcome.tsx:17:5",
    ]);
  });

  it("says which iteration of a repeated authoring an element is, and walks to the others", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${SECOND_ROW}`));
    expect(view.container.textContent).toContain(
      "This authoring renders 3 elements here; this is number 2.",
    );
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("tr 2 of 3");

    // Every iteration is reachable, and picking one moves the selection to it.
    expect(view.getByTestId("inspector.iteration.0.0.4.0")).toBeTruthy();
    expect(view.getByTestId("inspector.iteration.0.0.4.2")).toBeTruthy();
    fireEvent.click(view.getByTestId("inspector.iteration.0.0.4.2"));
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("tr 3 of 3");
  });

  it("falls back to the document scope when the selection leaves the render", async () => {
    const { editor, view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${HEADING}`));
    expect(view.container.textContent).toContain("Element");

    await act(() => emitChange(editor, { origin: "external", broken: true }));
    await waitFor(() => expect(view.container.textContent).not.toContain("Element"));
    expect(view.container.textContent).toContain("Document");
  });
});
