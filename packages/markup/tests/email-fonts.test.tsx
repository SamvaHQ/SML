/** @jsxImportSource @samva/markup/email */
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { assetEntry, assetUrl } from "../src/email/assets";
import { Email, Section } from "../src/email/components";
import { parseStylesheet } from "../src/email/css";
import { EmailCompileError } from "../src/email/diagnostics";
import { fontStackFamilies } from "../src/email/font-stacks";
import { resolveProjectPath, transformProject } from "../src/email/transform";
import { corpusTemplate } from "./fixtures/email-compile";
import { renderEmail } from "./support/email-fixture";
import { registerStylesheet, resetStylesheets } from "./support/stylesheet-registry";

const base = "https://assets.samva.dev/t/abc";
const woff2 = new TextEncoder().encode("wOF2 pretend font bytes");

const face = (src: string, family = "'Brand Sans'") =>
  `@font-face{font-family:${family};src:${src};font-weight:400}`;

const codes = (css: string, resolve?: (reference: string) => string | undefined) =>
  parseStylesheet(css, { origin: "theme.css", resolveFontFile: resolve }).diagnostics.map(
    (entry) => entry.code,
  );

describe("@font-face sources", () => {
  it("rewrites a project .woff2 path to the URL its file is served from", () => {
    const sheet = parseStylesheet(face('url("./fonts/brand.woff2") format("woff2")'), {
      origin: "theme.css",
      resolveFontFile: (reference) =>
        reference === "./fonts/brand.woff2" ? `${base}/abc.woff2` : undefined,
    });
    expect(sheet.diagnostics).toEqual([]);
    expect(sheet.headAtRules).toEqual([]);
    expect(sheet.fontFaces).toHaveLength(1);
    expect(sheet.fontFaces[0]?.family).toBe("Brand Sans");
    expect(sheet.fontFaces[0]?.css).toContain(`src:url(${base}/abc.woff2) format("woff2")`);
    expect(sheet.fontFaces[0]?.css).not.toContain("./fonts/brand.woff2");
  });

  it("keeps an https WOFF2 source as an external reference", () => {
    const sheet = parseStylesheet(face("url(https://fonts.example.com/brand.woff2)"));
    expect(sheet.diagnostics).toEqual([]);
    expect(sheet.fontFaces[0]?.css).toContain("https://fonts.example.com/brand.woff2");
  });

  it("refuses sources that would ship broken or are not WOFF2", () => {
    expect(codes(face("url(./fonts/missing.woff2)"), () => undefined)).toEqual([
      "email-font-missing",
    ]);
    expect(codes(face("url(./fonts/brand.ttf)"), () => "x")).toEqual(["email-font-format"]);
    expect(codes(face('url(./fonts/brand.woff2) format("truetype")'), () => "x")).toEqual([
      "email-font-format",
    ]);
    expect(codes(face("url(https://fonts.example.com/brand.woff)"))).toEqual(["email-font-format"]);
    expect(codes(face("url(http://fonts.example.com/brand.woff2)"))).toEqual(["email-font-src"]);
    expect(codes(face("url(data:font/woff2;base64,AAAA)"))).toEqual(["email-font-src"]);
    expect(codes("@font-face{src:url(https://fonts.example.com/a.woff2)}")).toEqual([
      "email-font-family",
    ]);
    expect(codes("@font-face{font-family:X;src:local(Arial)}")).toEqual(["email-font-src"]);
    // A refused face is not emitted at all.
    expect(
      parseStylesheet(face("url(./missing.woff2)"), { resolveFontFile: () => undefined }).fontFaces,
    ).toEqual([]);
  });

  it("resolves a CSS-escaped path and keeps url() and format() apart", () => {
    const sheet = parseStylesheet(face('url("./fonts/Brand\\ Font.woff2") format("woff2")'), {
      resolveFontFile: (reference) =>
        reference === "./fonts/Brand Font.woff2" ? `${base}/abc.woff2` : undefined,
    });
    expect(sheet.diagnostics).toEqual([]);
    expect(sheet.fontFaces[0]?.css).toContain(`url(${base}/abc.woff2) format("woff2")`);
  });

  it("reads a stack's families in order, quoted or not", () => {
    expect(fontStackFamilies(`"Brand, Sans", 'Other' , Helvetica Neue,sans-serif`)).toEqual([
      "Brand, Sans",
      "Other",
      "Helvetica Neue",
      "sans-serif",
    ]);
  });
});

describe("project paths", () => {
  it("resolves from the stylesheet's directory and never leaves the project", () => {
    expect(resolveProjectPath("theme.css", "./fonts/a.woff2")).toBe("fonts/a.woff2");
    expect(resolveProjectPath("emails/styles.css", "../fonts/a.woff2")).toBe("fonts/a.woff2");
    expect(resolveProjectPath("emails/styles.css", "/fonts/a.woff2")).toBe("fonts/a.woff2");
    expect(resolveProjectPath("emails/styles.css", "a.woff2?v=2#x")).toBe("emails/a.woff2");
    expect(resolveProjectPath("theme.css", "../a.woff2")).toBeUndefined();
  });
});

describe("project fonts in the rendered email", () => {
  const message = (className: string) =>
    corpusTemplate<Record<string, never>>({ type: "object" }, () => ({
      subject: "Fonts",
      body: (
        <Email title="Fonts">
          <Section>
            <p className={className}>Hello</p>
          </Section>
        </Email>
      ),
    }));

  beforeEach(() => resetStylesheets());
  afterEach(() => resetStylesheets());

  it("hides the faces from classic Outlook and inlines the stack", () => {
    registerStylesheet(
      parseStylesheet(
        `${face("url(https://fonts.example.com/brand.woff2)")}.brand{font-family:'Brand Sans', Helvetica, sans-serif}@media (width>=40rem){.brand{padding:4px}}`,
        { origin: "theme.css" },
      ),
    );
    const html = renderEmail(message("brand"), {}).html;
    expect(html).toContain(`font-family:&#39;Brand Sans&#39;, Helvetica, sans-serif`);
    const hidden =
      /<!--\[if !mso\]><!--><style>(@font-face\{[^<]*\})<\/style><!--<!\[endif\]-->/.exec(html);
    expect(hidden?.[1]).toContain("font-family:'Brand Sans'");
    // The shared head style stays visible to Outlook and carries no face.
    expect(html).toContain("<style>@media (min-width:40rem)");
    expect(html.indexOf("[if !mso]")).toBeLessThan(html.indexOf("<body"));
  });

  it("checks the font shorthand and a quoted generic like any stack", () => {
    const declared = face("url(https://fonts.example.com/brand.woff2)");
    const refuses = (css: string) => {
      resetStylesheets();
      registerStylesheet(parseStylesheet(`${declared}${css}`, { origin: "theme.css" }));
      let refused: unknown;
      try {
        renderEmail(message("brand"), {});
      } catch (error) {
        refused = error;
      }
      return refused instanceof EmailCompileError
        ? refused.diagnostics.map((finding) => finding.code)
        : [];
    };
    expect(refuses(`.brand{font-family:'Brand Sans', "sans-serif"}`)).toEqual([
      "email-font-fallback",
    ]);
    expect(refuses(`.brand{font:italic 16px/24px 'Brand Sans'}`)).toEqual(["email-font-fallback"]);
    expect(refuses(`.brand{font:italic 16px/24px 'Brand Sans', sans-serif}`)).toEqual([]);
    expect(refuses(`.brand{font:italic clamp(14px, 2vw, 18px) 'Brand Sans'}`)).toEqual([
      "email-font-fallback",
    ]);
    expect(refuses(`.brand{font:700 16px / 1.5 'Brand Sans', serif}`)).toEqual([]);
    for (const lineHeight of ["16px/1.5", "16px/ 1.5", "16px /1.5", "16px / 1.5"])
      expect(refuses(`.brand{font:${lineHeight} 'Brand Sans', Arial}`)).toEqual([
        "email-font-fallback",
      ]);
    // Retained rules ship in the head whatever they match, so each is checked,
    // against the root variables the head CSS is written with.
    expect(refuses(`.brand:hover{font-family:'Brand Sans'}`)).toEqual(["email-font-fallback"]);
    expect(
      refuses(
        `:root{--stack:'Brand Sans', sans-serif}.brand{--stack:'Brand Sans'}@media (width>=40rem){.x{font-family:var(--stack)}}`,
      ),
    ).toEqual([]);
  });

  it("emits no font style when the project declares no face", () => {
    registerStylesheet(parseStylesheet(".brand{font-family:Georgia}", { origin: "theme.css" }));
    const html = renderEmail(message("brand"), {}).html;
    expect(html).not.toContain("[if !mso]><!-->");
  });

  it("refuses a stack that names a project font without a generic fallback", () => {
    registerStylesheet(
      parseStylesheet(
        `${face("url(https://fonts.example.com/brand.woff2)")}.brand{font-family:"brand sans", Helvetica}.plain{font-family:Georgia}`,
        { origin: "theme.css" },
      ),
    );
    let refused: unknown;
    try {
      renderEmail(message("brand"), {});
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(EmailCompileError);
    const [finding] = (refused as EmailCompileError).diagnostics;
    expect(finding?.code).toBe("email-font-fallback");
    expect(finding?.origins.length).toBe(1);
    // A system stack without a generic is the compatibility check's concern, not this one.
    expect(() => renderEmail(message("plain"), {})).not.toThrow();
  });
});

describe("project transform", () => {
  it("resolves theme and module stylesheets against the project's font files", async () => {
    const entry = await assetEntry("fonts/brand.woff2", woff2);
    const theme = `${face('url("./fonts/brand.woff2") format("woff2")')}@theme{--font-brand:'Brand Sans', Helvetica, sans-serif;}`;
    const output = await transformProject(
      {
        "theme.css": theme,
        "fonts/brand.woff2": woff2,
        "emails/styles.css": face("url(../fonts/brand.woff2)", "Brand Serif"),
        "emails/welcome.tsx":
          '/** @jsxImportSource @samva/markup/email */\nimport "./styles.css";\nexport const view = () => <p className="font-brand">hi</p>;',
      },
      { assetBase: base, tailwind: { css: theme } },
    );
    expect(output.diagnostics).toEqual([]);
    expect(output.assets.map((asset) => asset.path)).toEqual(["fonts/brand.woff2"]);
    expect(JSON.stringify(output.stylesheets.get("emails/styles.css"))).toContain(
      assetUrl(entry, base),
    );
    expect(JSON.stringify(output.tailwindSheet)).toContain(assetUrl(entry, base));
    expect(JSON.stringify(output.tailwindSheet)).toContain('"family":"Brand Sans"');
  });

  it("reports a missing project font once, under the file that names it", async () => {
    const theme = face("url(./fonts/gone.woff2)");
    const output = await transformProject(
      {
        "theme.css": theme,
        "emails/welcome.tsx":
          '/** @jsxImportSource @samva/markup/email */\nexport const view = () => <p className="p-4">hi</p>;',
      },
      { assetBase: base, tailwind: { css: theme } },
    );
    expect(output.diagnostics.map((entry) => [entry.code, entry.message.split(":")[0]])).toEqual([
      ["email-font-missing", "theme.css"],
    ]);
  });
});
