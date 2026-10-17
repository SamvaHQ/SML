import { describe, expect, it } from "@effect/vitest";

import { lowerThemeCss } from "../src/email/tailwind";
import {
  contrastForeground,
  DEFAULT_THEME,
  DEFAULT_THEME_CSS,
  foregroundDefaults,
  parseBrandCss,
  printBrandCss,
  THEME_COLORS,
  type BrandCss,
} from "../src/theme-css";

const parsed = (css: string): BrandCss => {
  const result = parseBrandCss(css);
  if (result.isErr()) expect.fail(result.error.map((finding) => finding.message).join("\n"));
  return result.isOk() ? result.value : { variables: {}, dark: {}, fontFaces: [] };
};

const codes = (css: string): readonly string[] => {
  const result = parseBrandCss(css);
  expect(result.isErr(), "expected diagnostics").toBe(true);
  return result.isErr() ? result.error.map((finding) => finding.code) : [];
};

const BRAND = `@font-face {
  font-family: "Acme Sans";
  src: url("https://cdn.acme.test/acme-sans.woff2") format("woff2");
  font-weight: 400 700;
  font-display: swap;
}
@theme {
  --color-primary: #e11d48;
  --font-sans: "Acme Sans", Helvetica, sans-serif;
  --radius: 8px;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-primary: #fb7185;
  }
}`;

describe("brand theme CSS", () => {
  it("reads theme variables, dark-mode colors and https WOFF2 fonts", () => {
    expect(parsed(BRAND)).toEqual({
      variables: {
        "--color-primary": "#e11d48",
        "--font-sans": '"Acme Sans", Helvetica, sans-serif',
        "--radius": "8px",
      },
      dark: { "--color-primary": "#fb7185" },
      fontFaces: [
        {
          family: "Acme Sans",
          src: 'url("https://cdn.acme.test/acme-sans.woff2") format("woff2")',
          weight: "400 700",
          display: "swap",
        },
      ],
    });
  });

  it("prints a canonical form that parses back to the same brand", () => {
    const brand = parsed(BRAND);
    const printed = printBrandCss(brand);
    expect(parsed(printed)).toEqual(brand);
    expect(printBrandCss(parsed(printed))).toBe(printed);
    expect(printBrandCss({ variables: {}, dark: {}, fontFaces: [] })).toBe("");
  });

  it("lowers a dark-mode block to a :root rule in the dark query, nothing to -dark names", () => {
    const lowered = lowerThemeCss(BRAND);
    expect(lowered).toContain("@theme static {");
    expect(lowered).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root\s*\{\s*--color-primary: #fb7185;/,
    );
    expect(lowered).not.toContain("-dark");
    expect(lowered).not.toMatch(/@theme[^{]*\{\s*--color-primary: #fb7185/);
  });

  it("accepts the radius token", () => {
    expect(parsed("@theme { --radius: 12px; }").variables["--radius"]).toBe("12px");
  });

  it("compiles a default theme that sets every semantic color in both modes", () => {
    expect(parsed(DEFAULT_THEME_CSS)).toEqual(DEFAULT_THEME);
    for (const name of THEME_COLORS) {
      expect(DEFAULT_THEME.variables[`--color-${name}`]).toBeDefined();
      expect(DEFAULT_THEME.dark[`--color-${name}`]).toBeDefined();
    }
    expect(DEFAULT_THEME.variables["--radius"]).toBeDefined();
    expect(DEFAULT_THEME.variables["--font-sans"]).toBeDefined();
    expect(DEFAULT_THEME.variables["--font-heading"]).toBeDefined();
  });

  it("accepts an empty brand", () => {
    expect(parsed("")).toEqual({ variables: {}, dark: {}, fontFaces: [] });
  });

  it("refuses rules and at-rules outside the grammar", () => {
    expect(codes(".card { color: red; }")).toEqual(["brand-css-unsupported"]);
    expect(codes('@import "./other.css";')).toEqual(["brand-css-unsupported"]);
    expect(codes("@media (min-width: 600px) { @theme { --color-a: #000; } }")).toEqual([
      "brand-css-unsupported",
    ]);
    expect(codes("@theme { color: red; }")).toEqual(["brand-css-property"]);
  });

  it("refuses variables outside the brand namespaces and unsafe values", () => {
    expect(codes("@theme { --animate-spin: spin 1s; }")).toEqual(["brand-css-namespace"]);
    expect(codes("@theme { --color-a: url(https://x.test/a.png); }")).toEqual(["brand-css-value"]);
    expect(codes("@theme { --color-a: #000 !important; }")).toEqual(["brand-css-value"]);
    expect(codes("@theme { --color-a: #000; --color-a: #fff; }")).toEqual(["brand-css-duplicate"]);
  });

  it("keeps the dark-mode block to colors", () => {
    expect(codes("@media (prefers-color-scheme: dark) { @theme { --radius: 2px; } }")).toEqual([
      "brand-css-dark-namespace",
    ]);
  });

  it("accepts only https WOFF2 font sources", () => {
    for (const src of [
      'url("./fonts/a.woff2")',
      'url("http://cdn.test/a.woff2")',
      'url("https://cdn.test/a.ttf")',
      'local("Acme"), url("https://cdn.test/a.woff2")',
    ])
      expect(codes(`@font-face { font-family: A; src: ${src}; }`)).toContain("brand-css-font-src");
    expect(codes('@font-face { src: url("https://cdn.test/a.woff2"); }')).toEqual([
      "brand-css-font-incomplete",
    ]);
    expect(
      codes(
        '@font-face { font-family: A; src: url("https://cdn.test/a.woff2"); size-adjust: 90%; }',
      ),
    ).toEqual(["brand-css-font-descriptor"]);
  });

  it("locates every finding, not just the first", () => {
    const result = parseBrandCss(".a{} @theme { --bad: 1; }");
    expect(result.isErr() ? result.error.map((finding) => finding.span.start) : []).toEqual([
      0, 14,
    ]);
  });
});

describe("text on brand", () => {
  it("picks whichever of black and white contrasts more with the brand color", () => {
    // #767676 is the lightest gray with 4.5:1 against white, and black still edges it;
    // one step darker, white wins.
    expect(contrastForeground("#767676")).toBe("#000000");
    expect(contrastForeground("#757575")).toBe("#ffffff");
    expect(contrastForeground("#e11d48")).toBe("#ffffff");
    expect(contrastForeground("#facc15")).toBe("#000000");
  });

  it("evaluates every color notation parseColor reads", () => {
    expect(contrastForeground("rgb(225 29 72)")).toBe("#ffffff");
    expect(contrastForeground("rgba(250, 204, 21, 1)")).toBe("#000000");
    expect(contrastForeground("hsl(0 0% 10%)")).toBe("#ffffff");
    expect(contrastForeground("oklch(0.97 0.01 90)")).toBe("#000000");
    expect(contrastForeground("oklab(0.2 0 0)")).toBe("#ffffff");
    expect(contrastForeground("#fff")).toBe("#000000");
    expect(contrastForeground("navy")).toBe("#ffffff");
    // A translucent dark color over the white page reads light.
    expect(contrastForeground("rgb(0 0 0 / 0.1)")).toBe("#000000");
  });

  it("guesses nothing for a color it cannot evaluate", () => {
    for (const color of ["var(--color-primary)", "currentColor", "lab(50 20 30)", "rebeccapurple"])
      expect(contrastForeground(color)).toBeUndefined();
  });

  it("picks a foreground per mode for each fill the layer sets without one", () => {
    expect(
      foregroundDefaults(
        { "--color-primary": "#facc15", "--color-accent": "#1e3a8a" },
        { "--color-primary": "#1e3a8a" },
      ),
    ).toEqual({
      light: { "--color-primary-foreground": "#000000", "--color-accent-foreground": "#ffffff" },
      dark: { "--color-primary-foreground": "#ffffff" },
    });
  });

  it("keeps a foreground the layer sets and guesses nothing for a color it cannot read", () => {
    expect(
      foregroundDefaults(
        { "--color-primary": "#facc15", "--color-primary-foreground": "#7c2d12" },
        { "--color-primary": "#1e3a8a", "--color-primary-foreground": "#bfdbfe" },
      ),
    ).toEqual({ light: {}, dark: {} });
    expect(foregroundDefaults({ "--color-primary": "var(--x)" }, {})).toEqual({
      light: {},
      dark: {},
    });
  });

  it("compiles the contrast pick where the layer leaves the foreground out", () => {
    const lowered = lowerThemeCss(
      "@theme { --color-primary: #facc15; } @media (prefers-color-scheme: dark) { @theme { --color-primary: #1e3a8a; } }",
    );
    expect(lowered).toContain("--color-primary-foreground: #000000;");
    expect(lowered).toMatch(/:root \{[^}]*--color-primary-foreground: #ffffff;/);
  });
});

describe("lowerThemeCss", () => {
  // Every `:root` declaration list inside a dark-mode query, joined.
  const darkBlock = (css: string): string =>
    [...css.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{([^@]*?\})\s*\}/g)]
      .map((match) => match[1])
      .join("\n");

  it("marks every @theme static and leaves an already static one alone", () => {
    expect(lowerThemeCss("@theme { --color-primary: #111111; }")).toContain("@theme static {");
    const lowered = lowerThemeCss("@theme static { --color-border: #111111; }");
    expect(lowered.match(/static/g)).toHaveLength(1);
  });

  it("turns the dark @theme into :root inside the query", () => {
    const lowered = lowerThemeCss(
      "@theme { --color-primary: #111111; --color-border: #dddddd; } @media (prefers-color-scheme: dark) { @theme { --color-primary: #eeeeee; --color-border: #333333; } }",
    );
    const dark = darkBlock(lowered);
    expect(dark).toContain(":root");
    expect(dark).not.toContain("@theme");
    expect(dark).toContain("--color-primary: #eeeeee;");
  });

  it("carries a color the layer sets in light but not in dark into dark", () => {
    const lowered = lowerThemeCss(
      "@theme { --color-primary: #111111; --color-border: #dddddd; } @media (prefers-color-scheme: dark) { @theme { --color-border: #333333; } }",
    );
    const dark = darkBlock(lowered);
    expect(dark).toContain("--color-primary: #111111;");
    expect(dark).toContain("--color-border: #333333;");
    expect(dark).not.toContain("--color-border: #dddddd;");
  });

  it("carries a light-only color into dark even with no dark block", () => {
    const dark = darkBlock(lowerThemeCss("@theme { --color-primary: #111111; }"));
    expect(dark).toContain("--color-primary: #111111;");
  });

  it("adds fill foregrounds in light and dark and keeps one the layer sets", () => {
    const lowered = lowerThemeCss(
      "@theme { --color-primary: #facc15; --color-accent: #1e3a8a; --color-accent-foreground: #bfdbfe; } @media (prefers-color-scheme: dark) { @theme { --color-primary: #1e3a8a; } }",
    );
    expect(lowered).toContain("--color-primary-foreground: #000000;");
    expect(darkBlock(lowered)).toContain("--color-primary-foreground: #ffffff;");
    expect(lowered).not.toContain("--color-accent-foreground: #ffffff");
    expect(lowered).toContain("--color-accent-foreground: #bfdbfe;");
  });

  it("adds nothing for a layer that sets no theme", () => {
    expect(lowerThemeCss("")).toBe("");
    expect(lowerThemeCss(".a { color: red; }")).toBe(".a { color: red; }");
  });
});
