import { describe, expect, it } from "@effect/vitest";

import { compileIssue } from "../src/issue";
import { render } from "../src/render";
import { compileTemplate } from "../src/sml/compile";
import {
  applySourceReplacements,
  inspectMarkdownNode,
  literalReplacement,
} from "../src/source-edit";

const issue = (body: string, slug = "october") =>
  `---\ntitle: October news\nslug: ${slug}\ntopic: product\npreheader: This month\n---\n${body}\n`;
const layout = (body = "<IssueContent />") => `
import { defineTemplate } from "@samva/markup";
import { jsonSchema } from "@samva/markup/input-schema";
import { Email, Section, IssueContent, IssueContent as Content } from "@samva/markup/email";
export default defineTemplate({
  id: "newsletter-layout",
  schema: jsonSchema({ type: "object", properties: { show: { type: "boolean" }, items: { type: "array", items: { type: "string" } } }, required: ["show", "items"] }),
  fixtures: { default: { show: true, items: ["one"] } },
  email: { subject: () => "Layout subject", body: (input) => <Email><Section className="issue">${body}</Section><p className="after">After</p></Email> }
});`;

const compile = (body: string, shell = layout()) =>
  compileIssue({
    entry: "issues/october.md",
    files: { "issues/october.md": issue(body), "layout.tsx": shell },
    assetBase: "",
    tailwind: { css: ".issue p { color: #123456; } .after { color: #654321; }" },
  });

describe("issue layout compilation", () => {
  it("inserts semantic nodes before styling and retains both source files", async () => {
    const result = await compile(
      '# Hello\n\nMarkdown prose\n\n<Button href="https://example.com" className="text-red-500">Read more</Button>',
    );
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const template = result.template!;
    expect(template.template).toBe("october");
    expect(template.sources).toEqual(["layout.tsx", "issues/october.md"]);
    const email = render(template, result.fixtures.default, { target: "email" });
    expect(email.subject).toBe("October news");
    expect(email.preheader).toBe("This month");
    expect(email.html).toContain("color:#123456");
    expect(email.html).toContain("color:#654321");
    expect(email.html).toContain("Read more");
    expect(email.html).not.toContain("IssueContent");
    const web = render(template, result.fixtures.default, { target: "web" });
    expect(web.html).toContain("<h1");
    expect(web.html).toContain("Hello</h1>");
    expect(web.headHints.styles).toContain("text-red-500");
    expect(web.positions.some((position) => position.tag === "h1" && position.src?.[2] === 1)).toBe(
      true,
    );
    expect(web.positions.some((position) => position.tag === "p" && position.src?.[2] !== 1)).toBe(
      true,
    );
  });

  it("recognizes the imported slot identity through an alias", async () => {
    expect((await compile("Hello", layout("<Content />"))).template).toBeDefined();
  });

  it.each([
    "<p>No slot</p>",
    "<IssueContent /><IssueContent />",
    '<IssueContent className="extra" />',
    "<IssueContent>extra</IssueContent>",
    "{input.show && <IssueContent />}",
    "{input.show ? <IssueContent /> : null}",
    "{input.items.map((item) => <Section><IssueContent /></Section>)}",
  ])("refuses malformed or non-singleton slot %s", async (body) => {
    const result = await compile("Hello", layout(body));
    expect(result.template).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "issue-slot")).toBe(true);
  });

  it("refuses an unresolved slot in an ordinary template", async () => {
    const result = await compileTemplate({
      files: { "layout.tsx": layout() },
      entry: "layout.tsx",
      assetBase: "",
      tailwind: false,
    });
    expect(result.template).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "issue-slot")).toBe(true);
  });

  it("reports a missing layout and missing issue source", async () => {
    const result = await compileIssue({
      files: { "issues/october.md": issue("Hello") },
      entry: "issues/october.md",
      assetBase: "",
    });
    expect(result.template).toBeUndefined();
    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
    expect(
      (await compileIssue({ files: {}, entry: "issues/missing.md", assetBase: "" })).diagnostics[0]
        ?.code,
    ).toBe("markdown-syntax");
  });
});

describe("Markdown source replacements", () => {
  it.each(["\n", "\r\n"])("round-trips prose with %j newlines and Unicode", (newline) => {
    const source = issue("# Hi 👋\n\nPlain prose").replaceAll("\n", newline);
    const target = inspectMarkdownNode(source, "issues/october.md", {
      fileName: "issues/october.md",
      lineNumber: 9,
      columnNumber: 1,
    })!;
    expect(target).not.toBeNull();
    const field = target.properties.find((item) => item.name === "children")!;
    expect(source.slice(field.start, field.end)).toBe("Plain prose");
    const replacement = literalReplacement(source, field, "Changed *literal* <text> {safe}")!;
    const result = applySourceReplacements(source, [replacement], {
      markdown: { file: "issues/october.md" },
    });
    expect(result.ok).toBe(true);
    expect(
      inspectMarkdownNode(result.ok ? result.source : "", "issues/october.md", {
        fileName: "issues/october.md",
        lineNumber: 9,
        columnNumber: 1,
      })?.properties[0]?.value,
    ).toBe("Changed *literal* <text> {safe}");
  });

  it("round-trips escaped component props and refuses injected HTML", () => {
    const source = issue('<Button href="https://example.com">Read</Button>');
    const target = inspectMarkdownNode(source, "issues/october.md", {
      fileName: "issues/october.md",
      lineNumber: 7,
      columnNumber: 1,
    })!;
    const field = target.properties.find((item) => item.name === "href")!;
    const replacement = literalReplacement(source, field, "https://example.com/?a=1&b=2")!;
    const result = applySourceReplacements(source, [replacement], {
      markdown: { file: "issues/october.md" },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.source).toContain("&amp;");
    expect(
      applySourceReplacements(
        source,
        [
          {
            start: source.length,
            end: source.length,
            before: "",
            after: "\n<script>alert(1)</script>",
          },
        ],
        { markdown: { file: "issues/october.md" } },
      ).ok,
    ).toBe(false);
    expect(
      applySourceReplacements(` ${source}`, [replacement], {
        markdown: { file: "issues/october.md" },
      }).ok,
    ).toBe(false);
  });
});
