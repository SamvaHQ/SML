import { describe, expect, it } from "@effect/vitest";

import type { EmailBrand } from "../src/email/brand";
import type { Stylesheet } from "../src/email/css";
import { EmailCompileError, type EmailDiagnostic } from "../src/email/diagnostics";
import { projectBrandSpecifier, transformProject } from "../src/email/transform";

const options = { assetBase: "https://assets.samva.test/brand" } as const;

const entry = (className: string) =>
  `/** @jsxImportSource @samva/markup/email */\nexport const view = () => <p className="${className}">hi</p>;`;

const STARTER = `@theme {
  --color-brand: #4f46e5;
  --color-surface: #f4f4f5;
  --font-body: Helvetica, sans-serif;
}`;

const BRAND: EmailBrand = {
  slug: "acme",
  css: `@font-face {
  font-family: "Acme Sans";
  src: url("https://cdn.acme.test/acme-sans.woff2") format("woff2");
}
@theme {
  --color-brand: #e11d48;
  --color-accent: #0ea5e9;
  --font-body: "Acme Sans", Helvetica, sans-serif;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-brand: #fb7185;
  }
}`,
};

/** The compiled Tailwind sheet, which a project using any utility always has. */
const registered = (sheet: Stylesheet | undefined): Stylesheet => {
  expect(sheet).toBeDefined();
  return sheet as Stylesheet;
};

const refusal = async (run: () => Promise<unknown>): Promise<readonly EmailDiagnostic[]> => {
  const error = await run().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(EmailCompileError);
  return (error as EmailCompileError).diagnostics;
};

describe("theme imports", () => {
  it("layers the starter, then the brand, then the project's own overrides", async () => {
    const theme = `@import "./starter.css";\n@import "samva:brand";\n@theme {\n  --color-accent: #111111;\n}`;
    const project = await transformProject(
      {
        "theme.css": theme,
        "starter.css": STARTER,
        "emails/welcome.tsx": entry("bg-brand text-accent bg-surface font-body dark:bg-brand-dark"),
      },
      { ...options, tailwind: { css: theme }, brand: BRAND },
    );
    expect(project.diagnostics).toEqual([]);
    const sheet = registered(project.tailwindSheet);
    // The brand beats the starter; the project beats the brand.
    expect(sheet.variables["--color-brand"]).toBe("#e11d48");
    expect(sheet.variables["--color-accent"]).toBe("#111111");
    // Where the brand is silent, the starter still applies.
    expect(sheet.variables["--color-surface"]).toBe("#f4f4f5");
    // The dark-mode @theme lowers to the -dark variable `dark:` utilities read.
    expect(sheet.variables["--color-brand-dark"]).toBe("#fb7185");
    expect(sheet.fontFaces.map((face) => face.family)).toEqual(["Acme Sans"]);
    expect(sheet.fontFaces[0]?.css).toContain("https://cdn.acme.test/acme-sans.woff2");
    // The theme file's own parse does not report the imports Tailwind resolved.
    expect(project.stylesheets.has("theme.css")).toBe(true);
  });

  it("gives a template the contrast foreground when the brand leaves it out", async () => {
    const theme = `@import "samva:brand";`;
    const project = await transformProject(
      {
        "theme.css": theme,
        "emails/welcome.tsx": entry("bg-brand text-brand-foreground"),
      },
      { ...options, tailwind: { css: theme }, brand: BRAND },
    );
    expect(project.diagnostics).toEqual([]);
    const sheet = registered(project.tailwindSheet);
    // #e11d48 carries white text; the dark brand #fb7185 carries black.
    expect(sheet.variables["--color-brand-foreground"]).toBe("#ffffff");
    expect(sheet.variables["--color-brand-foreground-dark"]).toBe("#000000");
  });

  it("compiles a theme's fonts when no utility class is in use", async () => {
    const theme = `@import "samva:brand";`;
    const project = await transformProject(
      { "theme.css": theme, "emails/plain.tsx": entry("") },
      { ...options, tailwind: { css: theme }, brand: BRAND },
    );
    const sheet = registered(project.tailwindSheet);
    expect(sheet.fontFaces.map((face) => face.family)).toEqual(["Acme Sans"]);
  });

  it("resolves a named brand and a stylesheet in a subdirectory", async () => {
    const theme = `@import "./styles/starter.css";\n@import "samva:brand/acme";`;
    const project = await transformProject(
      {
        "theme.css": theme,
        "styles/starter.css": `@import "./tokens.css";`,
        "styles/tokens.css": STARTER,
        "emails/welcome.tsx": entry("bg-surface"),
      },
      { ...options, tailwind: { css: theme }, brand: BRAND },
    );
    expect(registered(project.tailwindSheet).variables["--color-surface"]).toBe("#f4f4f5");
  });

  it("refuses any other import with the file and line that asked for it", async () => {
    const theme = `@theme { --color-a: #000; }\n@import "tailwindcss";`;
    const diagnostics = await refusal(() =>
      transformProject(
        { "theme.css": theme, "emails/a.tsx": entry("p-4") },
        { ...options, tailwind: { css: theme } },
      ),
    );
    expect(diagnostics.map((finding) => [finding.code, finding.origins[0]])).toEqual([
      ["css-import-unresolved", { fileName: "theme.css", lineNumber: 2, columnNumber: 1 }],
    ]);
  });

  it("refuses an import that names no project stylesheet", async () => {
    const theme = `@import "./missing.css";`;
    const diagnostics = await refusal(() =>
      transformProject(
        { "theme.css": theme, "emails/a.tsx": entry("p-4") },
        { ...options, tailwind: { css: theme } },
      ),
    );
    expect(diagnostics[0]?.message).toContain("names no stylesheet in the project");
  });

  it("refuses a brand import the build has no brand for", async () => {
    const theme = `@import "samva:brand";`;
    const diagnostics = await refusal(() =>
      transformProject(
        { "theme.css": theme, "emails/a.tsx": entry("p-4") },
        { ...options, tailwind: { css: theme } },
      ),
    );
    expect(diagnostics.map((finding) => finding.code)).toEqual(["brand-unavailable"]);
  });

  it("refuses a named brand the build did not resolve", async () => {
    const theme = `@import "samva:brand/other";`;
    const diagnostics = await refusal(() =>
      transformProject(
        { "theme.css": theme, "emails/a.tsx": entry("p-4") },
        { ...options, tailwind: { css: theme }, brand: BRAND },
      ),
    );
    expect(diagnostics[0]?.message).toContain("resolved brand acme");
  });

  it("refuses a brand theme outside the brand grammar, located in samva:brand", async () => {
    const theme = `@import "samva:brand";`;
    const diagnostics = await refusal(() =>
      transformProject(
        { "theme.css": theme, "emails/a.tsx": entry("p-4") },
        {
          ...options,
          tailwind: { css: theme },
          brand: { slug: "acme", css: "@theme {\n  --color-a: #000;\n}\n.card { color: red; }" },
        },
      ),
    );
    expect(diagnostics.map((finding) => [finding.code, finding.origins[0]?.lineNumber])).toEqual([
      ["brand-css-unsupported", 4],
    ]);
  });

  it("refuses two different brands in one project", async () => {
    const theme = `@import "samva:brand";\n@import "./more.css";`;
    const diagnostics = await refusal(() =>
      transformProject(
        {
          "theme.css": theme,
          "more.css": `@import "samva:brand/acme";`,
          "emails/a.tsx": entry("p-4"),
        },
        { ...options, tailwind: { css: theme }, brand: BRAND },
      ),
    );
    expect(diagnostics.map((finding) => finding.code)).toEqual(["brand-import-conflict"]);
  });
});

describe("the brand a project imports", () => {
  it("names the brand from the theme or the TSX, for the host to fetch", () => {
    expect(projectBrandSpecifier({ "theme.css": "@theme { --color-a: #000; }" })).toBeUndefined();
    expect(
      projectBrandSpecifier({
        "theme.css": `@import "./starter.css";\n@import "samva:brand/acme";`,
        "starter.css": "",
      }),
    ).toBe("samva:brand/acme");
    expect(
      projectBrandSpecifier({
        "emails/a.tsx": 'import { BrandFooter } from "samva:brand";\nexport const x = BrandFooter;',
      }),
    ).toBe("samva:brand");
  });
});
