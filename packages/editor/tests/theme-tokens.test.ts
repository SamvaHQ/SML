import { describe, expect, it } from "@effect/vitest";

import { NIMBUS_THEME_CSS, NIMBUS_THEME_FILE } from "../dev/nimbus-template";
import {
  colorLabel,
  fontFamilyName,
  fontRoleLabel,
  matchColor,
  parseRgba,
  sourceLabel,
} from "../src/chrome/theme-tokens";
import { themeTokensFromStylesheets } from "../src/host/types";

const STARTER = `/* The starter's look. */
@theme {
  --color-background: #e8edef;
  --color-foreground: #14232a;
  --color-card: #ffffff;
  --color-card-foreground: #14232a;
  --color-primary: #0d5a61;
  --color-muted-foreground: #52646b;
  --font-sans: -apple-system, "Segoe UI", Arial, sans-serif;
  --font-heading: "Iowan Old Style", Georgia, serif;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: #0b1215;
    --color-foreground: #e3ebed;
    --color-primary: #7fd1c5;
  }
}
`;

const BRAND = `@font-face { font-family: "Barlow Semi Condensed"; src: url("https://cdn.example/b.woff2") format("woff2"); }
@theme {
  --color-foreground: #17181c;
  --color-accent: #ff7347;
  --font-heading: "Barlow Semi Condensed", ui-sans-serif, sans-serif;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-accent: #ff9a78;
  }
}
`;

const THEME = `@import "./starter.css";
@import "samva:brand";
@theme {
  --color-icon-tile: #e8673f;
  --color-ring: var(--color-primary);
  --color-card: var(--color-missing, #fafafa);
}
`;

/** The colors a project's own stylesheets and brand set, without the default theme beneath them. */
const ownColors = <Color extends { readonly source: { readonly kind: string } }>(
  colors: ReadonlyArray<Color>,
): ReadonlyArray<Color> => colors.filter((color) => color.source.kind !== "default");

const resolve = (brand = true) =>
  themeTokensFromStylesheets({
    themePath: "theme.css",
    files: { "theme.css": THEME, "starter.css": STARTER },
    ...(brand ? { brand: { name: "Pruuvo", css: BRAND } } : {}),
  });

describe("theme resolution", () => {
  it("walks the starter, the brand and the project's own theme, later layers winning", () => {
    const { colors } = resolve();
    const color = (name: string) => colors.find((entry) => entry.name === name);
    expect(ownColors(colors).map((entry) => entry.name)).toEqual([
      "background",
      "foreground",
      "card",
      "card-foreground",
      "primary",
      "muted-foreground",
      "accent",
      "icon-tile",
      "ring",
    ]);
    expect(color("background")).toEqual({
      name: "background",
      value: "#e8edef",
      dark: "#0b1215",
      source: { kind: "stylesheet", path: "starter.css" },
    });
    // The brand sets foreground in light mode without a dark value, so the starter's dark value
    // no longer applies: a layer owns the colors it sets in both modes.
    expect(color("foreground")).toEqual({
      name: "foreground",
      value: "#17181c",
      source: { kind: "brand", name: "Pruuvo" },
    });
    expect(color("accent")).toMatchObject({ value: "#ff7347", dark: "#ff9a78" });
    expect(color("icon-tile")).toEqual({
      name: "icon-tile",
      value: "#e8673f",
      source: { kind: "project" },
    });
  });

  it("resolves var() references between tokens, in both modes, and their fallbacks", () => {
    const { colors } = resolve();
    expect(colors.find((entry) => entry.name === "ring")).toMatchObject({
      value: "#0d5a61",
      dark: "#7fd1c5",
      source: { kind: "project" },
    });
    expect(colors.find((entry) => entry.name === "card")?.value).toBe("#fafafa");
  });

  it("reads font roles, the brand's face replacing the starter's", () => {
    expect(resolve().fonts).toEqual([
      {
        name: "sans",
        family: '-apple-system, "Segoe UI", Arial, sans-serif',
        source: { kind: "stylesheet", path: "starter.css" },
      },
      {
        name: "heading",
        family: '"Barlow Semi Condensed", ui-sans-serif, sans-serif',
        source: { kind: "brand", name: "Pruuvo" },
      },
    ]);
  });

  it("skips the brand it cannot see and still resolves the project's files", () => {
    const { colors, fonts } = resolve(false);
    expect(colors.find((entry) => entry.name === "foreground")).toMatchObject({
      value: "#14232a",
      dark: "#e3ebed",
    });
    expect(colors.find((entry) => entry.name === "accent")?.source).toEqual({ kind: "default" });
    expect(fonts.find((font) => font.name === "heading")?.family).toBe(
      '"Iowan Old Style", Georgia, serif',
    );
  });

  it("reads a single-file theme", () => {
    const { colors } = themeTokensFromStylesheets({
      themePath: NIMBUS_THEME_FILE,
      files: { [NIMBUS_THEME_FILE]: NIMBUS_THEME_CSS },
    });
    expect(colors.slice(0, 3).map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "background", value: "#f4ede3" },
      { name: "foreground", value: "#2b1d14" },
      { name: "card", value: "#ffffff" },
    ]);
  });

  it("resolves imports from the importing file, and survives a cycle", () => {
    const { colors } = themeTokensFromStylesheets({
      themePath: "theme.css",
      files: {
        "theme.css": '@import "./styles/base.css";',
        "styles/base.css":
          '@import "../theme.css"; @import "./tokens.css"; @theme { --color-a: #000; }',
        "styles/tokens.css": "@theme { --color-b: #fff; }",
      },
    });
    expect(ownColors(colors).map(({ name, source }) => [name, source])).toEqual([
      ["b", { kind: "stylesheet", path: "styles/tokens.css" }],
      ["a", { kind: "stylesheet", path: "styles/base.css" }],
    ]);
  });

  it("starts from the compiler's default theme, which a project's theme reads and replaces", () => {
    const bare = themeTokensFromStylesheets({ themePath: "theme.css", files: {} });
    expect(bare.colors.find((entry) => entry.name === "background")).toEqual({
      name: "background",
      value: "#ffffff",
      dark: "#0a0a0a",
      source: { kind: "default" },
    });
    expect(bare.fonts.map(({ name, source }) => [name, source])).toEqual([
      ["sans", { kind: "default" }],
      ["heading", { kind: "default" }],
    ]);
    expect(bare.fonts[1]?.family).toBe(bare.fonts[0]?.family);

    const partial = themeTokensFromStylesheets({
      themePath: "theme.css",
      files: {
        "theme.css": "@theme { --color-ring: var(--color-primary); --color-border: initial; }",
      },
    });
    expect(partial.colors.find((entry) => entry.name === "ring")).toEqual({
      name: "ring",
      value: "#171717",
      dark: "#fafafa",
      source: { kind: "project" },
    });
    expect(partial.colors.some((entry) => entry.name === "border")).toBe(false);
  });

  it("reads the brand through the specifier the project imports it by", () => {
    const brand = { name: "Studio", css: "@theme { --color-accent: #e11d48; }" };
    const accent = (theme: string, brandSpecifier?: string) =>
      themeTokensFromStylesheets({
        themePath: "theme.css",
        files: { "theme.css": theme },
        brand,
        ...(brandSpecifier === undefined ? {} : { brandSpecifier }),
      }).colors.find((entry) => entry.name === "accent")?.value;
    expect(accent('@import "studio:brand/acme";', "studio:brand")).toBe("#e11d48");
    expect(accent('@import "studio:brand";', "studio:brand")).toBe("#e11d48");
    expect(accent('@import "samva:brand";', "studio:brand")).toBe("#f5f5f5");
    expect(accent('@import "samva:brand";')).toBe("#e11d48");
  });
});

describe("color matching", () => {
  it("reads percentage channels out of 255 and a percentage alpha out of 1", () => {
    expect(parseRgba("rgb(100% 0% 0%)")).toEqual([255, 0, 0, 1]);
    expect(parseRgba("rgb(255 0 0 / 50%)")).toEqual([255, 0, 0, 0.5]);
    const red = { name: "red", value: "#ff0000", source: { kind: "project" as const } };
    expect(matchColor([red], "rgb(100% 0% 0%)")).toBe(red);
  });
});

describe("theme naming", () => {
  it("names colors the way a person reads them, a host label winning", () => {
    expect(colorLabel({ name: "card-foreground" })).toBe("Card text");
    expect(colorLabel({ name: "muted-foreground" })).toBe("Muted text");
    expect(colorLabel({ name: "icon-tile" })).toBe("Icon tile");
    expect(colorLabel({ name: "foreground" })).toBe("Text");
    expect(colorLabel({ name: "foreground", label: "Ink" })).toBe("Ink");
  });

  it("names font roles and families", () => {
    expect(fontRoleLabel("heading")).toBe("Heading font");
    expect(fontRoleLabel("sans")).toBe("Body font");
    expect(fontRoleLabel("mono")).toBe("Mono font");
    expect(fontFamilyName('"Barlow Semi Condensed", ui-sans-serif')).toBe("Barlow Semi Condensed");
  });

  it("heads each group by where its colors come from", () => {
    expect(sourceLabel({ kind: "brand", name: "Pruuvo" })).toBe("Pruuvo brand");
    expect(sourceLabel({ kind: "project" })).toBe("This email");
    expect(sourceLabel({ kind: "stylesheet", path: "starter.css" })).toBe("Theme");
    expect(sourceLabel({ kind: "default" })).toBe("Default theme");
  });
});
