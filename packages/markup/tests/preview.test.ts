import { describe, expect, it } from "@effect/vitest";

import { INSTANCE_PATH_ATTRIBUTE, renderIrPreview } from "../src/preview";
import { renderIr } from "../src/render-ir";
import { compileTemplate } from "../src/sml/compile";

const THEME = "@theme { --color-brand: #123456; }";

const SOURCE = `import { defineTemplate } from "@samva/markup";
import { Email, Section, Button } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { Row } from "./partials/row";

export default defineTemplate({
  id: "preview",
  schema: jsonSchema<{ name: string; items: string[]; vip: boolean }>({
    type: "object",
    properties: {
      name: { type: "string" },
      items: { type: "array", items: { type: "string" } },
      vip: { type: "boolean" },
    },
    required: ["name", "items", "vip"],
    additionalProperties: false,
  }),
  fixtures: {
    vip: { name: "Ada", items: ["a", "b"], vip: true },
    plain: { name: "Bo", items: [], vip: false },
  },
  email: {
    subject: (input) => \`Hi \${input.name}\`,
    body: (input) => (
      <Email>
        <Section>
          <h1 className="text-lg">Hello {input.name}</h1>
          {input.vip && <p>Thanks for being a member</p>}
          {input.items.map((item) => (
            <Row label={item} />
          ))}
          <Button href="https://example.com">Go</Button>
        </Section>
      </Email>
    ),
  },
});
`;

const ROW = `export const Row = ({ label }: { label: string }) => <li>{label}</li>;
`;

const compile = async () => {
  const compiled = await compileTemplate({
    files: {
      "templates/preview.tsx": SOURCE,
      "templates/partials/row.tsx": ROW,
      "theme.css": THEME,
    },
    entry: "templates/preview.tsx",
    assetBase: "https://assets.example",
    tailwind: { css: THEME, cssPath: "theme.css" },
  });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return compiled;
};

describe("renderIrPreview", () => {
  it("delivers the same document as renderIr, plus an instance path on every element", async () => {
    const { ir, fixtures } = await compile();
    const input = fixtures.vip;
    const plain = renderIr(ir!, input);
    const preview = renderIrPreview(ir!, input);
    expect(preview.subject).toBe(plain.subject);
    expect(preview.text).toBe(plain.text);
    const stripped = preview.html.replaceAll(
      new RegExp(` ${INSTANCE_PATH_ATTRIBUTE}="[^"]*"`, "g"),
      "",
    );
    expect(stripped).toBe(plain.html);
  });

  it("resolves each stamped element to a selection at its rendered range", async () => {
    const { ir, fixtures } = await compile();
    const preview = renderIrPreview(ir!, fixtures.vip);
    const paths = [
      ...preview.html.matchAll(new RegExp(`${INSTANCE_PATH_ATTRIBUTE}="([^"]*)"`, "g")),
    ].map((match) => match[1]);
    expect(preview.selections.map((selection) => selection.instancePath).toSorted()).toEqual(
      paths.toSorted(),
    );
    for (const selection of preview.selections) {
      const slice = preview.html.slice(selection.start, selection.end);
      expect(slice.startsWith(`<${selection.tag}`)).toBe(true);
      expect(slice).toContain(`${INSTANCE_PATH_ATTRIBUTE}="${selection.instancePath}"`);
    }
  });

  it("points the heading at its span in the entry and a partial's element at its own file", async () => {
    const { ir, fixtures } = await compile();
    const preview = renderIrPreview(ir!, fixtures.vip);
    const heading = preview.selections.find((selection) => selection.tag === "h1");
    const lines = SOURCE.split("\n");
    expect(heading?.origins).toEqual([
      {
        fileName: "templates/preview.tsx",
        lineNumber: lines.findIndex((l) => l.includes("<h1")) + 1,
        columnNumber: lines.find((l) => l.includes("<h1"))!.indexOf("<h1") + 1,
      },
    ]);
    expect(heading?.authored).toBe(true);
    const rows = preview.selections.filter((selection) => selection.tag === "li");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.origins[0]?.fileName)).toEqual([
      "templates/partials/row.tsx",
      "templates/partials/row.tsx",
    ]);
    expect(rows.map((row) => [row.occurrence, row.occurrences])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("selects only what the fixture renders", async () => {
    const { ir, fixtures } = await compile();
    const vip = renderIrPreview(ir!, fixtures.vip);
    const plain = renderIrPreview(ir!, fixtures.plain);
    const membership = (selections: typeof vip.selections) =>
      selections.filter((selection) => selection.tag === "p").length;
    expect(membership(vip.selections)).toBeGreaterThan(membership(plain.selections));
    expect(plain.selections.some((selection) => selection.tag === "li")).toBe(false);
  });

  it("marks the elements a primitive generates as generated, and the one the author wrote as authored", async () => {
    const { ir, fixtures } = await compile();
    const preview = renderIrPreview(ir!, fixtures.vip);
    const sameOrigin = (
      a: (typeof preview.selections)[number],
      b: (typeof preview.selections)[number],
    ) => JSON.stringify(a.origins) === JSON.stringify(b.origins);
    const button = preview.selections.filter((selection) =>
      preview.selections.some(
        (other) => other !== selection && sameOrigin(other, selection) && other.tag === "a",
      ),
    );
    expect(button.length).toBeGreaterThan(1);
    expect(button.filter((selection) => selection.authored)).toHaveLength(1);
  });
});
