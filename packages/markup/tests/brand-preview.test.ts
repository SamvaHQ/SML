import { describe, expect, it } from "@effect/vitest";

import type { EmailBrand } from "../src/email/brand";
import { previewBrand } from "../src/email/brand-preview";

const BRAND: EmailBrand = {
  slug: "acme",
  css: `@theme {
  --color-primary: #e11d48;
  --color-card: #fff1f2;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-primary: #fb7185;
  }
}`,
  assets: { logoUrl: "https://cdn.example/acme.png" },
  footer: { companyName: "Acme Inc." },
};

describe("previewBrand", () => {
  it("renders the sample in the brand's theme, logo and footer", async () => {
    const preview = await previewBrand(BRAND);
    expect(preview.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(preview.html).toContain("background-color:#e11d48");
    expect(preview.html).toContain("background-color:#fff1f2");
    expect(preview.html).toContain("#fb7185");
    expect(preview.html).toContain("https://cdn.example/acme.png");
    expect(preview.html).toContain("Acme Inc.");
  });

  it("returns the findings instead of HTML for a theme outside the brand grammar", async () => {
    const preview = await previewBrand({
      ...BRAND,
      css: "@theme { --color-primary: red; } p { color: red; }",
    });
    expect(preview.html).toBeUndefined();
    expect(preview.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});
