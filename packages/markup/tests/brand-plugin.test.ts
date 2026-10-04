import { describe, expect, it } from "@effect/vitest";

import { renderedFooterMarkers, withoutUnsubscribeRow, type EmailBrand } from "../src/email/brand";
import { renderBrandFooter } from "../src/email/brand-footer";
import { parseBrandSpecifier, samvaBrandPlugin, type BrandPlugin } from "../src/email/brand-plugin";
import { renderIr } from "../src/render-ir";
import { compileTemplate } from "../src/sml/compile";

const ACME: BrandPlugin = {
  specifier: "acme:brand",
  footerAttribute: "data-acme-footer",
  unsubscribeRowAttribute: "data-acme-unsubscribe",
  unsubscribeUrlPlaceholder: "{{acme.unsubscribe}}",
  noTrackAttribute: "data-acme-no-track",
};

const BRAND: EmailBrand = { slug: "acme", css: "", footer: { companyName: "Acme Inc." } };

const entry = (specifier: string, body = "<Email><p>Hi</p><BrandFooter /></Email>") => `
import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { BrandFooter } from "${specifier}";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "welcome",
  schema: jsonSchema<{}>({ type: "object", properties: {}, additionalProperties: false }),
  fixtures: { default: {} },
  email: {
    subject: () => "Welcome",
    body: () => (${body}),
  },
});
`;

const compile = (files: Record<string, string>, brandPlugin?: BrandPlugin) =>
  compileTemplate({
    files,
    entry: "entry.tsx",
    assetBase: "https://assets.example",
    tailwind: { css: files["theme.css"] ?? "", cssPath: "theme.css" },
    brand: BRAND,
    brandPlugin,
  });

const errors = (compiled: Awaited<ReturnType<typeof compile>>) =>
  compiled.diagnostics.filter((item) => item.severity === "error").map((item) => item.code);

describe("a brand plugin", () => {
  it("resolves its own brand import and marks the footer as it names", async () => {
    const compiled = await compile(
      { "entry.tsx": entry("acme:brand/acme"), "theme.css": '@import "acme:brand/acme";' },
      ACME,
    );
    expect(errors(compiled)).toEqual([]);
    const { html } = renderIr(compiled.ir!, {}, { brandPlugin: ACME });
    expect(html).toContain('data-acme-footer=""');
    expect(html).toContain('<tr data-acme-unsubscribe="">');
    expect(html).toContain('href="{{acme.unsubscribe}}" data-acme-no-track');
    expect(html).not.toContain("samva");
    expect(renderedFooterMarkers(html, ACME)).toEqual({ footer: true, unsubscribeLink: true });
    const stripped = withoutUnsubscribeRow({ html }, ACME);
    expect(stripped.html).not.toContain("{{acme.unsubscribe}}");
    expect(stripped.html).toContain("Acme Inc.");
  });

  it("leaves another plugin's brand import unresolved", async () => {
    const compiled = await compile({ "entry.tsx": entry("acme:brand") });
    expect(errors(compiled)).toContain("non-project-import");
    expect(errors(await compile({ "entry.tsx": entry("samva:brand") }, ACME))).toContain(
      "non-project-import",
    );
  });

  it("reserves its own markers and placeholder for BrandFooter", async () => {
    const authored = await compile(
      {
        "entry.tsx": entry(
          "acme:brand",
          '<Email><p data-acme-footer="">x</p><a href="{{acme.unsubscribe}}">Out</a><p data-samva-footer="">y</p></Email>',
        ),
      },
      ACME,
    );
    expect(errors(authored)).toEqual(["reserved-attribute", "reserved-url"]);
  });

  it("recognizes a footer whose placeholder the serializer escapes", async () => {
    const plugin: BrandPlugin = { ...ACME, unsubscribeUrlPlaceholder: "{{acme&unsubscribe}}" };
    const footer = await renderBrandFooter(BRAND, { unsubscribe: true, brandPlugin: plugin });
    expect(footer.html).toContain('href="{{acme&amp;unsubscribe}}"');
    expect(renderedFooterMarkers(footer.html, plugin)).toEqual({
      footer: true,
      unsubscribeLink: true,
    });
  });

  it("renders the fallback footer for the send path", async () => {
    const footer = await renderBrandFooter(BRAND, { unsubscribe: true, brandPlugin: ACME });
    expect(footer.html).toContain('href="{{acme.unsubscribe}}" data-acme-no-track');
    expect(footer.text).toContain("{{acme.unsubscribe}}");
  });

  it("parses a brand specifier, bare or with a slug", () => {
    expect(parseBrandSpecifier("samva:brand")).toEqual({ slug: undefined });
    expect(parseBrandSpecifier("samva:brand/acme")).toEqual({ slug: "acme" });
    expect(parseBrandSpecifier("acme:brand/news", ACME)).toEqual({ slug: "news" });
    expect(parseBrandSpecifier("acme:brand", samvaBrandPlugin)).toBeUndefined();
    expect(parseBrandSpecifier("samva:brand/Bad_Slug")).toBeUndefined();
  });
});
