/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  contractVersion,
  type Capability,
  type DocumentChange,
  type DocumentUpdate,
  type EditableEditorDocument,
  type ProjectLifecycleState,
} from "@samva/editor/host";
import { type EditableEditorHost, type LifecycleApi } from "@samva/editor/host/effect";
import { toAsyncHost } from "@samva/editor/host/effect";
import { createMockHost } from "@samva/editor/mock";
import { compileTemplate } from "@samva/markup/compiler";
import { renderIrPreview } from "@samva/markup/render";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Effect, Stream } from "effect";

import { SourceControls } from "../src/chrome/source-controls";
import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";

afterEach(cleanup);

const ENTRY = "templates/order.tsx";
const CARD = "templates/card.tsx";

const template = (
  body: string,
  imports = "",
): string => `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
${imports}
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
${body}
      </Email>
    ),
  },
});
`;

const ENTRY_SOURCE = template(
  `        <h1 className="text-lg">Hello</h1>
        <p>Thanks, {input.name}</p>`,
);
const PARTIAL_ENTRY = template(`        <Card title="Track" />`, 'import { Card } from "./card";');
const CARD_SOURCE = `export const Card = ({ title }: { title: string }) => <h2>Card heading</h2>;
`;

/** The render a real host makes: compile the project, render the fixture from the IR. */
const buildRender = async (files: Readonly<Record<string, string>>, revision: string) => {
  const compiled = await compileTemplate({
    files,
    entry: ENTRY,
    assetBase: "https://assets.invalid",
    tailwind: false,
  });
  if (compiled.ir === undefined) throw new Error(JSON.stringify(compiled.diagnostics));
  const preview = renderIrPreview(compiled.ir, compiled.fixtures.welcome);
  return {
    revision,
    subject: preview.subject,
    ...(preview.preheader === undefined ? {} : { preheader: preview.preheader }),
    html: preview.html,
    text: preview.text,
    selections: preview.selections,
  };
};

interface Harness {
  readonly saves: DocumentUpdate[];
  readonly fileWrites: { path: string; baseRev: string; content: string | null }[];
  readonly host: ReturnType<typeof toAsyncHost>;
}

/**
 * The package's mock host, with the render replaced by a real compile of the project so the
 * selections carry the origins the compiler records.
 */
const harness = async (
  files: Readonly<Record<string, string>>,
  options: { readonly lifecycle: boolean },
): Promise<Harness> => {
  const controls = await Effect.runPromise(createMockHost);
  const saves: DocumentUpdate[] = [];
  const fileWrites: Harness["fileWrites"] = [];
  const project = { ...files };
  const patch = async <T extends EditableEditorDocument | DocumentChange>(
    document: T,
    authoredSource: string | undefined,
  ): Promise<T> => {
    if (document.channel !== "email") return document;
    if (authoredSource !== undefined) project[ENTRY] = authoredSource;
    return {
      ...document,
      render: await buildRender(project, document.rev),
      ...(authoredSource === undefined ? {} : { authoredSource }),
    } as T;
  };
  const lifecycle: Capability<LifecycleApi> = {
    status: "ready",
    api: {
      publish: unused,
      restore: unused,
      resolveConflict: unused,
      putAsset: unused,
      inspect: Effect.succeed(state(project)),
      updateFile: (input) =>
        Effect.promise(async () => {
          fileWrites.push({ path: input.path, baseRev: input.baseRev, content: input.content });
          if (input.content !== null) project[input.path] = input.content;
          await Effect.runPromise(
            controls.emit({ origin: "external", authoredSource: project[ENTRY] }),
          );
          return state(project);
        }),
    },
  };
  const host: EditableEditorHost = {
    ...controls.host,
    contractVersion,
    document: {
      open: Effect.gen(function* () {
        const opened = yield* controls.host.document.open;
        const initial = yield* Effect.promise(() =>
          patch(
            {
              ...opened.initial,
              origin: { ...opened.initial.origin, file: ENTRY, authoredSource: project[ENTRY]! },
            },
            project[ENTRY],
          ),
        );
        return {
          initial,
          changes: opened.changes.pipe(
            Stream.mapEffect((change) =>
              Effect.promise(() =>
                patch(change, change.channel === "email" ? change.authoredSource : undefined),
              ),
            ),
          ),
        };
      }),
    },
    writer: {
      save: (update) => {
        saves.push(update);
        return controls.host.writer.save(update);
      },
    },
    ...(options.lifecycle ? { lifecycle } : {}),
  };
  return { saves, fileWrites, host: toAsyncHost(host) };
};

const unused = () => Effect.die("unused lifecycle operation");

const state = (project: Readonly<Record<string, string>>): ProjectLifecycleState => ({
  rev: "rev_1",
  baseCommit: "c1",
  remoteHead: "c1",
  dirty: false,
  files: Object.entries(project).map(([path, content]) => ({
    path,
    status: "clean" as const,
    content,
  })),
  conflicts: [],
  commits: [],
});

function Probe({ tag, file }: { readonly tag: string; readonly file: string }) {
  const selections = useEditorStore((store) => store.render?.selections);
  const { flushSaves } = useEditorStore((store) => store.actions);
  const selection = selections?.find(
    (entry) => entry.tag === tag && entry.origins[0]?.fileName === file,
  );
  return (
    <>
      <button type="button" data-testid="probe.flush" onClick={() => void flushSaves()}>
        flush
      </button>
      {selection === undefined ? null : <SourceControls selection={selection} />}
    </>
  );
}

const mount = async (
  files: Readonly<Record<string, string>>,
  probe: { tag: string; file: string },
  lifecycle = false,
) => {
  const editor = await harness(files, { lifecycle });
  const view = render(
    <EditorProvider host={editor.host}>
      <Probe {...probe} />
    </EditorProvider>,
  );
  return { editor, view };
};

describe("source controls on the static profile", () => {
  it("edits a selected element in place and saves the transformed TSX", async () => {
    const { editor, view } = await mount({ [ENTRY]: ENTRY_SOURCE }, { tag: "h1", file: ENTRY });
    const input = await view.findByTestId("source.property.children.literal");
    fireEvent.change(input, { target: { value: "Welcome" } });
    fireEvent.click(view.getByTestId("source.property.children.apply"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() => expect(editor.saves).toHaveLength(1));
    const [save] = editor.saves;
    expect(save?.kind).toBe("authoredSource");
    expect(save?.kind === "authoredSource" && save.authoredSource).toBe(
      ENTRY_SOURCE.replace(">Hello<", ">Welcome<"),
    );
  });

  it("adds a class token to a literal className and saves it", async () => {
    const { editor, view } = await mount({ [ENTRY]: ENTRY_SOURCE }, { tag: "h1", file: ENTRY });
    fireEvent.change(await view.findByTestId("source.classes"), { target: { value: "font-bold" } });
    fireEvent.click(view.getByTestId("source.classes-add"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() => expect(editor.saves).toHaveLength(1));
    const [save] = editor.saves;
    expect(save?.kind === "authoredSource" && save.authoredSource).toBe(
      ENTRY_SOURCE.replace('"text-lg"', '"text-lg font-bold"'),
    );
  });

  it("shows why a binding that leaves the static profile is refused, and saves nothing", async () => {
    const { editor, view } = await mount({ [ENTRY]: ENTRY_SOURCE }, { tag: "h1", file: ENTRY });
    fireEvent.click(await view.findByTestId("source.property.children.expression-toggle"));
    fireEvent.change(view.getByTestId("source.property.children.expression"), {
      target: { value: "input.name.toUpperCase()" },
    });
    fireEvent.click(view.getByTestId("source.property.children.review"));
    expect(view.getByTestId("source.proposal-refusal").textContent).toContain("static profile");
    expect((view.getByTestId("source.apply-reviewed") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByTestId("probe.flush"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(editor.saves).toHaveLength(0);
  });

  it("accepts a bound field", async () => {
    const { editor, view } = await mount({ [ENTRY]: ENTRY_SOURCE }, { tag: "h1", file: ENTRY });
    fireEvent.click(await view.findByTestId("source.property.children.expression-toggle"));
    fireEvent.change(view.getByTestId("source.property.children.expression"), {
      target: { value: "input.name" },
    });
    fireEvent.click(view.getByTestId("source.property.children.review"));
    fireEvent.click(view.getByTestId("source.apply-reviewed"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() => expect(editor.saves).toHaveLength(1));
  });

  it("names the number of rendered copies one edit changes and edits the source once", async () => {
    const loop = template(
      `        {input.items.map((item) => (
          <p>Row</p>
        ))}`,
    )
      .replace("{ name: string }", "{ name: string; items: string[] }")
      .replace(
        'properties: { name: { type: "string" } },\n    required: ["name"],',
        'properties: { name: { type: "string" }, items: { type: "array", items: { type: "string" } } },\n    required: ["name", "items"],',
      )
      .replace('{ name: "Ada" }', '{ name: "Ada", items: ["a", "b"] }');
    const { editor, view } = await mount({ [ENTRY]: loop }, { tag: "p", file: ENTRY });
    await view.findByTestId("source.property.children.literal");
    expect(view.getByTestId("source.scope-note").textContent).toContain(
      "renders 2 times here (a loop or a repeated component), so one edit changes all 2",
    );
    fireEvent.change(view.getByTestId("source.property.children.literal"), {
      target: { value: "Line" },
    });
    fireEvent.click(view.getByTestId("source.property.children.apply"));
    fireEvent.click(view.getByTestId("probe.flush"));
    await waitFor(() => expect(editor.saves).toHaveLength(1));
    const [save] = editor.saves;
    expect(save?.kind === "authoredSource" && save.authoredSource).toBe(
      loop.replace(">Row<", ">Line<"),
    );
  });

  it("edits an element inside a partial through the project files, with a warning", async () => {
    const { editor, view } = await mount(
      { [ENTRY]: PARTIAL_ENTRY, [CARD]: CARD_SOURCE },
      { tag: "h2", file: CARD },
      true,
    );
    expect((await view.findByTestId("source.partial-warning")).textContent).toContain(
      "every template that uses this partial",
    );
    fireEvent.change(await view.findByTestId("source.property.children.literal"), {
      target: { value: "Tracking" },
    });
    fireEvent.click(view.getByTestId("source.property.children.apply"));
    await waitFor(() => expect(editor.fileWrites).toHaveLength(1));
    expect(editor.fileWrites[0]?.path).toBe(CARD);
    expect(editor.fileWrites[0]?.content).toBe(CARD_SOURCE.replace(">Card heading<", ">Tracking<"));
    expect(editor.saves).toHaveLength(0);
  });

  it("is read-only for a partial when the host cannot write project files", async () => {
    const { view } = await mount(
      { [ENTRY]: PARTIAL_ENTRY, [CARD]: CARD_SOURCE },
      { tag: "h2", file: CARD },
      false,
    );
    expect((await view.findByTestId("source.partial-warning")).textContent).toContain(CARD);
    expect((await view.findByTestId("source.unavailable")).textContent).toContain(
      "cannot edit project files",
    );
    expect(view.queryByTestId("source.property.children.apply")).toBeNull();
  });
});
