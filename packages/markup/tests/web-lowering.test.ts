/* oxlint-disable samva/no-unsafe-type-assertion -- Boundary tests deliberately submit untrusted compiled artifacts. */
import { createHash } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";

import { compileTemplate } from "../src/compiler";
import type { BrandPlugin } from "../src/email/brand-plugin";
import { render, RenderError, type CompiledTemplate, type RenderedPage } from "../src/render";
import starterFiles from "./fixtures/rendered-email-baseline/starter-project.json";
import { BUILTIN_BASELINES } from "./support/rendered-email-baseline";
import { EMAIL_REGRESSIONS } from "./support/semantic-email-regressions";

const projects = [
  ...BUILTIN_BASELINES,
  {
    name: "starter",
    options: {
      files: starterFiles,
      entry: "templates/welcome.tsx",
      assetBase: "https://assets.example.test/baseline",
      tailwind: { css: starterFiles["theme.css"], cssPath: "theme.css" },
    },
  },
];

// Web body and head-hint goldens; email's independently captured fixture files stay immutable.
const WEB_DIGESTS: Readonly<Record<string, string>> = {
  "primitive-defaults/basic": "e7dc2a642286ee506f1e2ac01440781fec9f3c4b4a9d614eb735783348474ccb",
  "primitive-styles/basic": "87f2813e15d8dbfdb6a5d865e80c6ceb5e1554ddd91ad22b2821faa90bd23925",
  "outlook-buttons/basic": "fd3e84be476fe74019640fcc9f41530bcf0cd0a95e6117268f5f7c2cbe21f4d6",
  "column-options/empty": "15170e24c049d72e666265e7d537507636b8d535b02a38e9a3b2995f8032998f",
  "column-options/one": "0a6b6b9c97e277a3dbd73e90eaa15cfa6f70e87d9b632ef5239910d3e488c1fe",
  "column-options/odd": "055a991c5e5256dd41a1a44f6c6e1610ccf383176d66bc576ff7dc5a52f197e2",
  "column-options/even": "53d4256f06a98d0d52e6c6d50330daa77f5a26a5ebbc7169a251e515cb6bd74f",
  "brand-full/basic": "a62d5b6e6220cf84e50b453d5529de17573ae7a1af2aa9065232c4c5af1677da",
  "brand-light/basic": "162c165255cee0f0c09ed0b817877475c951e7369b76f68ad5ea9c38458eab34",
  "brand-bare/basic": "b368a9fc7129cfac39c135e7f879003bee2054636129fd9bd2c6b7da996746e0",
  "parity/basic": "1971226beefe2fea15b97f6d74f3c25f8c60992e2670456c7e54cbd5abce746f",
  "starter/default": "deec9782168c868da95288b69d1ae5ef81726c0b0b06c5dea281952e229fca3c",
  "starter/team": "237aec5ec2914778c3d8634e90d3cf4ef05ca8d5cfc80b97850dfe57f62e9982",
};
const digest = (page: RenderedPage) =>
  createHash("sha256")
    .update(JSON.stringify({ html: page.html, headHints: page.headHints }))
    .digest("hex");

describe("web target lowerings", () => {
  for (const project of projects)
    it(`pins semantic HTML and CSS for ${project.name}`, async () => {
      const compiled = await compileTemplate(project.options);
      expect(compiled.template).toBeDefined();
      for (const [fixture, input] of Object.entries(compiled.fixtures)) {
        const page = render(compiled.template!, input, { target: "web" });
        expect(digest(page)).toBe(WEB_DIGESTS[`${project.name}/${fixture}`]);
        expect(page.html).toMatch(/^<main\b/);
        expect(page.html).not.toMatch(
          /<\/?(?:html|head|body|style)\b|<!--|<v:|\sstyle=|preheader|mso-/i,
        );
        // The starter authors two tables directly; semantic lowering must preserve those.
        if (project.name === "starter") expect(page.html.match(/<table\b/g)).toHaveLength(2);
        else expect(page.html).not.toMatch(/<\/?(?:table|tbody|tr|td)\b/);
        expect(page.headHints.styles).not.toMatch(/sml-stack|sml-dark-|mso-|<!--[\s\S]*-->/);
        expect(page.positions.length).toBeGreaterThan(0);
        for (const position of page.positions) {
          expect(page.html.slice(position.start, position.end)).toMatch(
            new RegExp(`^<${position.tag}\\b`),
          );
          expect(position.src).toBeDefined();
        }
      }
    });

  it("maps primitives to semantic tags and keeps navigation links", async () => {
    const compiled = await compileTemplate(BUILTIN_BASELINES[0]!.options);
    const page = render(compiled.template!, compiled.fixtures.basic, { target: "web" });
    expect(page.html).toContain(
      '<main class="sml-web-email sml-email"><section class="sml-web-section">',
    );
    expect(page.html).toContain('<div class="sml-web-columns sml-web-columns-stack');
    expect(page.html).toContain(
      '<a href="https://example.test/open?a=1&amp;b=2" class="sml-web-button',
    );
    expect(page.html).not.toContain('role="button"');
    expect(page.html).toContain('<div aria-hidden="true" class="sml-web-spacer');
    expect(page.html).toContain('<hr class="sml-web-divider sml-divider" />');
    expect(page.html).toContain(
      '<img src="https://assets.example.test/photo.png" alt="Photo &amp; details"',
    );
    expect(page.headHints.styles).toContain("display:grid");
    expect(page.headHints.styles).toContain("@media (max-width:599px)");
    expect(page.headHints.styles).toContain("height:16px");
  });

  it("preserves chunked Columns children once, including partials, empty lists and row indices", async () => {
    for (const scenario of EMAIL_REGRESSIONS.filter(
      ({ name }) => name.includes("partial") || name === "direct-per",
    )) {
      const compiled = await compileTemplate(scenario.options);
      const page = render(compiled.template!, compiled.fixtures.basic, { target: "web" });
      expect(page.html.match(/>First</g)).toHaveLength(1);
      expect(page.html.match(/>Second</g)).toHaveLength(1);
      if (scenario.name.endsWith("each") || scenario.name.endsWith("per")) {
        expect(page.html.match(/>Third</g)).toHaveLength(1);
        const empty = render(compiled.template!, { items: [] }, { target: "web" });
        expect(empty.html).not.toContain('sml-web-column"');
      }
      if (scenario.name.endsWith("per"))
        expect(page.headHints.styles).toContain("repeat(2,minmax(0,1fr))");
    }
  });

  it("keeps authored tables and attributes rather than treating them as generated layout", () => {
    const page = render(
      artifact({
        type: "block",
        tag: "table",
        attrs: { role: "table", "aria-label": "Results" },
        children: [
          {
            type: "block",
            tag: "tbody",
            children: [
              {
                type: "block",
                tag: "tr",
                children: [
                  { type: "block", tag: "th", children: ["Total"] },
                  { type: "block", tag: "td", children: [{ bind: "total" }] },
                ],
              },
            ],
          },
        ],
      }),
      { total: "<&>" },
      { target: "web" },
    );
    expect(page.html).toBe(
      '<table role="table" aria-label="Results"><tbody><tr><th>Total</th><td>&lt;&amp;&gt;</td></tr></tbody></table>',
    );
  });

  it("returns shell hints and preserves authored selectors, theme tokens, dark mode and fonts", async () => {
    const project = BUILTIN_BASELINES.find(({ name }) => name === "primitive-styles")!;
    const compiled = await compileTemplate(project.options);
    const page = render(compiled.template!, compiled.fixtures.basic, { target: "web" });
    expect(page.headHints).toMatchObject({ title: "Styled & titled", lang: "ar", dir: "rtl" });
    expect(page.headHints.styles).toContain("--color-primary:#075985");
    expect(page.headHints.styles).toContain("--color-primary:#7dd3fc");
    expect(page.headHints.styles).toContain("@media (prefers-color-scheme:dark)");
    expect(page.headHints.styles).toContain(".bg-card{background-color:var(--color-card)}");
    expect(page.headHints.styles).toContain("@media (width>=40rem)");
    expect(page.headHints.styles).not.toMatch(/border-collapse|border-spacing|table-layout/);
    const parity = BUILTIN_BASELINES.find(({ name }) => name === "parity")!;
    const withFont = await compileTemplate(parity.options);
    const fontPage = render(withFont.template!, withFont.fixtures.basic, { target: "web" });
    expect(fontPage.headHints.styles).toContain("@font-face{");
    expect(fontPage.headHints.styles).toContain("https://assets.samva.test/parity/");
    expect(fontPage.headHints.styles).toContain(".panel");
  });

  it("renders snapshot brand details with dark logo CSS and a custom brand plugin", async () => {
    const plugin: BrandPlugin = {
      specifier: "acme:brand",
      footerAttribute: "data-acme-footer",
      unsubscribeRowAttribute: "data-acme-row",
      noTrackAttribute: "data-acme-no-track",
      unsubscribeUrlPlaceholder: "{{acme&unsubscribe}}",
    };
    const source = `import { defineTemplate } from "@samva/markup"; import { Email } from "@samva/markup/email"; import { BrandLogo, BrandFooter } from "acme:brand"; import { jsonSchema } from "@samva/markup/input-schema";
export default defineTemplate({ id: "brand", schema: jsonSchema({ type: "object" }), fixtures: { basic: {} }, email: { subject: () => "Brand", body: () => <Email><BrandLogo /><BrandFooter unsubscribeLabel="Leave & return" /></Email> } });`;
    const compiled = await compileTemplate({
      files: { "entry.tsx": source },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
      brandPlugin: plugin,
      brand: {
        slug: "brand",
        css: "",
        assets: {
          logoUrl: "https://example.test/light.png",
          logoDarkUrl: "https://example.test/dark.png",
        },
        footer: {
          companyName: "Acme & Co",
          socialLinks: [{ label: "Support", url: "https://example.test/support" }],
          address: {
            street1: "One Road",
            city: "City",
            region: "State",
            postalCode: "123",
            country: "GB",
          },
        },
      },
    });
    expect(compiled.template).toBeDefined();
    // The compiled plugin remains authoritative even when the render caller does not pass it again.
    const page = render(compiled.template!, {}, { target: "web" });
    expect(page.html).toContain('<footer data-acme-footer=""');
    expect(page.html).toContain('<span data-acme-row="">');
    expect(page.html).toContain('href="{{acme&amp;unsubscribe}}" data-acme-no-track');
    expect(page.html).toContain("Leave &amp; return");
    expect(page.html).toContain("<address>One Road<br />City, State, 123<br />GB</address>");
    expect(page.html).toContain("sml-web-image sml-web-logo-light");
    expect(page.html).toContain("sml-web-image sml-web-logo-dark");
    expect(page.headHints.styles).toContain(".sml-web-logo-dark{display:block}");
  });

  it("keeps project selectors that customize primitive classes, including theme CSS compiled by Tailwind", async () => {
    const source = `import { defineTemplate } from "@samva/markup"; import { Email, Button, Divider, Link } from "@samva/markup/email"; import { jsonSchema } from "@samva/markup/input-schema";
export default defineTemplate({ id: "selectors", schema: jsonSchema({ type: "object" }), fixtures: { basic: {} }, email: { subject: () => "Selectors", body: () => <Email><p>Copy</p><Button href="https://example.test" height={44}>Read</Button><Link href="https://example.test">More</Link><Divider /></Email> } });`;
    const css =
      ".sml-email > p { font-weight: 600; } .sml-button { letter-spacing: 2px; } .sml-link:hover { text-decoration: none; } .sml-divider { opacity: .5; }";
    const compiled = await compileTemplate({
      files: { "entry.tsx": source, "theme.css": css },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
      tailwind: { css, cssPath: "theme.css" },
    });
    expect(compiled.template).toBeDefined();
    const page = render(compiled.template!, {}, { target: "web" });
    expect(page.html).toContain("sml-web-email sml-email");
    expect(page.html).toContain("sml-web-button sml-button");
    expect(page.html).toContain("sml-web-link sml-link");
    expect(page.html).toContain("sml-web-divider sml-divider");
    expect(page.headHints.styles).toContain(".sml-email>p{font-weight:600}");
    expect(page.headHints.styles).toContain(".sml-button{letter-spacing:2px}");
    expect(page.headHints.styles).toContain(".sml-link:hover{text-decoration:none}");
    expect(page.headHints.styles).not.toContain(".sml-stack");
  });

  it("moves an authored HTML shell and parsed head styles into hints, retaining safe declaration bindings", async () => {
    const source = `import { defineTemplate } from "@samva/markup"; import { jsonSchema } from "@samva/markup/input-schema";
export default defineTemplate({ id: "shell", schema: jsonSchema({ type: "object", required: ["title", "color"], properties: { title: { type: "string" }, color: { type: "string" } } }), fixtures: { basic: { title: "Authored & title", color: "#123456" } }, email: { subject: () => "Subject", body: (input) => <html xmlns="http://www.w3.org/1999/xhtml" lang="de" dir="auto"><head><meta charset="utf-8" /><title>{input.title}</title><style>{\`p { color: \${input.color}; }\`}</style></head><body bgcolor="#ffffff"><p>{input.title}</p></body></html> } });`;
    const compiled = await compileTemplate({
      files: { "entry.tsx": source },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
    });
    expect(compiled.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    const page = render(compiled.template!, compiled.fixtures.basic, { target: "web" });
    expect(page.headHints).toMatchObject({ title: "Authored & title", lang: "de", dir: "auto" });
    expect(page.headHints.styles).toContain("p{color:#123456}");
    expect(page.html).toContain("<p>Authored &amp; title</p>");
    expect(page.html).not.toMatch(/xmlns|<head|<style| style=/);
    expect(() =>
      render(
        compiled.template!,
        { title: "Title", color: "red;}body{display:none" },
        { target: "web" },
      ),
    ).toThrow(RenderError);
    const conditionalSource = source
      .replace("<style>{", '{input.title !== "Hidden" && <style>{')
      .replace("</style>", "</style>}");
    const conditional = await compileTemplate({
      files: { "entry.tsx": conditionalSource },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
    });
    expect(conditional.template).toBeDefined();
    expect(
      render(conditional.template!, { title: "Shown", color: "#123456" }, { target: "web" })
        .headHints.styles,
    ).toContain("p{color:#123456}");
    expect(
      render(conditional.template!, { title: "Hidden", color: "#123456" }, { target: "web" })
        .headHints.styles,
    ).not.toContain("p{color:#123456}");
    const raw = await compileTemplate({
      files: {
        "entry.tsx": source.replace(/<style>[\s\S]*?<\/style>/, "<style>{input.color}</style>"),
      },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
    });
    expect(raw.template).toBeDefined();
    expect(() =>
      render(raw.template!, { title: "Raw", color: "p{color:red}" }, { target: "web" }),
    ).toThrow(RenderError);
  });

  it("preserves bindings, conditions, normalized loop indices and imported source offsets", async () => {
    const source = `import { defineTemplate } from "@samva/markup"; import { Email, Section, Columns, Column, Button } from "@samva/markup/email"; import { jsonSchema } from "@samva/markup/input-schema"; import { Cell } from "./cell"; import "./project.css";
export default defineTemplate({ id: "dynamic", schema: jsonSchema({ type: "object", required: ["name", "url", "color", "show", "vip", "items"], properties: { name: { type: "string" }, url: { type: "string" }, color: { type: "string" }, show: { type: "boolean" }, vip: { type: "boolean" }, items: { type: "array", items: { type: "string" } } } }), fixtures: { basic: { name: "<&>", url: "https://example.test/?a=1&b=2", color: "#123456", show: true, vip: true, items: ["First", "Second", "Third"] } }, email: { subject: (input) => input.name, body: (input) => <Email title={input.name} lang="fr" dir="ltr"><Section className={input.vip ? "vip" : "standard"} style={{ color: input.color }}>{input.show && <p id="intro">Hello {input.name}</p>}<Columns each={input.items} per={2}>{(item, index) => <Column><span>{index}:{item}</span></Column>}</Columns>{input.items.map((item) => <Cell label={item} />)}<Button href={input.url} width={200} height={44}>{input.name}</Button></Section></Email> } });`;
    const compiled = await compileTemplate({
      files: {
        "entry.tsx": source,
        "cell.tsx": "export const Cell = ({ label }) => <p><span>{label}</span></p>;",
        "project.css":
          "#intro { font-weight: 500; } .vip > p:hover { color: red; } @media (width < 600px) { .standard { color: blue; } }",
      },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
    });
    expect(compiled.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    const template = compiled.template!;
    const original = JSON.stringify(template);
    const page = render(template, compiled.fixtures.basic, { target: "web" });
    expect(page.headHints).toMatchObject({ title: "<&>", lang: "fr", dir: "ltr" });
    expect(page.html).toContain("Hello &lt;&amp;&gt;");
    expect(page.html).toContain("0:First</span>");
    expect(page.html).toContain("1:Second</span>");
    expect(page.html).toContain("0:Third</span>");
    expect(page.headHints.styles).toContain(".vip>p:hover{color:red}");
    expect(page.headHints.styles).toContain("@media (width<600px)");
    expect(page.headHints.styles).toContain("color:#123456");
    expect(page.headHints.styles).toContain(":is(#sml-web-inline#sml-web-inline,.sml-web-style-");
    const spans = page.positions.filter(
      (position) =>
        position.tag === "span" && position.src?.[2] === template.sources!.indexOf("cell.tsx"),
    );
    expect(spans).toHaveLength(3);
    expect(spans[0]!.src).toEqual(spans[1]!.src);
    expect(new Set(spans.map(({ start }) => start)).size).toBe(3);
    expect(spans.map(({ start, end }) => page.html.slice(start, end))).toEqual([
      "<span>First</span>",
      "<span>Second</span>",
      "<span>Third</span>",
    ]);
    expect(render(JSON.parse(original), compiled.fixtures.basic, { target: "web" })).toEqual(page);
    expect(JSON.stringify(template)).toBe(original);
    const hidden = render(
      template,
      { ...(compiled.fixtures.basic as object), show: false, vip: false, items: [] },
      { target: "web" },
    );
    expect(hidden.html).not.toContain("Hello");
    expect(hidden.html).toContain("sml-web-section standard");
  });
});

const artifact = (body: unknown, web?: unknown): CompiledTemplate =>
  ({
    sml: 2,
    template: "unsafe",
    schema: {},
    email: { subject: "Subject", body, ...(web === undefined ? {} : { web }) },
  }) as CompiledTemplate;
const element = (extra: object = {}) => ({
  type: "block",
  tag: "p",
  children: [{ bind: "text" }],
  ...extra,
});

describe("untrusted web render boundary", () => {
  it.each([
    { raw: ["<script>alert(1)</script>"] },
    { type: "block", tag: "script" },
    { type: "block", tag: "style", children: ["body{display:none}"] },
    element({ attrs: { onload: "alert(1)" } }),
    element({ attrs: { style: "color:red" } }),
    { type: "component", name: "Image", props: { src: { bind: "url" }, alt: "Image" } },
    { type: "component", name: "Link", props: { href: { bind: "url" } } },
    element({ style: [["color", { bind: "color" }]] }),
    element({ style: "background:url('javascript:alert(1)')" }),
    element({ style: [["color;display", "red"]] }),
    { type: "component", name: "Email", props: { style: { bind: "color" } } },
    { type: "component", name: "Email", props: { dir: "sideways" } },
  ])("rejects unsafe body IR with RenderError: %j", (body) => {
    expect(() =>
      render(
        artifact(body),
        { text: "<&>", url: "javascript:alert(1)", color: "red;display:none" },
        { target: "web" },
      ),
    ).toThrow(RenderError);
  });

  it.each([
    { selector: "p{}body", style: [["color", "red"]] },
    { selector: "</style><script>bad()</script>", style: [] },
    { at: 'import "https://example.test/x.css"' },
    { selector: "p", style: [["color", "red;display:none"]] },
    { at: "font-face", style: [["src", 'url("javascript:alert(1)")']] },
    { selector: "p", style: [["background", 'u\\72l("javascript:alert(1)")']] },
    { selector: "p", style: [["background", 'url("javascript:bad"']] },
  ])("rejects CSS structure and URL injection with RenderError: %j", (rule) => {
    expect(() => render(artifact(element(), { rules: [rule] }), {}, { target: "web" })).toThrow(
      RenderError,
    );
  });

  it("escapes text and attributes and moves checked dynamic styles into head hints", () => {
    const page = render(
      artifact({
        type: "inline",
        tag: "a",
        attrs: { href: { bind: "url" }, title: { bind: "text" } },
        style: [["color", { bind: "color" }]],
        children: [{ bind: "text" }],
      }),
      { url: 'https://example.test/?x="&y=2', text: '<&"', color: "#123456" },
      { target: "web" },
    );
    expect(page.html).toContain('href="https://example.test/?x=&quot;&amp;y=2"');
    expect(page.html).toContain('title="&lt;&amp;&quot;"');
    expect(page.html).toContain('&lt;&amp;"</a>');
    expect(page.html).not.toContain(" style=");
    expect(page.headHints.styles).toContain("color:#123456");
  });

  it("bounds malformed, cyclic and oversized artifacts and dynamic iterations", () => {
    const cyclic = { type: "block", tag: "p", children: [] as unknown[] };
    cyclic.children.push(cyclic);
    expect(() => render(artifact(cyclic), {}, { target: "web" })).toThrow(RenderError);
    const css = { at: "media screen", children: [] as unknown[] };
    css.children.push(css);
    expect(() => render(artifact(element(), { rules: [css] }), {}, { target: "web" })).toThrow(
      RenderError,
    );
    expect(() =>
      render(
        artifact(element(), { rules: Array(10_001).fill({ selector: "p" }) }),
        {},
        { target: "web" },
      ),
    ).toThrow(RenderError);
    expect(() =>
      render(
        artifact({ each: { bind: "items" }, as: "item", children: [element()] }),
        { items: Array(10_001).fill(1) },
        { target: "web" },
      ),
    ).toThrow(RenderError);
  });

  it("rejects forged plugin attributes and unsafe unsubscribe URLs", () => {
    const body = { type: "component", name: "BrandFooter", brand: { slug: "brand" } };
    for (const plugin of [
      { noTrackAttribute: 'data-x onclick="bad()"' },
      { unsubscribeUrlPlaceholder: "javascript:bad()" },
    ]) {
      const brandPlugin = {
        specifier: "test:brand",
        footerAttribute: "data-test-footer",
        unsubscribeRowAttribute: "data-test-row",
        noTrackAttribute: "data-test-no-track",
        unsubscribeUrlPlaceholder: "{{test.unsubscribe}}",
        ...plugin,
      } as BrandPlugin;
      expect(() => render(artifact(body), {}, { target: "web", brandPlugin })).toThrow(RenderError);
    }
  });

  it("keeps plain-message targets separate and removes the channel option", () => {
    const sms: CompiledTemplate = { sml: 2, template: "sms", schema: {}, sms: { body: ["Text"] } };
    expect(render(sms, {}, { target: "sms" }).text).toBe("Text");
    expect(() => render(sms, {}, { target: "web" })).toThrow(RenderError);
    expect(() => render(artifact(element()), {}, { target: "sms" })).toThrow(RenderError);
    // @ts-expect-error Render options name the lowering target, with no channel compatibility alias.
    expect(() => render(artifact(element()), {}, { channel: "email" })).toThrow(RenderError);
  });
});
