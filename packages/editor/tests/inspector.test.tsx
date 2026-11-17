/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { Inspector } from "../src/chrome/inspector";
import { useEditorStore, useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import type { EditorStore } from "../src/state/store";
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

/** Hands the provider's store to a test that has to set state the actions cannot reach. */
function StoreHandle({ into }: { readonly into: { current: EditorStore | null } }) {
  into.current = useEditorStoreApi();
  return null;
}

const mountInspector = async () => {
  const editor = await mockEditor();
  const store: { current: EditorStore | null } = { current: null };
  const view = render(
    <EditorProvider host={editor.host}>
      <StoreHandle into={store} />
      <Scopes />
      <Inspector />
    </EditorProvider>,
  );
  await waitFor(() => expect(view.container.textContent).toContain("src/Welcome.tsx"));
  return { editor, view, store };
};

describe("Inspector document scope", () => {
  it("opens on the email as a reader sees it, with the data behind it one step away", async () => {
    const { view } = await mountInspector();
    const text = view.getByTestId("inspector.document-panel").parentElement?.textContent ?? "";

    expect(view.getByTestId("inspector").textContent).toContain("Email");
    const order = [
      "Click any part of the email to change it.",
      "Page",
      "Background",
      "Preview with",
      "Edit sample data",
      "Where it's written",
      "Variables",
    ].map((heading) => text.indexOf(heading));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(view.getByTestId("inspector.document.hint").textContent).toBe(
      "Click any part of the email to change it.",
    );
    // Values come from the fixture the picker selected, not from editable samples.
    expect(text).toContain("values of the fixture selected above it");
  });

  it("previews with the fixture picker, naming the fixture on screen", async () => {
    const { view } = await mountInspector();

    const picker = view.getByTestId("inspector.document.fixture") as HTMLSelectElement;
    expect(picker.value).toBe("welcome");
    expect([...picker.options].map((option) => option.value)).toEqual(["welcome", "returning"]);
  });

  it("keeps sample data and the file it is written in collapsed until opened", async () => {
    const { view } = await mountInspector();

    for (const id of ["inspector.document.sample-data", "inspector.document.written"]) {
      expect(view.getByTestId(`${id}-toggle`).getAttribute("aria-expanded")).toBe("false");
      expect(view.getByTestId(id).hasAttribute("hidden")).toBe(true);
    }
    // The sample data stays mounted while it is folded, so a host or test can still reach it.
    expect(view.getByTestId("inspector.document.sample-data").textContent).toContain(
      "Fixture data",
    );
    expect(view.getByTestId("inspector.document.entry").textContent).toBe("src/Welcome.tsx");
    expect(view.getByTestId("inspector.document.width").textContent).toContain("600");

    fireEvent.click(view.getByTestId("inspector.document.sample-data-toggle"));
    await waitFor(() =>
      expect(view.getByTestId("inspector.document.sample-data").hasAttribute("hidden")).toBe(false),
    );
    expect(view.getByTestId("inspector.document.written").hasAttribute("hidden")).toBe(true);
  });

  it("says why the preview cannot build, and undoes the last change", async () => {
    const { editor, view } = await mountInspector();
    expect(view.queryByTestId("inspector.document.error")).toBeNull();

    await act(() => emitChange(editor, { origin: "external", broken: true }));
    await waitFor(() => expect(view.queryByTestId("inspector.document.error")).not.toBeNull());
    const error = view.getByTestId("inspector.document.error");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("The template entry did not compile.");
    // Nothing to undo yet, so no button promises it.
    expect(view.queryByTestId("inspector.document.undo")).toBeNull();
  });

  it("offers Undo beside the reason when the editor holds a change to take back", async () => {
    const { editor, view, store } = await mountInspector();
    await act(() => emitChange(editor, { origin: "external", broken: true }));
    await waitFor(() => expect(view.queryByTestId("inspector.document.error")).not.toBeNull());

    const undo = vi.fn();
    act(() =>
      store.current?.setState((state) => ({
        undoHistory: [{ before: "<Email />", after: "<Email broken" }],
        actions: { ...state.actions, undo },
      })),
    );
    fireEvent.click(await view.findByTestId("inspector.document.undo"));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe("Inspector page background", () => {
  it("sets the Email's background to a theme colour as an ordinary Design edit", async () => {
    const editor = await mockEditor();
    const store: { current: EditorStore | null } = { current: null };
    const host = {
      ...editor.host,
      theme: {
        status: "ready" as const,
        api: {
          tokens: async () => ({
            colors: [
              { name: "background", value: "#f6f8fb", source: { kind: "project" as const } },
              { name: "card", value: "#ffffff", source: { kind: "project" as const } },
            ],
            fonts: [
              {
                name: "heading",
                family: '"Barlow Semi Condensed", sans-serif',
                source: { kind: "brand" as const, name: "Pruuvo" },
              },
              {
                name: "sans",
                family: "Inter, sans-serif",
                source: { kind: "brand" as const, name: "Pruuvo" },
              },
            ],
          }),
        },
      },
    };
    const view = render(
      <EditorProvider host={host}>
        <StoreHandle into={store} />
        <Inspector />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("inspector.document.fonts")).toBeTruthy());
    expect(view.getByTestId("inspector.document.fonts").textContent).toBe(
      "Barlow Semi Condensed · Interfrom Pruuvo",
    );

    const field = await waitFor(() => {
      const trigger = view.getByTestId("inspector.document.background") as HTMLButtonElement;
      expect(trigger.disabled).toBe(false);
      return trigger;
    });
    expect(field.textContent).toContain("Background");
    fireEvent.click(field);
    fireEvent.click(await view.findByTestId("inspector.document.background.card"));

    const state = store.current?.getState();
    expect(state?.lastDesignEdit?.field).toBe("color.bg");
    const written = state?.pendingAuthoredSource ?? state?.doc?.origin.authoredSource ?? "";
    expect(written).toContain('backgroundColor="var(--color-card)"');
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
  it("names an authored element plainly and keeps where it was written one step away", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${HEADING}`));
    expect(view.getByTestId("inspector.element-name").textContent).toBe("Heading");
    expect(view.container.textContent).toContain("Authored");
    expect(view.container.textContent).toContain("src/Welcome.tsx:20:9");
    expect(view.container.textContent).toContain("This authoring renders one element here.");
    // The instance path is an attribute for tests and hosts, never text an author reads.
    expect(view.getByTestId("inspector").textContent).not.toContain(HEADING);
    expect(view.container.querySelector(`[data-instance-path="${HEADING}"]`)).not.toBeNull();
    expect(view.queryByTestId("inspector.selection-badge")).toBeNull();
  });

  it("presents a generated wrapper as generated, pointing at the call that asked for it", async () => {
    const { view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${WRAPPER}`));
    expect(view.container.textContent).toContain("Generated");
    // origins[0] is the authored Button, not the table the compiler emitted.
    expect(view.container.textContent).toContain("src/Welcome.tsx:24:9");
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("Generated");
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
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("2 of 3");

    // Every iteration is reachable, and picking one moves the selection to it.
    expect(view.getByTestId("inspector.iteration.0.0.4.0")).toBeTruthy();
    expect(view.getByTestId("inspector.iteration.0.0.4.2")).toBeTruthy();
    fireEvent.click(view.getByTestId("inspector.iteration.0.0.4.2"));
    expect(view.getByTestId("inspector.selection-badge").textContent).toBe("3 of 3");
  });

  it("falls back to the document scope when the selection leaves the render", async () => {
    const { editor, view } = await mountInspector();

    fireEvent.click(view.getByTestId(`scope.${HEADING}`));
    expect(view.queryByTestId("inspector.element-name")).not.toBeNull();

    await act(() => emitChange(editor, { origin: "external", broken: true }));
    await waitFor(() => expect(view.queryByTestId("inspector.element-name")).toBeNull());
    expect(view.getByTestId("inspector.document-panel")).toBeTruthy();
  });
});
