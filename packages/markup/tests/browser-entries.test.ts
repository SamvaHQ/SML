import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import type { EmailBrand } from "../src/email/brand";

// The dashboard compiles in the browser through `./compiler`, where Node's `process` does not
// exist. Each case loads its entry fresh with `process` removed and works inside that scope, so a
// library that reads it (picomatch, under caniemail, does when it loads) fails here as it does in
// the browser.

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

const TEMPLATE = `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { BrandFooter } from "samva:brand";

export default defineTemplate({
  id: "browser",
  schema: jsonSchema({ type: "object", properties: {} }),
  fixtures: { default: {} },
  email: {
    subject: () => "Hello",
    body: () => (
      <Email>
        <p className="bg-primary">Hello</p>
        <BrandFooter />
      </Email>
    ),
  },
});
`;

const withoutProcess = async <A>(load: () => Promise<A>): Promise<A> => {
  vi.resetModules();
  vi.stubGlobal("process", undefined);
  return load().finally(() => vi.unstubAllGlobals());
};

describe("browser entries without process", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("compiles and renders through ./compiler and ./render", async () => {
    const html = await withoutProcess(async () => {
      const [{ compileTemplate }, { render }] = await Promise.all([
        import("../src/compiler"),
        import("../src/render"),
      ]);
      const compiled = await compileTemplate({
        files: { "browser.tsx": TEMPLATE },
        entry: "browser.tsx",
        assetBase: "https://assets.example/",
        tailwind: { css: '@import "samva:brand";' },
        brand: BRAND,
      });
      expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      return render(compiled.template!, {}, { target: "email" }).html;
    });
    expect(html).toContain("background-color:#e11d48");
    expect(html).toContain("#fb7185");
    expect(html).toContain("Acme Inc.");
  });

  it("parses Markdown and resolves editable spans without process", async () => {
    const result = await withoutProcess(async () => {
      const [{ parseIssue }, { inspectMarkdownNode }] = await Promise.all([
        import("../src/markdown"),
        import("../src/edit"),
      ]);
      const source = "---\ntitle: Browser\nslug: browser\ntopic: product\n---\n# Browser prose";
      const issue = parseIssue(source, "issues/browser.md");
      const target = inspectMarkdownNode(source, "issues/browser.md", {
        fileName: "issues/browser.md",
        lineNumber: 6,
        columnNumber: 1,
      });
      return { issue, target };
    });
    expect(result.issue.diagnostics).toEqual([]);
    expect(result.target?.properties[0]?.value).toBe("Browser prose");
  });

  it("fails for ./compatibility, so the case above can fail", async () => {
    await expect(withoutProcess(() => import("../src/compatibility"))).rejects.toThrow(/platform/);
  });
});
