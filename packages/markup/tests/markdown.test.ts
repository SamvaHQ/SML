import { describe, expect, it } from "vitest";

import type { CompiledNode } from "../src/compiled-template";
import { isValueNode } from "../src/ir/nodes";
import { parseIssue } from "../src/markdown/index";

const metadata = "---\ntitle: Weekly news\nslug: weekly-news\ntopic: product\n---\n";
const issue = (body: string) => parseIssue(metadata + body, "issues/weekly.md");
const find = (nodes: readonly CompiledNode[], tag: string): CompiledNode | undefined => {
  for (const node of nodes) {
    if (isValueNode(node)) continue;
    if (
      "type" in node &&
      ((node.type === "component" && node.name === tag) || ("tag" in node && node.tag === tag))
    )
      return node;
    if ("children" in node && node.children !== undefined) {
      const found = find(node.children, tag);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

describe("static SML Markdown", () => {
  it("lowers headings, lists and inline semantics with source locations", () => {
    const parsed = issue(
      "# Hello\n\nA **bold** and *gentle* `code` paragraph.\n\n3. First\n4. Second\n\n- One\n- Two\n\n> Quoted\n\n---\n\n```ts\nconst x = '<Script />';\n```\n",
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sources).toEqual(["issues/weekly.md"]);
    expect(parsed.nodes[0]).toEqual({
      type: "block",
      tag: "h1",
      children: ["Hello"],
      src: [6, 1, 0],
    });
    expect(find(parsed.nodes, "strong")).toMatchObject({ type: "inline", children: ["bold"] });
    expect(find(parsed.nodes, "em")).toMatchObject({ type: "inline", children: ["gentle"] });
    expect(find(parsed.nodes, "ol")).toMatchObject({ attrs: { start: 3 } });
    for (const tag of ["ul", "li", "blockquote", "hr", "pre", "code"])
      expect(find(parsed.nodes, tag)).toBeDefined();
  });

  it("keeps Markdown and nested static components inside component children", () => {
    const parsed = issue(
      '<Section className="px-4">\n## Heading\n\nA **bold** sentence and <Link href="https://example.com">link</Link>.\n\n<Columns stack gap="12">\n<Column>\nFirst\n</Column>\n<Column>\nSecond\n</Column>\n</Columns>\n</Section>',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes[0]).toMatchObject({
      type: "component",
      name: "Section",
      props: { className: "px-4" },
    });
    expect(find(parsed.nodes, "Columns")).toMatchObject({ props: { stack: true, gap: 12 } });
    expect(find(parsed.nodes, "h2")).toMatchObject({ children: ["Heading"] });
    expect(find(parsed.nodes, "Link")).toMatchObject({ children: ["link"] });
  });

  it("decodes scalar props and records exact quoted and bare boolean ranges", () => {
    const body =
      '<Columns stack="false" gap="12"><Column><Button href="https://example.com?a=1&amp;b=2" width="200" height="44">Read &amp; go</Button></Column></Columns>\n\n<Columns stack />';
    const source = metadata + body;
    const parsed = parseIssue(source, "issue.md");
    expect(parsed.diagnostics).toEqual([]);
    const button = parsed.sourceNodes.find((node) => node.tag === "Button")!;
    const href = button.properties.find((prop) => prop.name === "href")!;
    expect(href.value).toBe("https://example.com?a=1&b=2");
    expect(source.slice(href.start, href.end)).toBe('"https://example.com?a=1&amp;b=2"');
    expect(href).toMatchObject({ literalType: "string", syntax: "quoted" });
    expect(source.slice(button.contentStart, button.contentEnd)).toBe("Read &amp; go");
    expect(find(parsed.nodes, "Button")).toMatchObject({
      props: { width: 200 },
      children: ["Read & go"],
    });
    const columns = parsed.sourceNodes.filter((node) => node.tag === "Columns");
    expect(columns[0]?.properties[0]).toMatchObject({
      value: false,
      literalType: "boolean",
      syntax: "quoted",
    });
    const bare = columns[1]!.properties[0]!;
    expect(source.slice(bare.start, bare.end)).toBe("stack");
    expect(bare).toMatchObject({ value: true, literalType: "boolean", syntax: "boolean" });
    expect(parsed.sourceNodes.every((node) => Array.isArray(node.properties))).toBe(true);
  });

  it("retains brand nodes for host resolution", () => {
    const parsed = issue(
      '<BrandLogo width="144" alt="Company" />\n\n<BrandFooter unsubscribeLabel="Leave" />',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes).toMatchObject([
      { name: "BrandLogo", props: { width: 144 } },
      { name: "BrandFooter" },
    ]);
    expect(find(parsed.nodes, "BrandLogo")).not.toHaveProperty("brand");
  });

  it("preserves CRLF and Unicode offsets without normalizing authored source", () => {
    const prefix = metadata.replaceAll("\n", "\r\n");
    const source =
      prefix + '# Café 🦊\r\n\r\n<Section className="café">\r\nHello 🦊\r\n</Section>\r\n';
    const parsed = parseIssue(source, "unicode.md");
    expect(parsed.diagnostics).toEqual([]);
    const heading = parsed.sourceNodes.find((node) => node.tag === "h1")!;
    expect(heading).toMatchObject({
      start: prefix.length,
      end: prefix.length + "# Café 🦊".length,
      src: [6, 1, 0],
    });
    expect(source.slice(heading.contentStart, heading.contentEnd)).toBe("Café 🦊");
    const section = parsed.sourceNodes.find((node) => node.tag === "Section")!;
    expect(section.src).toEqual([8, 1, 0]);
    expect(source.slice(section.contentStart, section.contentEnd)).toBe("\r\nHello 🦊\r\n");
    const prop = section.properties[0]!;
    expect(source.slice(prop.start, prop.end)).toBe('"café"');
  });

  it("maps link, image and reference properties to exact authored spans", () => {
    const source =
      metadata +
      '[label](https://example.com/a_(b) "Title")\n\n![a\\]b](<https://example.com/image> "Caption")\n\n[reference][ref]\n\n[ref]: https://example.com/reference "Reference"';
    const parsed = parseIssue(source, "issue.md");
    expect(parsed.diagnostics).toEqual([]);
    expect(find(parsed.nodes, "a")).toMatchObject({
      attrs: { href: "https://example.com/a_(b)", title: "Title" },
    });
    expect(find(parsed.nodes, "img")).toMatchObject({
      attrs: { src: "https://example.com/image", alt: "a]b", title: "Caption" },
    });
    const links = parsed.sourceNodes.filter((node) => node.tag === "a");
    const image = parsed.sourceNodes.find((node) => node.tag === "img")!;
    for (const [record, name, raw] of [
      [links[0]!, "href", "https://example.com/a_(b)"],
      [links[1]!, "href", "https://example.com/reference"],
      [image, "alt", "a\\]b"],
      [image, "src", "https://example.com/image"],
      [image, "title", "Caption"],
    ] as const) {
      const prop = record.properties.find((property) => property.name === name)!;
      expect(source.slice(prop.start, prop.end)).toBe(raw);
    }
  });

  it("keeps destination offsets after inline code brackets in link labels", () => {
    const source = metadata + "[a `]` b](https://example.com)";
    const parsed = parseIssue(source, "issue.md");
    expect(parsed.diagnostics).toEqual([]);
    const field = parsed.sourceNodes
      .find((node) => node.tag === "a")!
      .properties.find((prop) => prop.name === "href")!;
    expect(source.slice(field.start, field.end)).toBe("https://example.com");
  });

  it("supports a source-only prose and attribute replacement followed by reparse", () => {
    const source =
      metadata + '# Before\n\n<Button href="https://example.com" width="200">Read</Button>';
    const parsed = parseIssue(source, "issue.md");
    const heading = parsed.sourceNodes.find((node) => node.tag === "h1")!;
    const changed =
      source.slice(0, heading.contentStart) + "After 🦊" + source.slice(heading.contentEnd);
    expect(parseIssue(changed, "issue.md").nodes[0]).toMatchObject({ children: ["After 🦊"] });
    const width = parsed.sourceNodes
      .find((node) => node.tag === "Button")!
      .properties.find((prop) => prop.name === "width")!;
    const wider = source.slice(0, width.start) + '"240"' + source.slice(width.end);
    expect(find(parseIssue(wider, "issue.md").nodes, "Button")).toMatchObject({
      props: { width: 240 },
    });
  });

  it.each([
    ["<Script />", "unknown-component"],
    ["<Script>hello</Script>", "unknown-component"],
    ["<div>raw HTML</div>", "markdown-html"],
    ["<!-- comment -->", "markdown-html"],
    ["<!DOCTYPE html>", "markdown-html"],
    ["<Section>{dangerous()}</Section>", "markdown-expression"],
    ["{globalThis.executed = true}", "markdown-expression"],
    ['<Button href={"https://example.com"}>Read</Button>', "markdown-expression"],
    ["<Section {...props} />", "markdown-expression"],
    ['<Section onclick="alert(1)" />', "markdown-prop"],
    ['<Section className="a" className="b" />', "markdown-prop"],
    ['<Button width="big">Read</Button>', "markdown-prop"],
    ['<Columns stack="yes" />', "markdown-prop"],
    ['<Spacer height="-2" />', "invalid-attribute-value"],
    ['<BrandLogo width="-2" />', "invalid-attribute-value"],
    ['<Image src="https://example.com" />', "markdown-prop"],
    ['<Button href="javascript:alert(1)">Read</Button>', "unsafe-url"],
    ["[unsafe](javascript:alert%281%29)", "unsafe-url"],
    ["![unsafe](data:image/png;base64,ABC)", "unsafe-url"],
    ["<Section>", "markdown-syntax"],
  ])("refuses %s with %s and no usable nodes", (body, code) => {
    const parsed = issue("# Valid first block\n\n" + body);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.diagnostics.some((item) => item.code === code && item.severity === "error")).toBe(
      true,
    );
    expect(
      parsed.diagnostics.every((item) => item.origins[0]?.fileName === "issues/weekly.md"),
    ).toBe(true);
  });

  it("never evaluates expression content", () => {
    const parsed = issue('{(() => { throw new Error("must not execute") })()}');
    expect(parsed.nodes).toEqual([]);
    expect(parsed.diagnostics[0]?.code).toBe("markdown-expression");
  });

  it("accepts expression-looking text only when authored as escaped text or code", () => {
    const parsed = issue(
      'Escaped \\{literal\\} and `{code}`.\n\n```tsx\n<Script>{eval("x")}</Script>\n```',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.length).toBe(2);
  });
});

describe("issue frontmatter", () => {
  it("reads required fields and typed optional metadata", () => {
    const source =
      '---\ntitle: "News 🦊"\nslug: news-2026\ntopic: product\npreheader: Preview\nseo:\n  title: SEO title\n  description: Description\n  image: https://example.com/image.png\ngate:\n  leadIn: 0\n---\n# Hello';
    const parsed = parseIssue(source, "issue.md");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.frontmatter).toEqual({
      title: "News 🦊",
      slug: "news-2026",
      topic: "product",
      preheader: "Preview",
      seo: {
        title: "SEO title",
        description: "Description",
        image: "https://example.com/image.png",
      },
      gate: { leadIn: 0 },
    });
    expect(parsed.nodes[0]).toMatchObject({ src: [13, 1, 0] });
  });

  it.each([
    "title: News\nslug: news",
    "title: ''\nslug: news\ntopic: product",
    "title: News\nslug: News_Slug\ntopic: product",
    "title: 42\nslug: news\ntopic: product",
    "title: News\nslug: news\ntopic: false",
    "title: News\ntitle: Duplicate\nslug: news\ntopic: product",
    "title: [unterminated\nslug: news\ntopic: product",
    "title: News\nslug: news\ntopic: product\nunknown: field",
    "title: News\nslug: news\ntopic: product\npreheader: 42",
    "title: News\nslug: news\ntopic: product\nseo: []",
    "title: News\nslug: news\ntopic: product\nseo: {unknown: value}",
    "title: News\nslug: news\ntopic: product\nseo: {title: 42}",
    "title: News\nslug: news\ntopic: product\nseo: {image: 'javascript:alert(1)'}",
    "title: News\nslug: news\ntopic: product\nseo: {image: 'http://example.com/image.png'}",
    "title: News\nslug: news\ntopic: product\nseo: {image: 'https://user:password@example.com/image.png'}",
    "title: News\nslug: news\ntopic: product\ngate: {leadIn: -1}",
    "title: News\nslug: news\ntopic: product\ngate: {leadIn: 1.5}",
    "title: News\nslug: news\ntopic: product\ngate: {leadIn: '2'}",
    "title: News\nslug: news\ntopic: product\ngate: {leadingBlocks: 2}",
    "title: &title News\nslug: news\ntopic: *title",
    "title: !!str News\nslug: news\ntopic: product",
    "- title\n- slug\n- topic",
  ])("rejects invalid YAML metadata: %s", (yaml) => {
    const parsed = parseIssue(`---\n${yaml}\n---\n# Content`, "issue.md");
    expect(parsed.nodes).toEqual([]);
    expect(parsed.frontmatter).toBeUndefined();
    expect(parsed.diagnostics.some((item) => item.code === "markdown-frontmatter")).toBe(true);
  });

  it("requires a closed frontmatter block", () => {
    for (const source of [
      "# No metadata",
      "---\ntitle: Unclosed\nslug: unclosed\ntopic: product",
    ]) {
      const parsed = parseIssue(source, "issue.md");
      expect(parsed.nodes).toEqual([]);
      expect(parsed.diagnostics[0]?.code).toBe("markdown-frontmatter");
    }
  });
});
