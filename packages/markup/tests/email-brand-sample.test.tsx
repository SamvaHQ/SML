/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { type EmailBrand } from "../src/email/brand";
import { renderBrandSample } from "../src/email/brand-footer";
import { samvaBrandPlugin } from "../src/email/brand-plugin";
import { Email } from "../src/email/components";
import { EmailCompileError } from "../src/email/diagnostics";

const BRAND: EmailBrand = {
  slug: "acme",
  css: `@font-face {
  font-family: "Acme Sans";
  src: url("https://cdn.acme.test/acme-sans.woff2") format("woff2");
}
@theme {
  --color-primary: #e11d48;
  --font-sans: "Acme Sans", Helvetica, sans-serif;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-primary: #fb7185;
  }
}`,
  assets: { logoUrl: "https://cdn.acme.test/logo.png" },
  footer: { companyName: "Acme Inc." },
};

describe("renderBrandSample", () => {
  it("renders content against the brand theme with the brand components bound", async () => {
    const rendered = await renderBrandSample(BRAND, {
      classes: ["bg-primary", "font-sans"],
      render: ({ BrandLogo, BrandFooter }) => ({
        subject: "Sample",
        body: (
          <Email>
            <BrandLogo />
            <p className="bg-primary font-sans">Hello</p>
            <BrandFooter />
          </Email>
        ),
      }),
    });
    expect(rendered.html).toContain("background-color:#e11d48");
    expect(rendered.html).toMatch(
      /@media \(prefers-color-scheme:dark\)\{[^}]*\.sml-dark-[a-z0-9]+\{background-color:#fb7185!important\}/,
    );
    expect(rendered.html).toContain('font-family:"Acme Sans"');
    expect(rendered.html).toContain("https://cdn.acme.test/acme-sans.woff2");
    expect(rendered.html).toContain('src="https://cdn.acme.test/logo.png"');
    expect(rendered.html).toContain(`${samvaBrandPlugin.footerAttribute}=""`);
    expect(rendered.html).toContain("Acme Inc.");
  });

  it("renders text on brand in the contrast color when the brand leaves it out", async () => {
    const rendered = await renderBrandSample(BRAND, {
      classes: ["bg-primary", "text-primary-foreground"],
      render: () => ({
        subject: "Sample",
        body: (
          <Email>
            <p className="bg-primary text-primary-foreground">Hello</p>
          </Email>
        ),
      }),
    });
    expect(rendered.html).toMatch(
      /background-color:#e11d48;\s*color:#ffffff|color:#ffffff;\s*background-color:#e11d48/,
    );
    expect(rendered.html).toMatch(/\{[^}]*color:#000000!important/);
  });

  it("refuses a brand theme outside the grammar", async () => {
    const error = await renderBrandSample(
      { slug: "broken", css: ".card { color: red; }" },
      { classes: [], render: () => ({ subject: "Sample", body: <Email>Hi</Email> }) },
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(EmailCompileError);
  });
});
