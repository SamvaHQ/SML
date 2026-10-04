import { describe, expect, it } from "@effect/vitest";

import {
  brandChipView,
  themeBrandImport,
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

describe("brandChipView", () => {
  it("waits for the theme, and for brands when the theme names one", () => {
    expect(brandChipView(undefined, [acme])).toEqual({ kind: "pending" });
    expect(brandChipView({ slug: "acme" }, null)).toEqual({ kind: "pending" });
  });

  it("resolves bare samva:brand to the default brand and a slug to its brand", () => {
    expect(brandChipView({ slug: null }, [holiday, acme])).toEqual({ kind: "brand", brand: acme });
    expect(brandChipView({ slug: "holiday" }, [acme, holiday])).toEqual({
      kind: "brand",
      brand: holiday,
    });
  });

  it("reports a brand the organization does not have", () => {
    expect(brandChipView({ slug: "gone" }, [acme])).toEqual({ kind: "missing", slug: "gone" });
    expect(brandChipView({ slug: "Not_A_Slug" }, [acme])).toEqual({
      kind: "missing",
      slug: "Not_A_Slug",
    });
    expect(brandChipView({ slug: null }, [holiday])).toEqual({ kind: "missing", slug: null });
  });

  it("offers the default brand only once brands are loaded", () => {
    expect(brandChipView(null, null)).toEqual({ kind: "none", defaultBrand: null });
    expect(brandChipView(null, [holiday, acme])).toEqual({ kind: "none", defaultBrand: acme });
  });
});
