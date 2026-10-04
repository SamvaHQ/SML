import { describe, expect, it } from "@effect/vitest";

import {
  brandTailwindCss,
  contrastForeground,
  parseBrandCss,
  printBrandCss,
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
  --color-brand: #e11d48;
  --font-body: "Acme Sans", Helvetica, sans-serif;
  --radius-card: 8px;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-brand: #fb7185;
  }
}`;

describe("brand theme CSS", () => {
  it("reads theme variables, dark-mode colors and https WOFF2 fonts", () => {
    expect(parsed(BRAND)).toEqual({
      variables: {
        "--color-brand": "#e11d48",
        "--font-body": '"Acme Sans", Helvetica, sans-serif',
        "--radius-card": "8px",
      },
      dark: { "--color-brand": "#fb7185" },
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

  it("lowers dark-mode colors to -dark theme variables for Tailwind", () => {
    const lowered = parsed(brandTailwindCss(parsed(BRAND)));
    expect(lowered.dark).toEqual({});
    expect(lowered.variables["--color-brand"]).toBe("#e11d48");
    expect(lowered.variables["--color-brand-dark"]).toBe("#fb7185");
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

  it("keeps the dark-mode block to colors, and to names the light block does not claim", () => {
    expect(codes("@media (prefers-color-scheme: dark) { @theme { --radius-card: 2px; } }")).toEqual(
      ["brand-css-dark-namespace"],
    );
    expect(
      codes(
        "@theme { --color-brand-dark: #111; } @media (prefers-color-scheme: dark) { @theme { --color-brand: #222; } }",
      ),
    ).toEqual(["brand-css-dark-conflict"]);
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

  it("compiles the contrast pick where the brand leaves the foreground out", () => {
    const lowered = parsed(
      brandTailwindCss(
        parsed(
          "@theme { --color-brand: #facc15; } @media (prefers-color-scheme: dark) { @theme { --color-brand: #1e3a8a; } }",
        ),
      ),
    );
    expect(lowered.variables["--color-brand-foreground"]).toBe("#000000");
    expect(lowered.variables["--color-brand-foreground-dark"]).toBe("#ffffff");
  });

  it("keeps a foreground the brand sets, in light and dark mode", () => {
    const lowered = parsed(
      brandTailwindCss(
        parsed(
          "@theme { --color-brand: #facc15; --color-brand-foreground: #7c2d12; } @media (prefers-color-scheme: dark) { @theme { --color-brand: #1e3a8a; --color-brand-foreground: #bfdbfe; } }",
        ),
      ),
    );
    expect(lowered.variables["--color-brand-foreground"]).toBe("#7c2d12");
    expect(lowered.variables["--color-brand-foreground-dark"]).toBe("#bfdbfe");
  });

  it("sets no dark foreground without a dark brand color, and none for a color it cannot read", () => {
    const lowered = parsed(brandTailwindCss(parsed("@theme { --color-brand: var(--x); }")));
    expect(lowered.variables["--color-brand-foreground"]).toBeUndefined();
    expect(lowered.variables["--color-brand-foreground-dark"]).toBeUndefined();
  });
});
