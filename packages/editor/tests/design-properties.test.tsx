/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  applySourceReplacements,
  INSTANCE_PATH_ATTRIBUTE,
  inspectSourceElement,
  type SourceReplacement,
} from "@samva/markup/edit";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";

import { DesignProperties } from "../src/chrome/design-properties";
import type { AsyncEditorHost, AsyncLifecycleApi, ThemeTokens } from "../src/host/types";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import type { EditorStore } from "../src/state/store";
import { mockEditor } from "./mock-host";

afterEach(cleanup);

const FILE = "templates/entry.tsx";
const INSTANCE = "0.1";

const PALETTE: ThemeTokens = {
  colors: [
    {
      name: "foreground",
      value: "#17181c",
      source: { kind: "brand", name: "Pruuvo" },
      label: "Ink",
    },
    {
      name: "accent",
      value: "#ff7347",
      dark: "#ff9a78",
      source: { kind: "brand", name: "Pruuvo" },
    },
    { name: "card", value: "#ffffff", source: { kind: "project" } },
    {
      name: "muted-foreground",
      value: "#5c6270",
      source: { kind: "stylesheet", path: "starter.css" },
    },
  ],
  fonts: [
    { name: "sans", family: "Inter, sans-serif", source: { kind: "brand", name: "Pruuvo" } },
    {
      name: "heading",
      family: '"Barlow Semi Condensed", sans-serif',
      source: { kind: "brand", name: "Pruuvo" },
    },
  ],
};

const unarranged = () => () => Promise.reject(new Error("not arranged"));

/** A host whose lifecycle reads the given project files. */
const withProjectFiles = (
  host: AsyncEditorHost,
  files: Readonly<Record<string, string>>,
): AsyncEditorHost => {
  const api: AsyncLifecycleApi = {
    inspect: async () => ({
      rev: "rev_1",
      baseCommit: "base",
      remoteHead: "base",
      dirty: false,
      files: Object.entries(files).map(([path, content]) => ({
        path,
        status: "clean" as const,
        content,
      })),
      conflicts: [],
      commits: [],
    }),
    restore: unarranged(),
    resolveConflict: unarranged(),
    updateFile: unarranged(),
    putAsset: unarranged(),
  };
  return { ...host, lifecycle: { status: "ready", api } };
};

const withTheme = (host: AsyncEditorHost, tokens: ThemeTokens = PALETTE): AsyncEditorHost => ({
  ...host,
  theme: { status: "ready", api: { tokens: async () => tokens } },
});

/** The editing canvas with the selected element rendered at `style`. */
function Canvas({ html }: { readonly html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const document_ = ref.current?.contentDocument;
    if (document_ == null) return;
    document_.open();
    document_.write(`<!doctype html><html><body>${html}</body></html>`);
    document_.close();
  }, [html]);
  return <iframe ref={ref} sandbox="allow-same-origin" data-testid="canvas.frame" title="canvas" />;
}

/** A one-element source, its parsed element, and the edits the controls hand back. */
const mount = async (
  element: string,
  options: {
    readonly host?: (host: AsyncEditorHost) => AsyncEditorHost;
    readonly rendered?: string;
    readonly after?: string;
    readonly pendingField?: string;
  } = {},
) => {
  const source = `const tree = (\n  ${element}\n);\n${options.after ?? ""}`;
  const target = inspectSourceElement(source, FILE, {
    fileName: FILE,
    lineNumber: 2,
    columnNumber: 3,
  });
  if (target === null) throw new Error("the element did not parse");
  const staged: Array<{ readonly label: string; readonly field: string; readonly after: string }> =
    [];
  const commit = (edits: readonly SourceReplacement[], label: string, field: string) => {
    const result = applySourceReplacements(source, edits);
    if (result.ok) staged.push({ label, field, after: result.source });
  };
  const refused: string[] = [];
  const editor = await mockEditor();
  const host = options.host?.(editor.host) ?? editor.host;
  let store!: EditorStore;
  function StoreProbe() {
    store = useEditorStoreApi();
    return null;
  }
  const view = render(
    <EditorProvider host={host}>
      <StoreProbe />
      <div className="samva-editor-frame">
        {options.rendered !== undefined && <Canvas html={options.rendered} />}
        <DesignProperties
          source={source}
          entrySource={`${source} "text-primary bg-card text-muted-foreground text-[13px] text-[34px]"`}
          target={target}
          instancePath={INSTANCE}
          available
          pendingField={options.pendingField ?? null}
          commit={commit}
          onRefused={(reason) => refused.push(reason)}
        />
      </div>
    </EditorProvider>,
  );
  return { view, staged, refused, store: () => store };
};

const rendered = (style: string, text = "Hi") =>
  `<p ${INSTANCE_PATH_ATTRIBUTE}="${INSTANCE}" style="${style}">${text}</p>`;

describe("Design properties", () => {
  it("edits text around a data field, which stays a named pill", async () => {
    const { view, staged } = await mount(
      '<h1 className="text-[34px] mt-3">{input.firstName}, your bag is on us</h1>',
    );
    const pill = view.getByTestId("design-properties.binding");
    expect(pill.textContent).toBe("First name");
    expect(pill.getAttribute("data-path")).toBe("input.firstName");
    const text = view.getByTestId("design-properties.text.text.1");
    fireEvent.change(text, { target: { value: ", welcome" } });
    fireEvent.keyDown(text, { key: "Enter" });
    expect(staged.at(-1)).toEqual({
      label: "Edit text",
      field: "text.text.1",
      after: expect.stringContaining("{input.firstName}, welcome</h1>"),
    });
  });

  it("names a data field and shows its sample from the active fixture", async () => {
    const { view } = await mount("<h1>Your {input.product.shortName} passed inspection</h1>", {
      after: `export default defineTemplate({
  fixtures: { order: { product: { shortName: "Apple Watch" } } },
});\n`,
    });
    expect(view.getByTestId("design-properties.binding").textContent).toBe("Product short name");
    expect(view.getByTestId("design-properties.binding-hint").textContent).toBe(
      "Product short name is filled in from each send. Sample: “Apple Watch”.",
    );
  });

  it("names a data field by the title the input schema gives it", async () => {
    const { view } = await mount("<h1>Your {input.shortName} passed inspection</h1>", {
      after: `export default defineTemplate({
  schema: jsonSchema<{ shortName: string }>({
    type: "object",
    properties: { shortName: { type: "string", title: "Product short name" } },
  }),
});\n`,
    });
    expect(view.getByTestId("design-properties.binding").textContent).toBe("Product short name");
    expect(view.getByTestId("design-properties.binding-hint").textContent).toContain(
      "Product short name is filled in from each send.",
    );
  });

  it("shows the dark value where the canvas renders the email dark", async () => {
    const tokens: ThemeTokens = {
      colors: [
        {
          name: "card-foreground",
          value: "#1c1917",
          dark: "#f5f5f4",
          source: { kind: "project" },
        },
        { name: "accent", value: "#ff7347", dark: "#ff9a78", source: { kind: "project" } },
      ],
      fonts: [],
    };
    const { view } = await mount('<p className="text-card-foreground">Hi</p>', {
      host: (host) => withTheme(host, tokens),
      rendered: rendered("color: #f5f5f4"),
    });
    const field = view.getByTestId("design-properties.color.text");
    await waitFor(() => expect(field.textContent).toContain("#F5F5F4"));
    expect(field.textContent).toContain("Card text");
    expect(field.textContent).not.toContain("#1C1917");
    expect(field.querySelector("[data-active]")?.getAttribute("data-mode")).toBe("dark");
    fireEvent.click(field);
    const accent = await view.findByTestId("design-properties.color.text.accent");
    expect(accent.textContent).toContain("#FF9A78");
    expect(accent.textContent).not.toContain("#FF7347");
  });

  it("reads a data field's sample from the canvas when the fixture does not say", async () => {
    const { view } = await mount("<p>Hello {input.nickname}, welcome</p>", {
      rendered: rendered("", "Hello Maya, welcome"),
    });
    await waitFor(() =>
      expect(view.getByTestId("design-properties.binding-hint").textContent).toContain(
        "Sample: “Maya”.",
      ),
    );
  });

  it("paints every color from the host's theme, grouped by where it comes from", async () => {
    const { view, staged } = await mount(
      '<p className="text-foreground m-0 text-[13px] dark:text-card">Hi</p>',
      { host: (host) => withTheme(host) },
    );
    const field = view.getByTestId("design-properties.color.text");
    await waitFor(() => expect(field.textContent).toContain("Ink"));
    expect(field.textContent).toContain("#17181C");
    fireEvent.click(field);
    const list = await view.findByTestId("design-properties.color.text.list");
    const groups = within(list)
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Pruuvo brand", "This email", "Theme", "Other"]);
    const accent = within(list).getByTestId("design-properties.color.text.accent");
    expect(accent.textContent).toContain("Accent");
    expect(accent.textContent).toContain("#FF7347");
    // A dark value shows beside the light one.
    expect(accent.querySelectorAll("[data-mode]")).toHaveLength(2);
    expect(
      within(list).getByTestId("design-properties.color.text.muted-foreground").textContent,
    ).toContain("Muted text");
    expect(list.innerHTML).not.toContain("repeating-linear-gradient");
    fireEvent.click(accent);
    expect(staged.at(-1)).toEqual({
      label: "Change text color",
      field: "color.text",
      after: expect.stringContaining('className="m-0 text-[13px] dark:text-card text-accent"'),
    });
  });

  it("resolves the project's own stylesheets when the host has no theme", async () => {
    const { view } = await mount('<p className="text-primary">Hi</p>', {
      host: (host) =>
        withProjectFiles(host, {
          "theme.css": '@import "./starter.css";\n@theme {}\n',
          "starter.css": "@theme { --color-primary: #0d5a61; --color-card: #ffffff; }",
        }),
    });
    const field = view.getByTestId("design-properties.color.text");
    await waitFor(() => expect(field.textContent).toContain("#0D5A61"));
    expect(field.textContent).toContain("Primary");
    expect(view.container.innerHTML).not.toContain("repeating-linear-gradient");
  });

  it("shows an inherited color by its palette name and clears or sets a custom one", async () => {
    const { view, staged, refused } = await mount('<p className="m-0">Hi</p>', {
      host: (host) => withTheme(host),
      rendered: rendered("color: #5c6270"),
    });
    const field = view.getByTestId("design-properties.color.text");
    await waitFor(() => expect(field.textContent).toContain("Inherited · Muted text"));
    fireEvent.click(field);
    fireEvent.click(await view.findByTestId("design-properties.color.text.custom"));
    const hex = view.getByTestId("design-properties.color.text.custom-hex");
    fireEvent.change(hex, { target: { value: "orange" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(refused).toEqual(["A custom color is a hex value such as #b4532a."]);
    fireEvent.change(hex, { target: { value: "#b4532a" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(staged.at(-1)?.after).toContain('className="m-0 text-[#b4532a]"');
  });

  it("clears a color class through Inherited", async () => {
    const { view, staged } = await mount('<p className="text-accent m-0">Hi</p>', {
      host: (host) => withTheme(host),
    });
    const field = view.getByTestId("design-properties.color.text");
    await waitFor(() => expect(field.textContent).toContain("Accent"));
    fireEvent.click(field);
    fireEvent.click(await view.findByTestId("design-properties.color.text.none"));
    expect(staged.at(-1)?.after).toContain('className="m-0"');
  });

  it("sets a font role, swapping the other role and keeping the weight", async () => {
    const { view, staged } = await mount('<h1 className="font-sans font-bold">Hi</h1>', {
      host: (host) => withTheme(host),
    });
    const field = view.getByTestId("design-properties.font");
    await waitFor(() => expect(field.textContent).toContain("Inter"));
    expect(field.textContent).toContain("Body font");
    fireEvent.click(field);
    const heading = await view.findByTestId("design-properties.font.heading");
    expect(heading.textContent).toContain("Barlow Semi Condensed");
    expect(heading.textContent).toContain("Heading font");
    fireEvent.click(heading);
    expect(staged.at(-1)).toEqual({
      label: "Change font",
      field: "font",
      after: expect.stringContaining('className="font-bold font-heading"'),
    });
  });

  it("shows the size, weight and font an unstyled heading renders at", async () => {
    const { view, staged } = await mount("<h1>Hi</h1>", {
      host: (host) => withTheme(host),
      rendered: rendered(
        "font-size: 28px; font-weight: 600; font-family: 'Barlow Semi Condensed', sans-serif",
      ),
    });
    const size = view.getByTestId("design-properties.size") as HTMLSelectElement;
    await waitFor(() => expect(size.selectedOptions[0]?.textContent).toBe("28 px · theme"));
    const weight = view.getByTestId("design-properties.weight") as HTMLSelectElement;
    expect(weight.selectedOptions[0]?.textContent).toBe("Semibold · theme");
    await waitFor(() =>
      expect(view.getByTestId("design-properties.font").textContent).toContain(
        "Heading font · theme",
      ),
    );
    const labels = [...size.options].map((option) => option.textContent);
    expect(labels).toEqual(expect.arrayContaining(["12 px", "13 px", "28 px", "34 px", "60 px"]));
    fireEvent.change(size, { target: { value: "text-[34px]" } });
    expect(staged.at(-1)).toMatchObject({
      field: "size",
      after: expect.stringContaining('className="text-[34px]"'),
    });
  });

  it("offers a type scale, and sets weight and alignment", async () => {
    const { view, staged } = await mount('<p className="text-[13px]">Hi</p>');
    const size = view.getByTestId("design-properties.size") as HTMLSelectElement;
    const labels = [...size.options].map((option) => option.textContent);
    expect(labels[0]).toBe("Inherited");
    expect(labels).toEqual(expect.arrayContaining(["13 px", "16 px", "34 px"]));
    fireEvent.change(size, { target: { value: "text-[34px]" } });
    expect(staged.at(-1)?.after).toContain('className="text-[34px]"');
    fireEvent.change(view.getByTestId("design-properties.weight"), {
      target: { value: "font-semibold" },
    });
    expect(staged.at(-1)).toMatchObject({
      field: "weight",
      after: expect.stringContaining('className="text-[13px] font-semibold"'),
    });
    fireEvent.click(view.getByTestId("design-properties.align.center"));
    expect(staged.at(-1)).toMatchObject({
      field: "align",
      after: expect.stringContaining('className="text-[13px] text-center"'),
    });
  });

  it("offers clearing an explicit size and weight as Inherited, not as the current value", async () => {
    const { view, staged } = await mount('<h1 className="text-[34px] font-bold">Hi</h1>', {
      rendered: rendered("font-size: 34px; font-weight: 700"),
    });
    const size = view.getByTestId("design-properties.size") as HTMLSelectElement;
    await waitFor(() => expect(size.selectedOptions[0]?.textContent).toBe("34 px"));
    expect(size.options[0]?.textContent).toBe("Inherited");
    const weight = view.getByTestId("design-properties.weight") as HTMLSelectElement;
    expect(weight.selectedOptions[0]?.textContent).toBe("Bold");
    expect(weight.options[0]?.textContent).toBe("Inherited");
    fireEvent.change(size, { target: { value: "" } });
    expect(staged.at(-1)?.after).toContain('className="font-bold"');
  });

  it("names the color a dark variant paints over the base class", async () => {
    const tokens: ThemeTokens = {
      colors: [
        { name: "foreground", value: "#0a0a0a", dark: "#fafafa", source: { kind: "project" } },
        { name: "card", value: "#ffffff", dark: "#171717", source: { kind: "project" } },
      ],
      fonts: [],
    };
    const { view } = await mount('<p className="text-foreground dark:text-card">Hi</p>', {
      host: (host) => withTheme(host, tokens),
      rendered: rendered("color: #171717"),
    });
    const field = view.getByTestId("design-properties.color.text");
    await waitFor(() => expect(field.textContent).toContain("#171717"));
    expect(field.textContent).toContain("Card");
    expect(field.textContent).not.toContain("Text");
  });

  it("reads the rendered size again when the device width changes", async () => {
    const { view, store } = await mount("<h1>Hi</h1>", { rendered: rendered("font-size: 28px") });
    const size = view.getByTestId("design-properties.size") as HTMLSelectElement;
    await waitFor(() => expect(size.selectedOptions[0]?.textContent).toBe("28 px · theme"));
    // The phone width's media query renders the heading smaller, with the same render.
    const frame = view.getByTestId("canvas.frame") as HTMLIFrameElement;
    frame.contentDocument!.querySelector("p")!.setAttribute("style", "font-size: 22px");
    act(() => store().getState().actions.setPreviewDevice("mobile"));
    await waitFor(() => expect(size.selectedOptions[0]?.textContent).toBe("22 px · theme"));
  });

  it("marks the control whose edit is still rendering and keeps the rest usable", async () => {
    const { view } = await mount('<p className="mt-2">Hi</p>', { pendingField: "margin-top" });
    const above = view.getByTestId("design-properties.margin-top");
    const field = above.closest('[data-slot="editor-design-field"]');
    expect(field?.hasAttribute("data-pending")).toBe(true);
    expect(within(field as HTMLElement).getByRole("status")).toBeTruthy();
    expect((above as HTMLSelectElement).disabled).toBe(false);
    expect(view.getAllByRole("status")).toHaveLength(1);
  });

  it("writes left alignment explicitly, so an aligned parent does not win", async () => {
    const { view, staged } = await mount('<p className="text-center">Hi</p>');
    fireEvent.click(view.getByTestId("design-properties.align.left"));
    expect(staged.at(-1)?.after).toContain('className="text-left"');
  });

  it("keeps a side the author set when it splits a shorthand", async () => {
    const { view, staged } = await mount('<p className="my-6 mb-2">Hi</p>');
    fireEvent.change(view.getByTestId("design-properties.margin-top"), {
      target: { value: "4" },
    });
    expect(staged.at(-1)).toMatchObject({
      field: "margin-top",
      after: expect.stringContaining('className="mb-2 mt-4"'),
    });
  });

  it("splits a padding shorthand so the other axis keeps its value", async () => {
    const { view, staged } = await mount('<div className="bg-card p-4">Box</div>');
    fireEvent.change(view.getByTestId("design-properties.padding-x"), {
      target: { value: "8" },
    });
    expect(staged.at(-1)?.after).toContain('className="bg-card py-4 px-8"');
    expect(staged.at(-1)?.label).toBe("Change padding sides");
  });

  it("gives an image its description and size, and no type controls", async () => {
    const { view, staged } = await mount(
      '<Image src="logo.png" alt="Logo" width={132} height={32} />',
    );
    expect(view.queryByTestId("design-properties.size")).toBeNull();
    const alt = view.getByTestId("design-properties.alt");
    fireEvent.change(alt, { target: { value: "Nimbus Coffee" } });
    fireEvent.blur(alt);
    expect(staged.at(-1)).toMatchObject({
      field: "alt",
      after: expect.stringContaining('alt="Nimbus Coffee"'),
    });
    const width = view.getByTestId("design-properties.width");
    fireEvent.change(width, { target: { value: "160" } });
    fireEvent.blur(width);
    expect(staged.at(-1)).toMatchObject({
      field: "width",
      after: expect.stringContaining("width={160}"),
    });
  });

  it("sends computed classes to Source instead of overwriting them", async () => {
    const { view } = await mount('<p className={input.vip ? "text-primary" : ""}>Hi</p>');
    expect(view.getByTestId("design-properties.computed").textContent).toContain("Source");
    expect(view.queryByTestId("design-properties.color.text")).toBeNull();
  });
});
