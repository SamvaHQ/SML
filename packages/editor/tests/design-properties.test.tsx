/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  applySourceReplacements,
  inspectSourceElement,
  type SourceReplacement,
} from "@samva/markup/edit";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { DesignProperties } from "../src/chrome/design-properties";
import { EditorProvider } from "../src/state/provider";
import { mockEditor } from "./mock-host";

afterEach(cleanup);

const FILE = "templates/entry.tsx";

/** A one-element source, its parsed element, and the edits the controls hand back. */
const mount = async (element: string) => {
  const source = `const tree = (\n  ${element}\n);\n`;
  const target = inspectSourceElement(source, FILE, {
    fileName: FILE,
    lineNumber: 2,
    columnNumber: 3,
  });
  if (target === null) throw new Error("the element did not parse");
  const staged: Array<{ readonly label: string; readonly after: string }> = [];
  const commit = (edits: readonly SourceReplacement[], label: string) => {
    const result = applySourceReplacements(source, edits);
    if (result.ok) staged.push({ label, after: result.source });
  };
  const refused: string[] = [];
  const editor = await mockEditor();
  const view = render(
    <EditorProvider host={editor.host}>
      <DesignProperties
        source={source}
        entrySource={`${source} "text-primary bg-card text-muted-foreground text-[13px] text-[34px]"`}
        target={target}
        available
        commit={commit}
        onRefused={(reason) => refused.push(reason)}
      />
    </EditorProvider>,
  );
  return { view, staged, refused };
};

describe("Design properties", () => {
  it("edits text around a binding, which stays a chip", async () => {
    const { view, staged } = await mount(
      '<h1 className="text-[34px] mt-3">{input.firstName}, your bag is on us</h1>',
    );
    expect(view.getByTestId("design-properties.binding").textContent).toBe("firstName");
    const text = view.getByTestId("design-properties.text.text.1");
    fireEvent.change(text, { target: { value: ", welcome" } });
    fireEvent.keyDown(text, { key: "Enter" });
    expect(staged.at(-1)).toEqual({
      label: "Edit text",
      after: expect.stringContaining("{input.firstName}, welcome</h1>"),
    });
  });

  it("swaps a theme color, keeping every other class", async () => {
    const { view, staged } = await mount(
      '<p className="text-primary m-0 text-[13px] dark:text-card">Hi</p>',
    );
    fireEvent.click(view.getByTestId("design-properties.color.text.muted-foreground"));
    expect(staged.at(-1)?.after).toContain(
      'className="m-0 text-[13px] dark:text-card text-muted-foreground"',
    );
    expect(staged.at(-1)?.label).toBe("Change text color");
  });

  it("offers the template's own type scale, and sets weight and alignment", async () => {
    const { view, staged } = await mount('<p className="text-[13px]">Hi</p>');
    const size = view.getByTestId("design-properties.size") as HTMLSelectElement;
    expect([...size.options].map((option) => option.textContent)).toEqual([
      "Default",
      "13 px",
      "34 px",
    ]);
    fireEvent.change(size, { target: { value: "text-[34px]" } });
    expect(staged.at(-1)?.after).toContain('className="text-[34px]"');
    fireEvent.change(view.getByTestId("design-properties.weight"), {
      target: { value: "font-semibold" },
    });
    expect(staged.at(-1)?.after).toContain('className="text-[13px] font-semibold"');
    fireEvent.click(view.getByTestId("design-properties.align.center"));
    expect(staged.at(-1)?.after).toContain('className="text-[13px] text-center"');
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
    expect(staged.at(-1)?.after).toContain('className="mb-2 mt-4"');
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
    expect(staged.at(-1)?.after).toContain('alt="Nimbus Coffee"');
    const width = view.getByTestId("design-properties.width");
    fireEvent.change(width, { target: { value: "160" } });
    fireEvent.blur(width);
    expect(staged.at(-1)?.after).toContain("width={160}");
  });

  it("sends computed classes to Source instead of overwriting them", async () => {
    const { view } = await mount('<p className={input.vip ? "text-primary" : ""}>Hi</p>');
    expect(view.getByTestId("design-properties.computed").textContent).toContain("Source");
    expect(view.queryByTestId("design-properties.color.text")).toBeNull();
  });
});
