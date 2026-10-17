import { describe, expect, it } from "@effect/vitest";

import { renderIr } from "../src/render-ir";
import { compileTemplate } from "../src/sml/compile";

// The design layer through the static compiler: the default theme every project compiles
// beneath its own CSS, the dark-mode classes the cascade generates, and the primitives' defaults.

const entry = (body: string): string => `
import { defineTemplate } from "@samva/markup";
import { Email, Section, Button, Columns, Column, Divider, Link } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "design-layer",
  schema: jsonSchema<{ vip: boolean; name: string }>({
    type: "object",
    properties: { vip: { type: "boolean" }, name: { type: "string" } },
    required: ["vip", "name"],
    additionalProperties: false,
  }),
  fixtures: { vip: { vip: true, name: "Ada" }, plain: { vip: false, name: "Bo" } },
  email: { subject: (input) => input.name, body: ${body} },
});
`;

const build = async (body: string, theme?: string) => {
  const compiled = await compileTemplate({
    files: {
      "templates/entry.tsx": entry(body),
      ...(theme === undefined ? {} : { "theme.css": theme }),
    },
    entry: "templates/entry.tsx",
    assetBase: "https://assets.example",
    ...(theme === undefined ? {} : { tailwind: { css: theme, cssPath: "theme.css" } }),
  });
  const failures = compiled.diagnostics.filter((item) => item.severity === "error");
  return {
    compiled,
    failures,
    render: (fixture: "vip" | "plain" = "vip") =>
      renderIr(compiled.ir!, compiled.fixtures[fixture]).html,
  };
};

const head = (html: string): string => /<head>[\s\S]*<\/head>/.exec(html)?.[0] ?? "";
const darkClassOf = (element: string): string => /sml-dark-[a-z0-9]+/.exec(element)?.[0] ?? "";
const darkRule = (html: string, name: string): string =>
  new RegExp(`\\.${name}\\{([^}]*)\\}`).exec(head(html))?.[1] ?? "";
const paragraph = (html: string, text: string): string =>
  new RegExp(`<p[^>]*>${text}</p>`).exec(html)?.[0] ?? "";

describe("the default theme", () => {
  it("resolves the vocabulary's utilities with no theme.css", async () => {
    const { failures, render } = await build(
      `(input) => <Email><p className="bg-background text-primary-foreground rounded font-heading">Hi</p></Email>`,
    );
    expect(failures).toEqual([]);
    const text = paragraph(render(), "Hi");
    expect(text).toContain("background-color:#ffffff");
    expect(text).toContain("color:#fafafa");
    expect(text).toContain("border-radius:8px");
    expect(text).toMatch(/font-family:-apple-system/);
    expect(text).not.toContain("var(");
  });

  it("switches a project theme and its dark-mode block", async () => {
    const theme = `@theme { --color-primary: #e11d48; --radius: 2px; }
@media (prefers-color-scheme: dark) {
  @theme { --color-primary: #fb7185; }
}`;
    const { failures, render } = await build(
      `(input) => <Email><p className="bg-primary text-primary-foreground rounded">Hi</p></Email>`,
      theme,
    );
    expect(failures).toEqual([]);
    const html = render();
    const text = paragraph(html, "Hi");
    // The fill's text color is picked per mode from the fill the theme sets.
    expect(text).toContain("background-color:#e11d48");
    expect(text).toContain("color:#ffffff");
    expect(text).toContain("border-radius:2px");
    const rule = darkRule(html, darkClassOf(text));
    expect(rule).toContain("background-color:#fb7185!important");
    expect(rule).toContain("color:#000000!important");
  });
});

describe("dark classes through the static compiler", () => {
  it("gives each branch of a conditional class its own dark class and rule", async () => {
    const { failures, render } = await build(
      `(input) => <Email><p className={input.vip ? "bg-primary" : "bg-card"}>Hi</p></Email>`,
    );
    expect(failures).toEqual([]);
    const vip = render("vip");
    const plain = render("plain");
    const vipClass = darkClassOf(paragraph(vip, "Hi"));
    const plainClass = darkClassOf(paragraph(plain, "Hi"));
    expect(vipClass).not.toBe("");
    expect(plainClass).not.toBe("");
    expect(vipClass).not.toBe(plainClass);
    // The head carries both branches' rules, whichever one this input renders.
    expect(darkRule(vip, vipClass)).toBe("background-color:#fafafa!important");
    expect(darkRule(vip, plainClass)).toBe("background-color:#171717!important");
    expect(paragraph(vip, "Hi")).toContain("background-color:#171717");
    expect(paragraph(plain, "Hi")).toContain("background-color:#ffffff");
  });

  it("prints the generated block before an explicit dark: utility, which resolves at the dark value", async () => {
    const { failures, render } = await build(
      `(input) => <Email><p className="bg-primary dark:bg-secondary">Hi</p></Email>`,
    );
    expect(failures).toEqual([]);
    const styles = head(render());
    const generated = styles.indexOf("sml-dark-");
    const explicit = styles.indexOf("dark\\:bg-secondary");
    expect(generated).toBeGreaterThan(-1);
    expect(explicit).toBeGreaterThan(generated);
    expect(styles).toMatch(/\.dark\\:bg-secondary\{background-color:#262626!important\}/);
  });

  it("adds no dark class to an element whose colors the dark theme leaves alone", async () => {
    const { failures, render } = await build(
      `(input) => <Email><p className="text-red-500">Hi</p></Email>`,
    );
    expect(failures).toEqual([]);
    expect(darkClassOf(paragraph(render(), "Hi"))).toBe("");
  });
});

describe("primitive defaults", () => {
  it("paints the page and sets the gutter on Email", async () => {
    const { failures, render } = await build(`(input) => <Email>x</Email>`);
    expect(failures).toEqual([]);
    const html = render();
    expect(html).toMatch(/<body[^>]*background-color:#ffffff/);
    expect(html).toMatch(/<table[^>]*bgcolor="#ffffff"[^>]*background-color:#ffffff/);
    expect(html).toMatch(
      /<td class="sml-email[^"]*" style="color:#0a0a0a;font-family:[^"]*padding-left:16px;padding-right:16px"/,
    );
    // The page background and text color switch in dark mode.
    expect(head(html)).toMatch(/background-color:#0a0a0a!important/);
    expect(head(html)).toMatch(/color:#fafafa!important/);
  });

  it("takes an explicit backgroundColor and gutter inline", async () => {
    const { failures, render } = await build(
      `(input) => <Email backgroundColor="#fafafa" gutter={24}>x</Email>`,
    );
    expect(failures).toEqual([]);
    const html = render();
    expect(html).toMatch(/<body[^>]*background-color:#fafafa/);
    expect(html).toContain('bgcolor="#fafafa"');
    expect(html).toContain("padding-left:24px;padding-right:24px");
    expect(html).not.toContain("padding-left:16px");
  });

  it("keeps a Section with a pixel width fluid below it", async () => {
    const { failures, render } = await build(
      `(input) => <Email><Section width={600}>x</Section></Email>`,
    );
    expect(failures).toEqual([]);
    expect(render()).toMatch(/width="600" style="width:100%;max-width:600px"/);
  });

  it("stacks columns by default and keeps the row with stack={false}", async () => {
    const stacking = await build(
      `(input) => <Email><Columns><Column>a</Column><Column>b</Column></Columns></Email>`,
    );
    expect(stacking.failures).toEqual([]);
    const html = stacking.render();
    expect(html.match(/<td class="sml-stack">/g)).toHaveLength(2);
    expect(head(html)).toMatch(/@media only screen and \(max-width:\d+px\)\{\.sml-stack\{/);

    const row = await build(
      `(input) => <Email><Columns stack={false}><Column>a</Column><Column>b</Column></Columns></Email>`,
    );
    expect(row.failures).toEqual([]);
    expect(row.render()).not.toContain('class="sml-stack"');
    expect(row.render()).toContain("<td>a</td><td>b</td>");
  });

  it("refuses a Columns stack that is not a literal", async () => {
    const { failures } = await build(
      `(input) => <Email><Columns stack={input.vip}><Column>a</Column></Columns></Email>`,
    );
    expect(failures.map((item) => item.code)).toEqual(["invalid-columns-stack"]);
  });

  it("refuses a gap whose cells can be hidden", async () => {
    const { failures } = await build(
      `(input) => <Email><Columns gap={24}><Column>a</Column>{input.vip && <Column>b</Column>}</Columns></Email>`,
    );
    expect(failures.map((item) => item.code)).toEqual(["invalid-columns-gap"]);
  });

  it("styles a Button, Divider and Link from the theme", async () => {
    const { failures, render } = await build(
      `(input) => <Email><Button href="https://example.com" height={44}>Go</Button><Divider /><p><Link href="https://example.com">More</Link></p></Email>`,
    );
    expect(failures).toEqual([]);
    const html = render();
    // Every variable is resolved, in the Outlook shape too.
    expect(html).not.toContain("var(");
    expect(html).toContain('fillcolor="#171717"');
    expect(html).toMatch(
      /<a class="sml-button[^"]*" href="https:\/\/example.com"[^>]*style="background-color:#171717;color:#fafafa;font-family:[^"]*border-radius:8px/,
    );
    expect(html).toMatch(/<td class="sml-divider[^"]*" style="border-top:1px solid #e5e5e5/);
    expect(html).toMatch(
      /<a class="sml-link[^"]*" href="https:\/\/example.com"[^>]*style="color:#171717;text-decoration:underline"/,
    );
  });

  it("lets explicit props override the Button and Divider defaults inline", async () => {
    const { failures, render } = await build(
      `(input) => <Email><Button href="https://example.com" height={44} backgroundColor="#e11d48" color="#ffffff" fontFamily="Georgia, serif" borderRadius={4}>Go</Button><Divider color="#cccccc" thickness={3} /></Email>`,
    );
    expect(failures).toEqual([]);
    const html = render();
    expect(html).toContain("background-color:#e11d48;color:#ffffff;border-radius:4px");
    expect(html).toContain("font-family:Georgia, serif");
    expect(html).toContain("border-top:3px solid #cccccc");
    // The Outlook shape draws the same colors.
    expect(html).toContain('fillcolor="#e11d48"');
  });

  it("lets an author class override a primitive's default", async () => {
    const { failures, render } = await build(
      `(input) => <Email><Button href="https://example.com" height={44} className="bg-accent">Go</Button></Email>`,
    );
    expect(failures).toEqual([]);
    const anchor = /<a class="sml-button[^>]*>/.exec(render())?.[0] ?? "";
    expect(anchor).toContain("background-color:#f5f5f5");
    expect(anchor).not.toContain("background-color:#171717");
  });
});
