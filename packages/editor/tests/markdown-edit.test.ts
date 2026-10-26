import { describe, expect, it } from "@effect/vitest";
import { applySourceReplacements } from "@samva/markup/edit";
import { parseIssue } from "@samva/markup/markdown";

import { markdownEdit, type MarkdownChange } from "../src/state/markdown-edit";

const file = "issues/news.md";
const metadata = "---\ntitle: News\nslug: news\ntopic: product\n---\n";
const origin = { fileName: file, lineNumber: 6, columnNumber: 1 };

const edited = (body: string, change: MarkdownChange, tag: string) => {
  const source = metadata + body;
  const result = markdownEdit(source, file, origin, change, { tag });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  const applied = applySourceReplacements(source, result.edits, { markdown: { file } });
  expect(applied.ok).toBe(true);
  if (!applied.ok) throw new Error(applied.reason);
  expect(
    parseIssue(applied.source, file).diagnostics.filter((item) => item.severity === "error"),
  ).toEqual([]);
  return { ...applied, edits: result.edits, issue: parseIssue(applied.source, file) };
};

describe("plain text Markdown edits", () => {
  it("returns an exact prose replacement", () => {
    const result = edited("Hello", { kind: "text", text: "Welcome" }, "p");
    expect(result.edits).toEqual([
      { start: metadata.length, end: metadata.length + 5, before: "Hello", after: "Welcome" },
    ]);
    expect(result.source).toBe(metadata + "Welcome");
    expect(result.issue.nodes).toMatchObject([{ tag: "p", children: ["Welcome"] }]);
  });

  it.each([
    "**bold** [link](https://example.com) _em_ `code`",
    "<Button>{input.name}</Button> & &#65; \\",
    "# Heading\n\n- list\n> quote\n---",
    "  leading and trailing  ",
    "tabs\tand\r\nline breaks",
    "Café 😀",
  ])("round-trips %j without introducing formatting", (text) => {
    const result = edited("Hello", { kind: "text", text }, "p");
    expect(result.issue.nodes).toMatchObject([{ tag: "p", children: [text] }]);
    expect(result.issue.sourceNodes.filter((node) => node.kind !== "text")).toHaveLength(1);
  });

  it.each([
    ["# Heading", "h1"],
    ["**Bold** trailing", "strong"],
    ["[Read](https://example.com) more", "a"],
  ])("preserves the surrounding formatting of %s", (body, tag) => {
    const result = edited(body, { kind: "text", text: "New *text*" }, tag);
    expect(
      result.issue.sourceNodes
        .find((node) => node.tag === tag)
        ?.properties.find((property) => property.name === "children")?.value,
    ).toBe("New *text*");
  });

  it("changes a destination without changing its label", () => {
    const result = edited(
      "[Read](https://example.com)",
      { kind: "property", name: "href", value: "https://example.com/a(b)?x=1&y=2" },
      "a",
    );
    expect(result.source).toBe(
      metadata + "[Read](https\\:\\/\\/example\\.com\\/a\\(b\\)\\?x\\=1\\&y\\=2)",
    );
    expect(result.issue.sourceNodes.find((node) => node.tag === "a")?.properties).toContainEqual(
      expect.objectContaining({ name: "href", value: "https://example.com/a(b)?x=1&y=2" }),
    );
    expect(result.issue.nodes).toMatchObject([{ children: [{ tag: "a", children: ["Read"] }] }]);
  });

  it("escapes image descriptions", () => {
    const text = "A [logo] & icon";
    const result = edited(
      "![Logo](https://example.com/logo.png)",
      { kind: "property", name: "alt", value: text },
      "img",
    );
    expect(result.issue.sourceNodes.find((node) => node.tag === "img")?.properties).toContainEqual(
      expect.objectContaining({ name: "alt", value: text }),
    );
  });

  it("edits quoted component attributes without injecting markup", () => {
    const value = 'https://example.com/"<{next}&';
    const result = edited(
      '<Button href="https://example.com">Read</Button>',
      { kind: "property", name: "href", value },
      "Button",
    );
    expect(
      result.issue.sourceNodes.find((node) => node.tag === "Button")?.properties,
    ).toContainEqual(expect.objectContaining({ name: "href", value }));
  });

  it("edits a boolean shorthand as a quoted literal", () => {
    const result = edited(
      "<Columns stack><Column>Text</Column></Columns>",
      { kind: "property", name: "stack", value: "false" },
      "Columns",
    );
    expect(result.source).toBe(metadata + '<Columns stack="false"><Column>Text</Column></Columns>');
    expect(
      result.issue.sourceNodes.find((node) => node.tag === "Columns")?.properties,
    ).toContainEqual(expect.objectContaining({ name: "stack", value: false }));
  });

  it.each([
    ["[Read](https://example.com) more", "p", "Replacement"],
    ["Hello", "p", ""],
    ["Hello", "p", "\0"],
  ])("refuses an edit that cannot preserve the selected text in %s", (body, tag, text) => {
    const result = markdownEdit(metadata + body, file, origin, { kind: "text", text }, { tag });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toMatch(/markdown|span|file|path/i);
  });

  it("refuses unknown properties and stale origins", () => {
    expect(
      markdownEdit(metadata + "Hello", file, origin, {
        kind: "property",
        name: "href",
        value: "https://example.com",
      }).ok,
    ).toBe(false);
    expect(
      markdownEdit(
        metadata + "Hello",
        file,
        { ...origin, lineNumber: 20 },
        {
          kind: "text",
          text: "Changed",
        },
      ).ok,
    ).toBe(false);
  });
});
