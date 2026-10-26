import { describe, expect, it } from "vitest";

import type { CompiledNode } from "../src/compiled-template";
import { isValueNode, type SemanticComponent } from "../src/ir/nodes";
import { compileIssue } from "../src/issue";
import { parseIssue } from "../src/markdown/index";
import { render } from "../src/render";
import { compileTemplate } from "../src/sml/compile";

const metadata = "---\ntitle: Column news\nslug: column-news\ntopic: product\n---\n";
const layout = (body: string) => `
import { defineTemplate } from "@samva/markup";
import { jsonSchema } from "@samva/markup/input-schema";
import { Email, Section, Columns, Column, IssueContent } from "@samva/markup/email";
export default defineTemplate({
  id: "column-news",
  schema: jsonSchema({ type: "object", properties: {} }),
  fixtures: { default: {} },
  email: { subject: () => "Column news", body: () => <Email>${body}</Email> }
});`;

const columnNodes = (nodes: readonly CompiledNode[]): SemanticComponent[] =>
  nodes.flatMap((node): SemanticComponent[] => {
    if (isValueNode(node)) return [];
    return [
      ...("type" in node && node.type === "component" && node.name === "Column" ? [node] : []),
      ...("children" in node && node.children !== undefined ? columnNodes(node.children) : []),
    ];
  });

const cases = [
  {
    name: "bare stack",
    markdown: "<Columns stack><Column>A</Column><Column>B</Column></Columns>",
    stacks: [true, true],
  },
  {
    name: "default stack",
    markdown: "<Columns><Column>A</Column><Column>B</Column></Columns>",
    stacks: [true, true],
  },
  {
    name: "explicit true",
    markdown: '<Columns stack="true"><Column>A</Column><Column>B</Column></Columns>',
    stacks: [true, true],
  },
  {
    name: "explicit false",
    markdown: '<Columns stack="false"><Column>A</Column><Column>B</Column></Columns>',
    stacks: [false, false],
  },
  {
    name: "nested false overrides true and preserves the outer sibling",
    markdown:
      '<Columns><Column><Columns stack="false"><Column>A</Column><Column>B</Column></Columns></Column><Column>C</Column></Columns>',
    stacks: [true, false, false, true],
  },
  {
    name: "nested default resets false",
    markdown:
      '<Columns stack="false"><Column><Columns><Column>A</Column><Column>B</Column></Columns></Column><Column>C</Column></Columns>',
    stacks: [false, true, true, false],
  },
  {
    name: "nested explicit true overrides false",
    markdown:
      '<Columns stack="false"><Column><Columns stack><Column>A</Column></Columns></Column></Columns>',
    stacks: [false, true],
  },
  {
    name: "nested Markdown content",
    markdown: "<Columns><Column>**A**</Column><Column>*B*</Column></Columns>",
    tsx: "<Columns><Column><strong>A</strong></Column><Column><em>B</em></Column></Columns>",
    stacks: [true, true],
  },
  {
    name: "standalone column has no inherited policy",
    markdown: "<Column>A</Column>",
    stacks: [false],
  },
];

describe("Markdown column stacking", () => {
  it.each(cases)("matches TSX email output for $name", async ({ markdown, tsx, stacks }) => {
    const source = metadata + markdown;
    const parsed = parseIssue(source, "issues/columns.md");
    expect(parsed.diagnostics).toEqual([]);
    expect(
      columnNodes(parsed.nodes).map((node) => "emailColumn" in node && node.emailColumn),
    ).toEqual(stacks.map((stack) => ({ stack })));

    const compiled = await compileIssue({
      entry: "issues/columns.md",
      files: { "issues/columns.md": source, "layout.tsx": layout("<IssueContent />") },
      assetBase: "",
      tailwind: false,
    });
    const equivalent = await compileTemplate({
      entry: "template.tsx",
      files: {
        "template.tsx": layout(
          `<p>${tsx ?? markdown.replaceAll('stack="true"', "stack={true}").replaceAll('stack="false"', "stack={false}")}</p>`,
        ),
      },
      assetBase: "",
      tailwind: false,
    });
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(equivalent.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.template).toBeDefined();
    expect(equivalent.template).toBeDefined();
    const email = render(compiled.template!, {}, { target: "email" });
    expect(email).toEqual(render(equivalent.template!, {}, { target: "email" }));
    expect(email.html.match(/<td\b[^>]*class="[^"]*\bsml-stack\b/g) ?? []).toHaveLength(
      stacks.filter(Boolean).length,
    );
  });

  it.each([
    {
      name: "component children reset inherited policy",
      markdown:
        "<Columns><Section><Column>A</Column></Section><Column><Column>B</Column></Column><Column>C</Column></Columns>",
      stacks: [false, true, false, true],
    },
    {
      name: "Markdown inline markup carries policy",
      markdown: "<Columns>**<Column>A</Column>**<Column>B</Column></Columns>",
      stacks: [true, true],
    },
    {
      name: "Markdown blocks carry policy",
      markdown: "<Columns>\n\n> <Column>A</Column>\n\n</Columns>",
      stacks: [true],
    },
  ])("resolves metadata when $name", ({ markdown, stacks }) => {
    const parsed = parseIssue(metadata + markdown, "issues/columns.md");
    expect(parsed.diagnostics).toEqual([]);
    expect(
      columnNodes(parsed.nodes).map((node) => "emailColumn" in node && node.emailColumn),
    ).toEqual(stacks.map((stack) => ({ stack })));
  });

  it("retains exact nested column and attribute positions with CRLF and Unicode", () => {
    const source =
      metadata.replaceAll("\n", "\r\n") +
      '<Columns stack="false">\r\n<Column>\r\nCafé 🦊\r\n\r\n<Columns stack>\r\n<Column>A</Column>\r\n</Columns>\r\n</Column>\r\n</Columns>';
    const parsed = parseIssue(source, "issues/columns.md");
    expect(parsed.diagnostics).toEqual([]);
    expect(columnNodes(parsed.nodes)).toMatchObject([
      { emailColumn: { stack: false }, src: [7, 1, 0] },
      { emailColumn: { stack: true }, src: [11, 1, 0] },
    ]);
    const columns = parsed.sourceNodes.filter((node) => node.tag === "Column");
    expect(columns.map((node) => [node.start, node.end])).toEqual([
      [source.indexOf("<Column>"), source.lastIndexOf("</Column>") + "</Column>".length],
      [source.indexOf("<Column>A"), source.indexOf("<Column>A") + "<Column>A</Column>".length],
    ]);
    expect(source.slice(columns[0]!.contentStart, columns[0]!.contentEnd)).toBe(
      "\r\nCafé 🦊\r\n\r\n<Columns stack>\r\n<Column>A</Column>\r\n</Columns>\r\n",
    );
    const rows = parsed.sourceNodes.filter((node) => node.tag === "Columns");
    expect(
      rows.map((node) => node.properties.map((prop) => source.slice(prop.start, prop.end))),
    ).toEqual([['"false"'], ["stack"]]);
  });
});
