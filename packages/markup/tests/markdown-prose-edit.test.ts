import { describe, expect, it } from "@effect/vitest";

import { parseIssue } from "../src/markdown";
import {
  applySourceReplacements,
  inspectMarkdownNode,
  literalReplacement,
} from "../src/source-edit";

const file = "issues/prose.md";
const metadata = "---\ntitle: Prose\nslug: prose\ntopic: product\n---\n";
const contexts = [
  { name: "paragraph", body: "Before", tag: "p" },
  { name: "ATX heading", body: "## Before", tag: "h2" },
  { name: "ATX heading with closer", body: "### Before ###", tag: "h3" },
  { name: "setext heading equals", body: "Before\n======", tag: "h1" },
  { name: "setext heading dashes", body: "Before\n------", tag: "h2" },
  { name: "list item", body: "- Before\n- Keep sibling", tag: "p" },
  { name: "ordered list item", body: "3. Before\n4. Keep sibling", tag: "p" },
  { name: "list continuation paragraph", body: "- item\n\n    Before", tag: "p" },
  { name: "list continuation ATX heading", body: "- item\n\n    ## Before", tag: "h2" },
  { name: "list continuation setext heading", body: "- item\n\n    Before\n    ------", tag: "h2" },
  { name: "quote list continuation", body: "> - item\n>\n>     Before", tag: "p" },
  { name: "nested list continuation", body: "- parent\n  - item\n\n      Before", tag: "p" },
  { name: "blockquote", body: "> Before", tag: "p" },
  { name: "nested containers", body: "> - > Before\n> - Keep sibling", tag: "p" },
  { name: "strong", body: "**Before** and keep *emphasis*", tag: "strong" },
  { name: "emphasis", body: "*Before* and keep **strong**", tag: "em" },
  {
    name: "link label",
    body: '[Before](https://example.com/path "Keep title") and keep prose',
    tag: "a",
  },
  {
    name: "static component child",
    body: '<Button href="https://example.com/path" width="200" height="44">Before</Button>',
    tag: "Button",
  },
];

// Finite and deterministic: each literal is tried in every authored context, without sampling.
const corpus = [
  Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33)).join(""),
  "Hello, world. It's 50% off (today)!",
  "worldwide, today",
  "Title #",
  "Title ###",
  "#",
  "#not-a-heading",
  "####### not a heading",
  "A > B; R&D, AT&T and C:\\Work\\newsletters",
  "~~~language",
  "1.",
  "1)",
  "0. ordered",
  "1234567890. not a list marker",
  'Commas, periods. Apostrophes\' colons: parentheses () percent % exclamation! "quotes"?',
  "**strong** *emphasis* __strong__ _emphasis_ ~tilde~ \\backslash",
  "`inline code` and ``two ` ticks``",
  '[link](https://example.com "title") ![image](image.png) [reference][id]',
  '<Button href="https://example.com">raw JSX</Button> <div>HTML-looking</div>',
  "{input.name} {dangerous()} {...props} <!-- comment-looking -->",
  "&amp; &lt; &#35; &#x7b; &copy; &unknown;",
  "# heading",
  "> quote",
  "+ list",
  "- list",
  "* list",
  "1. ordered",
  "1) ordered",
  "123456789. ordered",
  "123456789) ordered",
  "=",
  "===",
  "-",
  "---",
  "~~~ fence",
  "``` fence",
  "before\n===\nafter",
  "before\n---\nafter",
  "before\n~~~\nafter",
  "before\n```\nafter",
  " leading and trailing ",
  "    indented    ",
  "\tleading\tand trailing\t",
  " ",
  "\t",
  "\n",
  "\r\n",
  "\n\nBefore another block\n\n",
  "first\nsecond\rthird\r\nfourth",
  "  \tfirst  \n\tsecond\r\n  third\t ",
  "नमस्ते दुनिया — café e\u0301 中文 👩🏽‍💻 🌍",
];

// Source tuples move when a literal changes length; all semantic fields must survive verbatim.
const semanticTree = (value: unknown, replacement?: string): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, child: unknown) =>
      key === "src" && Array.isArray(child)
        ? undefined
        : child === "Before"
          ? (replacement ?? child)
          : child,
    ),
  );

const selectProse = (source: string, tag: string) => {
  const parsed = parseIssue(source, file);
  expect(parsed.diagnostics).toEqual([]);
  const authored = parsed.sourceNodes.find(
    (node) =>
      node.tag === tag &&
      node.properties.some(
        (property) => property.name === "children" && property.value === "Before",
      ),
  );
  expect(authored).toBeDefined();
  const selected = inspectMarkdownNode(
    source,
    file,
    { fileName: file, lineNumber: authored!.src[0], columnNumber: authored!.src[1] },
    { tag },
  );
  expect(selected?.tag).toBe(tag);
  const field = selected!.properties.find((property) => property.name === "children");
  expect(field?.value).toBe("Before");
  expect(source.slice(field!.start, field!.end)).toBe("Before");
  return { parsed, field: field! };
};

describe("Markdown prose literal round trips", () => {
  for (const context of contexts) {
    describe(context.name, () => {
      it.each(corpus)("preserves decoded text and semantic structure for %j", (value) => {
        const source =
          metadata + "Keep preceding prose.\n\n" + context.body + "\n\nKeep following prose.";
        const { parsed, field } = selectProse(source, context.tag);
        const replacement = literalReplacement(source, field, value);
        expect(replacement).not.toBeNull();
        expect(replacement).toMatchObject({ start: field.start, end: field.end, before: "Before" });
        const changed = applySourceReplacements(source, [replacement!], { markdown: { file } });
        expect(changed.ok, JSON.stringify(changed)).toBe(true);
        if (!changed.ok) return;
        expect(changed.source).toBe(
          source.slice(0, field.start) + replacement!.after + source.slice(field.end),
        );
        const reparsed = parseIssue(changed.source, file);
        expect(reparsed.diagnostics).toEqual([]);
        expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
        expect(semanticTree(reparsed.nodes)).toEqual(semanticTree(parsed.nodes, value));
      });

      it.each([
        "Hello, world. It's 50% off (today)!",
        "worldwide, today",
        "Details: 'today' (really), 50% off. Yes!",
      ])("keeps ordinary prose byte-identical: %s", (value) => {
        const source = metadata + context.body;
        const { field } = selectProse(source, context.tag);
        const replacement = literalReplacement(source, field, value);
        expect(replacement).toEqual({
          start: field.start,
          end: field.end,
          before: "Before",
          after: value,
        });
        expect(applySourceReplacements(source, [replacement!], { markdown: { file } })).toEqual({
          ok: true,
          source: source.slice(0, field.start) + value + source.slice(field.end),
        });
      });
    });
  }
});
