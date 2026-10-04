import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { renderIr } from "../src/render-ir";
import { compileTemplate } from "../src/sml/compile";

const skill = readFileSync(join(import.meta.dirname, "..", "skills", "sml", "SKILL.md"), "utf8");

describe("sml skill", () => {
  it("opens with the skill frontmatter", () => {
    expect(skill).toMatch(/^---\nname: sml\ndescription: .+\n---\n/);
  });

  it("ships an example that compiles and renders every fixture", async () => {
    const source = /```tsx\n([\s\S]*?)```/.exec(skill)?.[1];
    expect(source).toBeDefined();
    const compiled = await compileTemplate({
      files: { "templates/order-shipped.tsx": source!, "theme.css": "", "starter.css": "" },
      entry: "templates/order-shipped.tsx",
      assetBase: "https://assets.example",
      tailwind: { css: "", cssPath: "theme.css" },
    });
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.ir).toBeDefined();
    for (const fixture of Object.values(compiled.fixtures)) {
      const rendered = renderIr(compiled.ir!, fixture, {});
      expect(rendered.subject).toContain("your order shipped");
      expect(rendered.html).toContain("it shipped");
    }
  });
});
