import { describe, expect, it } from "@effect/vitest";
import { renderedFooterMarkers } from "@samva/markup/brand";
import { compileTemplate } from "@samva/markup/compiler";
import { previewEmail } from "@samva/markup/edit";
import { render, type RenderedPage, type Target } from "@samva/markup/render";

import { compileProject, renderChannelFixture, renderEmailFixtures } from "../src/compile";
import { emailTemplate, multiChannelTemplate, THEME } from "./support/project";

describe("compiled package entries and fixture render target API", () => {
  it("imports the published compiler, brand, edit and render entries without initialization cycles", async () => {
    expect(renderedFooterMarkers('<footer data-samva-footer=""></footer>')).toEqual({
      footer: true,
      unsubscribeLink: false,
    });
    const compiled = await compileTemplate({
      files: { "entry.tsx": emailTemplate("published") },
      entry: "entry.tsx",
      assetBase: "https://assets.example.test",
    });
    expect(compiled.template).toBeDefined();
    const template = compiled.template!;
    expect(previewEmail(template, compiled.fixtures.first).html).toContain("Hello, Ada");
    const target: Target = "web";
    const page: RenderedPage = render(template, compiled.fixtures.first, { target });
    expect(page.html).toContain("<main");
    expect(page.html).toContain("Hello, Ada");
    expect(page.html).not.toMatch(/<table| style=/);
    expect(page.positions.some(({ tag, src }) => tag === "p" && src !== undefined)).toBe(true);
  });

  it("keeps authored channel results while calling the new markup target option", async () => {
    const files = { "templates/order.tsx": multiChannelTemplate("order"), "theme.css": THEME };
    const project = await compileProject({
      files,
      entries: ["templates/order.tsx"],
      assetBase: "https://assets.example.test",
      theme: { css: THEME, path: "theme.css" },
    });
    expect(project.failures).toEqual([]);
    const entry = project.templates[0]!;
    const email = renderEmailFixtures(entry);
    expect(email[0]!.diagnostics).toEqual([]);
    expect(email[0]!.rendered?.subject).toBe("Order for Ada");
    expect(renderChannelFixture(entry, "sms", "first")).toEqual({
      ok: true,
      channel: "sms",
      text: "Hi Ada, your order shipped.",
    });
    expect(renderChannelFixture(entry, "whatsapp", "first")).toMatchObject({
      ok: true,
      channel: "whatsapp",
      message: { body: "Hi Ada, your order shipped." },
    });
    expect(render(entry.compiled, entry.fixtures.first, { target: "web" }).html).toContain(
      "Order for Ada",
    );
  });
});
