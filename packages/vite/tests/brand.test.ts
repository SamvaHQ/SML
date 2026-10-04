import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import type { BrandPlugin } from "@samva/markup/brand";

import { buildTemplates } from "../src/build";
import type { BrandResolver } from "../src/project";
import { exportProject } from "../src/project";
import { renderTemplate } from "../src/render";
import { cleanupProjects, emailTemplate, tempProject } from "./support/project";

afterEach(cleanupProjects);

describe("host brand resolution", () => {
  it("fails loudly on a brand import without a resolver", async () => {
    const root = await tempProject({
      "theme.css": '@import "samva:brand";',
      "templates/welcome.tsx": emailTemplate("welcome"),
    });
    const result = await buildTemplates({ root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "brand-unavailable",
        severity: "error",
        message: expect.stringContaining("brandResolver"),
      }),
    );
  });

  it("compiles without any resolver when no brand is imported", async () => {
    const root = await tempProject({ "templates/welcome.tsx": emailTemplate("welcome") });
    const result = await buildTemplates({ root });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
  it("passes custom brand markers through build, render and export", async () => {
    const root = await tempProject({
      "theme.css": '@import "studio:brand";',
      "templates/welcome.tsx": emailTemplate("welcome", "Hello", {
        imports: 'import { BrandFooter } from "studio:brand";',
        body: '<Email><p className="bg-brand">Hello {input.name}</p><BrandFooter /></Email>',
      }),
    });
    const brandPlugin: BrandPlugin = {
      specifier: "studio:brand",
      footerAttribute: "data-studio-footer",
      unsubscribeRowAttribute: "data-studio-unsubscribe",
      unsubscribeUrlPlaceholder: "{{studio.unsubscribe}}",
      noTrackAttribute: "data-studio-no-track",
    };
    const brandResolver: BrandResolver = {
      resolve: async () => ({
        ok: true,
        brand: { slug: "studio", css: "@theme { --color-brand: #e11d48; }" },
        source: "studio",
        warnings: [],
      }),
    };
    const options = { root, brandPlugin, brandResolver };
    const built = await buildTemplates(options);
    expect(built.ok).toBe(true);
    const rendered = await renderTemplate({ ...options, template: "welcome", fixture: "first" });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const receipt = await exportProject({ ...options, out: join(root, "out") });
    const exportedPath = receipt.templates[0]?.fixtures[0]?.html;
    expect(exportedPath).toBeDefined();
    if (exportedPath === undefined) throw new Error("Export did not write HTML");
    const exported = await readFile(join(root, "out", exportedPath), "utf8");
    for (const html of [
      built.files[0]?.template?.fixtures[0]?.email?.html,
      rendered.html,
      exported,
    ]) {
      expect(html).toContain('data-studio-footer=""');
      expect(html).toContain("data-studio-no-track");
      expect(html).toContain('href="{{studio.unsubscribe}}"');
    }
  });
});
