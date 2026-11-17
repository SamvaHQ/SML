/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  contractVersion,
  type AsyncEditableEditorHost,
  type DocumentChange,
  type DocumentUpdate,
  type EditableEmailDocument,
  type EmailRender,
} from "@samva/editor/host";
import { compileTemplate } from "@samva/markup/compiler";
import { previewEmail } from "@samva/markup/edit";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { SourceControls } from "../src/chrome/source-controls";
import { useEditorStore, useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { pendingDesignEdit, type EditorStore } from "../src/state/store";

afterEach(cleanup);

const ENTRY = "templates/order.tsx";

const SOURCE = `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "order-shipped",
  schema: jsonSchema<{ name: string }>({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }),
  fixtures: { welcome: { name: "Ada" } },
  email: {
    subject: (input) => \`Hi \${input.name}\`,
    body: (input) => (
      <Email>
        <h1 className="text-lg">Hello</h1>
        <p>Thanks, {input.name}</p>
      </Email>
    ),
  },
});
`;

/** The render a real host makes from the authored entry, with the origins the compiler records. */
const buildRender = async (source: string, revision: string): Promise<EmailRender> => {
  const compiled = await compileTemplate({
    files: { [ENTRY]: source },
    entry: ENTRY,
    assetBase: "https://assets.invalid",
    tailwind: false,
  });
  if (compiled.template === undefined) throw new Error(JSON.stringify(compiled.diagnostics));
  const preview = previewEmail(compiled.template, compiled.fixtures.welcome);
  return {
    revision,
    subject: preview.subject,
    html: preview.html,
    text: preview.text,
    selections: preview.selections,
  };
};

const content = async (source: string, revision: string) => ({
  channel: "email" as const,
  preview: { status: "current" as const },
  fixtures: ["welcome"],
  fixture: "welcome",
  render: await buildRender(source, revision),
  diagnostics: [],
  incompatibilities: [],
});

/**
 * A host whose writer answers only when the test says so, and whose change stream carries only
 * the changes the test emits, so the order of an ack and its render is the test's to choose.
 */
const controlledHost = () => {
  let onChange: ((change: DocumentChange) => void) | null = null;
  const pending: Array<{
    readonly update: DocumentUpdate;
    readonly resolve: (result: { readonly rev: string }) => void;
  }> = [];
  const host: AsyncEditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: {
      open: async (listener) => {
        onChange = listener;
        const initial: EditableEmailDocument = {
          id: "tpl_order",
          name: "Order shipped",
          rev: "rev_1",
          origin: { kind: "tsx", file: ENTRY, authoredSource: SOURCE },
          access: { kind: "editable" },
          variables: [],
          metadata: {},
          ...(await content(SOURCE, "rev_1")),
        };
        return { initial, close: () => {} };
      },
    },
    writer: {
      save: (update) =>
        new Promise((resolve) => {
          pending.push({ update, resolve });
        }),
    },
  };
  return {
    host,
    /** The source of the oldest save the host has not answered. */
    waiting: (): string | null => {
      const next = pending[0]?.update;
      return next?.kind === "authoredSource" ? next.authoredSource : null;
    },
    ack: async (rev: string) => {
      const next = pending.shift();
      if (next === undefined) throw new Error("no save is waiting");
      await act(async () => {
        next.resolve({ rev });
        await Promise.resolve();
      });
    },
    emit: async (rev: string, source: string) => {
      const change = { rev, origin: "self" as const, authoredSource: source };
      const built = await content(source, rev);
      await act(async () => onChange?.({ ...change, ...built }));
    },
  };
};

let storeOf: () => EditorStore = () => {
  throw new Error("not mounted");
};

function Probe({ tag }: { readonly tag: string }) {
  const store = useEditorStoreApi();
  storeOf = () => store;
  const selection = useEditorStore((state) =>
    state.render?.selections.find((entry) => entry.tag === tag),
  );
  return selection === undefined ? null : <SourceControls selection={selection} />;
}

const mount = async (
  tag = "h1",
  versions?: AsyncEditableEditorHost["versions"],
): Promise<{ controlled: ReturnType<typeof controlledHost>; view: ReturnType<typeof render> }> => {
  const controlled = controlledHost();
  const host = versions === undefined ? controlled.host : { ...controlled.host, versions };
  const view = render(
    <EditorProvider host={host}>
      <Probe tag={tag} />
    </EditorProvider>,
  );
  await view.findByTestId("source.classes");
  return { controlled, view };
};

/** Change the heading's text through the panel's own controls. */
const editHeading = (view: ReturnType<typeof render>, text: string) => {
  fireEvent.change(view.getByTestId("source.property.children.literal"), {
    target: { value: text },
  });
  fireEvent.click(view.getByTestId("source.property.children.apply"));
};

const flushSaves = async (): Promise<void> => {
  await act(async () => {
    void storeOf().getState().actions.flushSaves();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("a just-edited element stays editable", () => {
  it("keeps its controls when a version save moves the revision without a new render", async () => {
    const { controlled, view } = await mount();
    editHeading(view, "Welcome");
    await flushSaves();
    const saved = controlled.waiting();
    expect(saved).toBe(SOURCE.replace(">Hello<", ">Welcome<"));
    await controlled.emit("rev_2", saved!);
    await controlled.ack("rev_2");
    await waitFor(() => expect(storeOf().getState().pendingAuthoredSource).toBeNull());
    expect(view.queryByTestId("source.unavailable")).toBeNull();

    // Saving a version names the same source with a new revision, and the host sends no change.
    act(() =>
      storeOf().getState().actions.adoptLifecycleSnapshot({ rev: "rev_3", authoredSource: saved! }),
    );

    expect(view.queryByTestId("source.unavailable")).toBeNull();
    expect(view.getByTestId("source.property.children.literal")).toBeTruthy();
    const state = storeOf().getState();
    expect(state.doc?.rev).toBe("rev_3");
    expect(state.render?.revision).toBe("rev_3");
  });

  it("keeps the selection pinned to the element when the revision moves under it", async () => {
    const { view } = await mount();
    const path = storeOf()
      .getState()
      .render?.selections.find((entry) => entry.tag === "h1")?.instancePath;
    act(() =>
      storeOf()
        .getState()
        .actions.select(path ?? null),
    );
    act(() =>
      storeOf().getState().actions.adoptLifecycleSnapshot({ rev: "rev_2", authoredSource: SOURCE }),
    );
    expect(storeOf().getState().selection).toEqual({
      kind: "element",
      instancePath: path,
      revision: "rev_2",
      fixture: "welcome",
    });
    expect(view.queryByTestId("source.unavailable")).toBeNull();
  });

  it("keeps its controls while the writer has acked and the render is still on its way", async () => {
    const { controlled, view } = await mount();
    editHeading(view, "Welcome");
    await flushSaves();
    const saved = controlled.waiting()!;
    await controlled.ack("rev_2");
    expect(storeOf().getState().doc?.rev).toBe("rev_2");
    expect(storeOf().getState().pendingAuthoredSource).toBe(saved);
    // The edit is on its way: the panel keeps the element's controls instead of collapsing.
    expect(view.queryByTestId("source.unavailable")).toBeNull();
    expect(view.getByTestId("source.property.children.literal")).toBeTruthy();

    await controlled.emit("rev_2", saved);
    expect(storeOf().getState().pendingAuthoredSource).toBeNull();
    expect(view.queryByTestId("source.unavailable")).toBeNull();
    expect(view.getByTestId("source.property.children.literal")).toBeTruthy();
  });

  it("stays current when the render arrives before an ack that names a later revision", async () => {
    const { controlled, view } = await mount();
    editHeading(view, "Welcome");
    await flushSaves();
    const saved = controlled.waiting()!;
    await controlled.emit("rev_2", saved);
    await controlled.ack("rev_3");
    expect(view.queryByTestId("source.unavailable")).toBeNull();
    expect(view.getByTestId("source.property.children.literal")).toBeTruthy();
    const state = storeOf().getState();
    expect(state.doc?.rev).toBe("rev_3");
    expect(state.render?.revision).toBe("rev_3");
  });

  it("keeps its controls after the store saves a version the host answers with no change", async () => {
    const saved: string[] = [];
    const { controlled, view } = await mount("h1", {
      status: "ready",
      api: {
        save: async (revision) => {
          saved.push(revision);
          return { revision: `${revision}_saved`, number: 4 };
        },
        savedRevision: async () => null,
      },
    });
    editHeading(view, "Welcome");
    await flushSaves();
    const source = controlled.waiting()!;
    await controlled.emit("rev_2", source);
    await controlled.ack("rev_2");
    await act(async () => {
      await storeOf().getState().actions.saveVersion();
    });
    expect(saved).toEqual(["rev_2"]);
    expect(storeOf().getState().doc?.rev).toBe("rev_2_saved");
    expect(storeOf().getState().render?.revision).toBe("rev_2_saved");
    expect(view.queryByTestId("source.unavailable")).toBeNull();
    expect(
      (view.getByTestId("source.property.children.literal") as HTMLInputElement).disabled,
    ).toBe(false);
  });
});

describe("an edit on its way to the preview", () => {
  it("takes another edit to the same element against the source the editor holds", async () => {
    const { controlled, view } = await mount();
    editHeading(view, "Welcome");
    await flushSaves();
    await controlled.ack("rev_2");
    // The first edit has not rendered; the heading's own start has not moved.
    editHeading(view, "Welcome back");
    expect(storeOf().getState().sourceEditError).toBeNull();
    expect(storeOf().getState().doc?.origin.authoredSource).toBe(
      SOURCE.replace(">Hello<", ">Welcome back<"),
    );
    expect(storeOf().getState().undoHistory).toHaveLength(2);
  });

  it("holds another element's controls, disabled, until the preview catches up", async () => {
    const { controlled, view } = await mount("p");
    await view.findByTestId("source.classes");
    const heading = storeOf()
      .getState()
      .render?.selections.find((entry) => entry.tag === "h1");
    const doc = storeOf().getState().doc!;
    act(() =>
      storeOf()
        .getState()
        .actions.applySourceEdit({
          revision: doc.rev,
          source: doc.origin.authoredSource,
          edits: [
            {
              start: doc.origin.authoredSource.indexOf(">Hello<") + 1,
              end: doc.origin.authoredSource.indexOf(">Hello<") + 6,
              before: "Hello",
              after: "Welcome",
            },
          ],
          design: { label: "Edit text", field: "text.children" },
          target: { instancePath: heading!.instancePath, originIndex: 0 },
        }),
    );
    expect(storeOf().getState().pendingAuthoredSource).not.toBeNull();
    expect(view.queryByTestId("source.unavailable")).toBeNull();
    const classes = view.getByTestId("source.classes") as HTMLInputElement;
    expect(classes.closest("fieldset")?.disabled).toBe(true);

    await flushSaves();
    await controlled.emit("rev_2", controlled.waiting()!);
    await controlled.ack("rev_2");
    const after = view.getByTestId("source.classes") as HTMLInputElement;
    expect(after.closest("fieldset")?.disabled).toBe(false);
  });

  it("refuses an edit to another element while one is on its way, and says why", async () => {
    const { view } = await mount();
    editHeading(view, "Welcome");
    const state = storeOf().getState();
    const paragraph = state.render?.selections.find((entry) => entry.tag === "p");
    act(() =>
      state.actions.applySourceEdit({
        revision: state.render!.revision,
        source: state.doc!.origin.authoredSource,
        edits: [{ start: 0, end: 0, before: "", after: "// x\n" }],
        design: { label: "Edit text" },
        target: { instancePath: paragraph!.instancePath, originIndex: 0 },
      }),
    );
    expect(storeOf().getState().sourceEditError).toBe(
      "Wait for your last change to reach the preview.",
    );
  });
});

describe("a version saved before its edit has rendered", () => {
  it("moves only the revision, keeps the edit pending, and shows its late render as saved", async () => {
    const saved: string[] = [];
    const { controlled, view } = await mount("h1", {
      status: "ready",
      api: {
        save: async (revision) => {
          saved.push(revision);
          return { revision: `${revision}_saved`, number: 5 };
        },
        savedRevision: async () => null,
      },
    });
    editHeading(view, "Welcome");
    let saving: Promise<string> | undefined;
    act(() => {
      saving = storeOf().getState().actions.saveVersion();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const source = controlled.waiting()!;
    await controlled.ack("rev_2");
    await act(async () => {
      await saving;
    });
    let state = storeOf().getState();
    expect(saved).toEqual(["rev_2"]);
    expect(state.doc?.rev).toBe("rev_2_saved");
    // The edit is still on its way: its history, its pending state and its panel stay.
    expect(state.pendingAuthoredSource).toBe(source);
    expect(state.undoHistory).toHaveLength(1);
    expect(pendingDesignEdit(state)?.instancePath).toBeDefined();
    expect(view.queryByTestId("source.unavailable")).toBeNull();

    // Its own render lands late, under the revision it was saved as.
    await controlled.emit("rev_2", source);
    state = storeOf().getState();
    expect(state.doc?.rev).toBe("rev_2_saved");
    expect(state.render?.revision).toBe("rev_2_saved");
    expect(state.pendingAuthoredSource).toBeNull();
  });
});

describe("the store's own guard on edits", () => {
  it("refuses an element edit from a render that does not show the source it holds", async () => {
    const { view } = await mount();
    const state = storeOf().getState();
    const heading = state.render!.selections.find((entry) => entry.tag === "h1")!;
    const restored = SOURCE.replace(">Hello<", ">Restored<");
    // A restore replaces the entry; its render is still on its way.
    act(() => state.actions.adoptLifecycleSnapshot({ rev: "rev_9", authoredSource: restored }));
    const after = storeOf().getState();
    expect(after.render?.revision).toBe("rev_1");
    act(() =>
      after.actions.applySourceEdit({
        revision: after.render!.revision,
        source: restored,
        edits: [{ start: 0, end: 0, before: "", after: "// x\n" }],
        design: { label: "Edit text" },
        target: { instancePath: heading.instancePath, originIndex: 0 },
      }),
    );
    expect(storeOf().getState().sourceEditError).toContain("stale");
    expect(storeOf().getState().doc?.origin.authoredSource).toBe(restored);
    // The panel holds its controls, disabled, until the restored render arrives.
    const literal = view.getByTestId("source.property.children.literal");
    expect(literal.closest("fieldset")?.disabled).toBe(true);
  });

  it("makes the next edit wait for the preview after a block moves", async () => {
    const { view } = await mount();
    fireEvent.click(view.getByTestId("source.review-move-down"));
    fireEvent.click(view.getByTestId("source.apply-structure"));
    const state = storeOf().getState();
    expect(state.pendingAuthoredSource).not.toBeNull();
    // A neighbour now starts where the heading did, so nothing may follow it on the old origins.
    expect(pendingDesignEdit(state)).toBeNull();
    const heading = state.render!.selections.find((entry) => entry.tag === "h1")!;
    act(() =>
      state.actions.applySourceEdit({
        revision: state.render!.revision,
        source: state.doc!.origin.authoredSource,
        edits: [{ start: 0, end: 0, before: "", after: "// x\n" }],
        design: { label: "Edit text", field: "text.children" },
        target: { instancePath: heading.instancePath, originIndex: 0 },
      }),
    );
    expect(storeOf().getState().sourceEditError).toBe(
      "Wait for your last change to reach the preview.",
    );
  });

  it("lets an in-place block edit be followed on the same element", async () => {
    const { view } = await mount();
    fireEvent.click(view.getByTestId("source.review-duplicate"));
    fireEvent.click(view.getByTestId("source.apply-structure"));
    expect(pendingDesignEdit(storeOf().getState())?.instancePath).toBeDefined();
  });
});
