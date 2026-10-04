/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { applyStylesheet } from "../src/email/cascade";
import { Button, Divider, Section } from "../src/email/components";
import { parseStylesheet, type Stylesheet } from "../src/email/css";
import { compileEmail } from "../src/email/render";
import { transformProject } from "../src/email/transform";

const options = { assetBase: "https://assets.samva.test/theme" } as const;

const registered = (sheet: Stylesheet | undefined): Stylesheet => {
  expect(sheet).toBeDefined();
  return sheet as Stylesheet;
};

const STARTER = `@theme {
  --color-brand: #3d4ed8;
  --color-surface: #ffffff;
}`;

describe("theme variables a project's own stylesheets read", () => {
  it("reach the inliner although no utility reads them", async () => {
    const theme = `@import "./starter.css";\n@theme {}\n`;
    const project = await transformProject(
      {
        "theme.css": theme,
        "starter.css": STARTER,
        "emails/card.css": `.card { color: var(--color-brand); }`,
        "emails/card.tsx": `/** @jsxImportSource @samva/markup/email */\nimport "./card.css";\nexport const view = () => <p className="card">hi</p>;`,
      },
      { ...options, tailwind: { css: theme } },
    );
    const sheet = registered(project.tailwindSheet);
    expect(sheet.variables["--color-brand"]).toBe("#3d4ed8");
    expect(sheet.variables["--color-surface"]).toBe("#ffffff");
  });

  it("keep the value of the last layer that sets them", async () => {
    const theme = `@import "./starter.css";\n@import "samva:brand";\n@theme {\n  --color-surface: #fafafa;\n}\n`;
    const project = await transformProject(
      { "theme.css": theme, "starter.css": STARTER, "emails/plain.tsx": `export const x = 1;` },
      {
        ...options,
        tailwind: { css: theme },
        brand: { slug: "acme", css: `@theme {\n  --color-brand: #e11d48;\n}\n` },
      },
    );
    const sheet = registered(project.tailwindSheet);
    expect(sheet.variables["--color-brand"]).toBe("#e11d48");
    expect(sheet.variables["--color-surface"]).toBe("#fafafa");
  });
});

describe("theme variables outside CSS", () => {
  const sheet = parseStylesheet(
    ':root{--color-brand:#3d4ed8;--color-brand-foreground:#ffffff;--font-body:"Acme Sans", sans-serif}',
    { origin: "theme.css" },
  );

  it("resolve in a Button's classic Outlook VML, escaped for its attributes", () => {
    const { tree } = applyStylesheet(
      <Button
        href="https://example.test"
        height={44}
        backgroundColor="var(--color-brand)"
        color="var(--color-brand-foreground)"
        fontFamily="var(--font-body)"
      >
        Go
      </Button>,
      sheet,
    );
    const { html } = compileEmail(tree);
    expect(html).toContain('fillcolor="#3d4ed8"');
    expect(html).toContain("color:#ffffff;font-family:&quot;Acme Sans&quot;, sans-serif;");
    expect(html).not.toContain("var(");
  });

  it("resolve in a presentational bgcolor, and an unknown variable stays as written", () => {
    const { tree } = applyStylesheet(
      <Section bgcolor="var(--color-brand)">
        <Divider color="var(--color-missing)" />
      </Section>,
      sheet,
    );
    const { html } = compileEmail(tree);
    expect(html).toContain('bgcolor="#3d4ed8"');
    expect(html).toContain("var(--color-missing)");
  });
});
