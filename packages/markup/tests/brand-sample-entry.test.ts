import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import type { EmailBrand } from "../src/email/brand";

// The dashboard compiles a brand preview in the browser through `./brand-sample`, where Node's
// `process` does not exist. Each case loads its entry fresh with `process` removed, so a library
// that reads it at load time (picomatch, under caniemail) fails here as it does in the browser.

const BRAND: EmailBrand = {
  slug: "acme",
  css: `@theme {
  --color-primary: #e11d48;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-primary: #fb7185;
  }
}`,
  assets: {},
  footer: { companyName: "Acme Inc." },
};

const withoutProcess = async <A>(load: () => Promise<A>): Promise<A> => {
  vi.resetModules();
  vi.stubGlobal("process", undefined);
  return load().finally(() => vi.unstubAllGlobals());
};

describe("./brand-sample without process", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads and renders the sample", async () => {
    const [{ renderBrandSample }, { Email }, { jsx }] = await withoutProcess(() =>
      Promise.all([
        import("../src/brand-sample"),
        import("../src/email"),
        import("../src/email/jsx-runtime"),
      ]),
    );
    const rendered = await renderBrandSample(BRAND, {
      classes: ["bg-primary"],
      render: ({ BrandFooter }) => ({
        subject: "Sample",
        body: jsx(Email, {
          children: [
            jsx("p", { className: "bg-primary", children: "Hello" }),
            jsx(BrandFooter, {}),
          ],
        }),
      }),
    });
    expect(rendered.html).toContain("background-color:#e11d48");
    expect(rendered.html).toContain("#fb7185");
    expect(rendered.html).toContain("Acme Inc.");
  });

  it("fails for ./compiler, so the case above can fail", async () => {
    await expect(withoutProcess(() => import("../src/compiler"))).rejects.toThrow(/platform/);
  });
});
