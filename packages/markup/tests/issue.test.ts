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
import { Button, Email, Section, IssueContent, IssueContent as Content, IssueTitle, IssueTitle as Title, IssueDate, IssueDate as Date } from "@samva/markup/email";
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

  it("inlines escaped title and date text in email and web before styling", async () => {
    const source = issue("Hello")
      .replace("October news", "News <&> 🦊")
      .replace("preheader:", "date: 2026-10-28\npreheader:");
    const result = await compileIssue({
      entry: "issues/october.md",
      files: {
        "issues/october.md": source,
        "layout.tsx": layout("<h1><Title /></h1><p><Date /></p><IssueContent />"),
      },
      assetBase: "",
      tailwind: { css: "h1 { color: #123456; }" },
    });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.frontmatter?.date).toBe("2026-10-28");
    expect(result.template!.email!.subject).toBe("News <&> 🦊");
    for (const target of ["email", "web"] as const) {
      const rendered = render(result.template!, result.fixtures.default, {
        target,
        locale: "fr-FR",
        timeZone: "America/Los_Angeles",
      });
      expect(rendered.html).toContain("News &lt;&amp;&gt; 🦊</h1>");
      expect(rendered.html).toContain("Oct 28, 2026</p>");
      expect(rendered.html).not.toContain("sml-issue-");
      expect(rendered.html).not.toContain('format="date"');
    }
    expect(render(result.template!, result.fixtures.default, { target: "email" }).html).toContain(
      "color:#123456",
    );
  });

  it("omits an absent date without omitting the title", async () => {
    const result = await compile(
      "Hello",
      layout("<h1><IssueTitle /></h1><p>Before<IssueDate />After</p><IssueContent />"),
    );
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    for (const target of ["email", "web"] as const) {
      const rendered = render(result.template!, result.fixtures.default, { target });
      expect(rendered.html).toContain("October news</h1>");
      expect(rendered.html).toContain("BeforeAfter</p>");
    }
  });

  it.each([
    ["<IssueTitle />", "October news"],
    ["<IssueDate />", "Oct 28, 2026"],
  ])("checks a Button's %s child as static text", async (directive, label) => {
    const result = await compileIssue({
      entry: "issue.md",
      files: {
        "issue.md": issue("Hello").replace("preheader:", "date: 2026-10-28\npreheader:"),
        "layout.tsx": layout(
          `<Button height={44} href="https://example.com">${directive}</Button><IssueContent />`,
        ),
      },
      assetBase: "",
      tailwind: false,
    });
    expect(
      result.diagnostics.filter(
        (item) => item.severity === "error" || item.code === "button-outlook-fallback",
      ),
    ).toEqual([]);
    const email = render(result.template!, result.fixtures.default, { target: "email" });
    expect(email.html).toContain("<!--[if mso]><v:roundrect");
    expect(email.html).toContain(`>${label}</center></v:roundrect>`);
  });

  it.each([
    '<Button href="https://example.com"><IssueTitle /></Button>',
    '<Button height={44} href="https://example.com"><IssueDate /></Button>',
  ])("retains genuine Outlook fallback warnings for %s", async (button) => {
    const result = await compile("Hello", layout(`${button}<IssueContent />`));
    expect(result.template).toBeDefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "button-outlook-fallback", severity: "warning" }),
    );
    expect(
      render(result.template!, result.fixtures.default, { target: "email" }).html,
    ).not.toContain("<v:roundrect");
  });

  it("uses literal fmt.date style and locale options at compile time", async () => {
    const result = await compileIssue({
      entry: "issue.md",
      files: {
        "issue.md": issue("Hello").replace("preheader:", "date: '2024-02-29'\npreheader:"),
        "layout.tsx": layout('<p><IssueDate style="long" locale={"en-GB"} /></p><IssueContent />'),
      },
      assetBase: "",
      tailwind: false,
    });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    for (const target of ["email", "web"] as const)
      expect(render(result.template!, result.fixtures.default, { target }).html).toContain(
        "29 February 2024</p>",
      );
  });

  it.each(["IssueTitle", "IssueDate"])("refuses %s outside an issue layout", async (name) => {
    const result = await compileTemplate({
      files: { "layout.tsx": layout(`<${name} />`) },
      entry: "layout.tsx",
      assetBase: "",
      tailwind: false,
    });
    expect(result.template).toBeUndefined();
    expect(
      result.diagnostics.some(
        (item) => item.code === "issue-slot" && item.origins?.[0]?.fileName === "layout.tsx",
      ),
    ).toBe(true);
  });

  it.each([
    '<IssueTitle className="extra" />',
    '<IssueDate format="long" />',
    '<IssueDate style="invalid" />',
    '<IssueDate locale="invalid_locale" />',
    "<IssueDate style={input.show} />",
    "<IssueDate {...input} />",
    '<IssueDate locale="en-US" locale="en-GB" />',
    "<IssueTitle>extra</IssueTitle>",
    "<IssueDate>extra</IssueDate>",
    "{input.show && <IssueTitle />}",
    "{input.show ? <IssueDate /> : null}",
    "{input.items.map((item) => <p><IssueDate /></p>)}",
  ])("refuses invalid metadata directive %s even without a date", async (directive) => {
    const result = await compile("Hello", layout(`${directive}<IssueContent />`));
    expect(result.template).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "issue-slot")).toBe(true);
  });

  it.each(["IssueTitle", "IssueDate"])(
    "checks %s placement after partial expansion",
    async (name) => {
      const shell = layout(`<Wrap show={input.show}><${name} /></Wrap><IssueContent />`).replace(
        "export default",
        "const Wrap = ({ children, show }) => <p>{show && children}</p>;\nexport default",
      );
      const result = await compile("Hello", shell);
      expect(result.template).toBeUndefined();
      expect(result.diagnostics.some((item) => item.code === "issue-slot")).toBe(true);
    },
  );

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

  it.each([
    ["({ children }) => <Section>Discarded</Section>", "<Wrap><IssueContent /></Wrap>"],
    ["({ children }) => <Section>{children}{children}</Section>", "<Wrap><IssueContent /></Wrap>"],
    [
      "({ children, show }) => <Section>{show && children}</Section>",
      "<Wrap show={input.show}><IssueContent /></Wrap>",
    ],
    [
      "({ content, items }) => <Section>{items.map((item) => <Section>{content}</Section>)}</Section>",
      "<Wrap content={<IssueContent />} items={input.items} />",
    ],
  ])("validates slot count and control flow after partial expansion", async (partial, body) => {
    const shell = layout(body).replace(
      "export default",
      `const Wrap = ${partial};\nexport default`,
    );
    const result = await compile("Hello", shell);
    expect(result.template).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "issue-slot")).toBe(true);
  });

  it("allows one unconditional slot forwarded through partial children", async () => {
    const shell = layout("<Wrap><IssueContent /></Wrap>").replace(
      "export default",
      "const Wrap = ({ children }) => <Section>{children}</Section>;\nexport default",
    );
    const result = await compile("Hello", shell);
    expect(result.template).toBeDefined();
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

  it.each(["Line one\nLine two", "    Indented", "First\n\nSecond"])(
    "preserves a selected prose node for %j",
    (value) => {
      const source = issue("# Before");
      const target = inspectMarkdownNode(source, "issues/october.md", {
        fileName: "issues/october.md",
        lineNumber: 7,
        columnNumber: 1,
      })!;
      const edit = literalReplacement(source, target.properties[0]!, value)!;
      const changed = applySourceReplacements(source, [edit], {
        markdown: { file: "issues/october.md" },
      });
      expect(changed.ok).toBe(true);
      if (changed.ok) {
        const selected = inspectMarkdownNode(changed.source, "issues/october.md", {
          fileName: "issues/october.md",
          lineNumber: 7,
          columnNumber: 1,
        });
        expect(selected?.properties[0]?.value).toBe(value);
        expect(changed.source.split("\n").length).toBe(source.split("\n").length);
      }
    },
  );

  it.each(["[label](https://example.com)", "[label][ref]\n\n[ref]: https://example.com"])(
    "keeps a link when its destination gains spaces",
    (body) => {
      const source = issue(body);
      const target = inspectMarkdownNode(source, "issues/october.md", {
        fileName: "issues/october.md",
        lineNumber: 7,
        columnNumber: 1,
      })!;
      const field = target.properties.find((property) => property.name === "href")!;
      const edit = literalReplacement(source, field, "https://example.com/a b")!;
      const changed = applySourceReplacements(source, [edit], {
        markdown: { file: "issues/october.md" },
      });
      expect(changed.ok).toBe(true);
      if (changed.ok)
        expect(
          inspectMarkdownNode(changed.source, "issues/october.md", {
            fileName: "issues/october.md",
            lineNumber: 7,
            columnNumber: 1,
          })?.properties.find((property) => property.name === "href")?.value,
        ).toBe("https://example.com/a b");
    },
  );

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
