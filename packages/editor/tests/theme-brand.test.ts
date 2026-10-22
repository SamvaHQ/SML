import { describe, expect, it } from "@effect/vitest";

import {
  brandChipView,
  themeBrandImport,
  withBrandImport,
  withBrandModuleSpecifiers,
  withDefaultBrandImport,
  type EditorBrand,
} from "../src/chrome/theme-brand";

const acme: EditorBrand = { slug: "acme", name: "Acme", isDefault: true };
const holiday: EditorBrand = { slug: "holiday", name: "Holiday", isDefault: false };

describe("themeBrandImport", () => {
  it.each([
    ['@import "samva:brand";', null],
    ["@import 'samva:brand';", null],
    ["@import url(samva:brand);", null],
    ['@import url("samva:brand/holiday");', "holiday"],
    ["@IMPORT 'samva:brand/holiday';", "holiday"],
    ['@import "./starter.css";\n@import "samva:brand/acme-2";\n@theme { --x: 1; }', "acme-2"],
    ['@import /* layered */ "samva:brand";', null],
    // The host's brand list judges a slug, so a malformed one still names a brand to look up.
    ['@import "samva:brand/Not_A_Slug";', "Not_A_Slug"],
  ])("reads %j", (css, slug) => {
    expect(themeBrandImport(css)).toEqual({ slug });
  });

  it.each([
    ["", "an empty theme"],
    ['@import "./starter.css";\n@theme { --color-brand: #000; }', "a theme with no brand import"],
    ['/* @import "samva:brand"; */\n@theme {}', "a commented-out import"],
    ['@theme { --font: "@import \\"samva:brand\\";"; }', "an import inside a string"],
    ['@media print { @import "samva:brand"; }', "an import nested in a block"],
    ['@import "samva:brand" layer(base);', "an import with a layer condition"],
    ['@import "samva:branding";', "a lookalike specifier"],
    ['@import "samva:brand/";', "an empty slug"],
  ])("finds no brand in %j (%s)", (css) => {
    expect(themeBrandImport(css)).toBeNull();
  });
});

describe("withDefaultBrandImport", () => {
  const overrides = "@theme {\n  --color-brand: #4f46e5;\n}\n";

  it("puts the starter and the brand above the existing overrides", () => {
    const patched = withDefaultBrandImport({ theme: overrides, starter: true });
    expect(patched).toBe(`@import "./starter.css";\n@import "samva:brand";\n\n${overrides}`);
    expect(themeBrandImport(patched)).toEqual({ slug: null });
  });

  it("adds only the brand when the project has no starter stylesheet", () => {
    expect(withDefaultBrandImport({ theme: overrides, starter: false })).toBe(
      `@import "samva:brand";\n\n${overrides}`,
    );
  });

  it("places the brand right after a starter import the theme already has", () => {
    const theme = `/* tokens */\n@import './starter.css';\n${overrides}`;
    expect(withDefaultBrandImport({ theme, starter: true })).toBe(
      `/* tokens */\n@import './starter.css';\n@import "samva:brand";\n${overrides}`,
    );
  });

  it("creates the theme when the project has none", () => {
    expect(withDefaultBrandImport({ theme: null, starter: true })).toBe(
      '@import "./starter.css";\n@import "samva:brand";\n',
    );
    expect(withDefaultBrandImport({ theme: null, starter: false })).toBe(
      '@import "samva:brand";\n',
    );
  });

  it("is idempotent and leaves a named brand alone", () => {
    const once = withDefaultBrandImport({ theme: overrides, starter: true });
    expect(withDefaultBrandImport({ theme: once, starter: true })).toBe(once);
    const named = `@import "samva:brand/holiday";\n${overrides}`;
    expect(withDefaultBrandImport({ theme: named, starter: true })).toBe(named);
  });
});

describe("withBrandImport", () => {
  const overrides = "@theme {\n  --color-brand: #4f46e5;\n}\n";

  it("replaces the brand the theme imports and leaves the rest alone", () => {
    const css = `@import "./starter.css";\n@import 'samva:brand/holiday';\n${overrides}`;
    expect(withBrandImport({ theme: css, starter: true }, acme)).toBe(
      `@import "./starter.css";\n@import "samva:brand";\n${overrides}`,
    );
    expect(
      withBrandImport({ theme: `@import "samva:brand";\n${overrides}`, starter: false }, holiday),
    ).toBe(`@import "samva:brand/holiday";\n${overrides}`);
  });

  it("layers a brand into a theme that has none, naming a non-default brand by slug", () => {
    expect(withBrandImport({ theme: overrides, starter: true }, holiday)).toBe(
      `@import "./starter.css";\n@import "samva:brand/holiday";\n\n${overrides}`,
    );
    expect(withBrandImport({ theme: null, starter: false }, acme)).toBe('@import "samva:brand";\n');
  });
});

describe("withBrandImport and module imports", () => {
  it("keeps one brand import when the theme repeats it", () => {
    const css = `@import "samva:brand/gone";\n@import "./extra.css";\n@import 'samva:brand/gone';\n`;
    expect(withBrandImport({ theme: css, starter: false }, holiday)).toBe(
      `@import "samva:brand/holiday";\n@import "./extra.css";\n\n`,
    );
  });

  it("points every brand module import at the brand", () => {
    const source = `import { A } from "samva:brand/gone";\nconst B = await import('samva:brand');\nimport x from "other";\n`;
    expect(withBrandModuleSpecifiers(source, holiday)).toBe(
      `import { A } from "samva:brand/holiday";\nconst B = await import('samva:brand/holiday');\nimport x from "other";\n`,
    );
    expect(withBrandModuleSpecifiers(source, acme)).toContain(`from "samva:brand";`);
  });
});

describe("brandChipView", () => {
  it("waits for the theme, and for brands when the theme names one", () => {
    expect(brandChipView(undefined, [acme])).toEqual({ kind: "pending" });
    expect(brandChipView({ slug: "acme" }, null)).toEqual({ kind: "pending" });
  });

  it("resolves bare samva:brand to the default brand and a slug to its brand", () => {
    expect(brandChipView({ slug: null }, [holiday, acme])).toEqual({
      kind: "brand",
      brand: acme,
      brands: [holiday, acme],
    });
    expect(brandChipView({ slug: "holiday" }, [acme, holiday])).toEqual({
      kind: "brand",
      brand: holiday,
      brands: [acme, holiday],
    });
  });

  it("reports a brand the organization does not have, with the brands to switch to", () => {
    expect(brandChipView({ slug: "gone" }, [acme])).toEqual({
      kind: "missing",
      slug: "gone",
      brands: [acme],
    });
    expect(brandChipView({ slug: "Not_A_Slug" }, [acme])).toMatchObject({
      kind: "missing",
      slug: "Not_A_Slug",
    });
    expect(brandChipView({ slug: null }, [holiday])).toMatchObject({ kind: "missing", slug: null });
  });

  it("offers the default brand only once brands are loaded", () => {
    expect(brandChipView(null, null)).toEqual({ kind: "none", defaultBrand: null, brands: [] });
    expect(brandChipView(null, [holiday, acme])).toEqual({
      kind: "none",
      defaultBrand: acme,
      brands: [holiday, acme],
    });
  });
});
