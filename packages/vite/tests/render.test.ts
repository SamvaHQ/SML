import { afterEach, describe, expect, it } from "@effect/vitest";

import { renderChannel, renderTemplate } from "../src/render";
import {
  cleanupProjects,
  emailTemplate,
  multiChannelTemplate,
  tempProject,
  THEME,
} from "./support/project";

afterEach(cleanupProjects);

const project = () =>
  tempProject({
    "templates/welcome.tsx": emailTemplate("welcome", "Welcome"),
    "emails/order.tsx": multiChannelTemplate("order"),
    "theme.css": THEME,
  });

describe("renderTemplate", () => {
  it("renders one fixture by template id", async () => {
    const result = await renderTemplate({
      root: await project(),
      template: "welcome",
      fixture: "second",
    });
    expect(result).toMatchObject({
      ok: true,
      template: "welcome",
      fixture: "second",
      subject: "Welcome, Grace",
      preheader: "Preview",
    });
    if (!result.ok) return;
    expect(result.html).toContain("Welcome, Grace");
    expect(result.html).toContain("#123456");
    expect(result.text).toContain("Welcome, Grace");
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("renders by entry path, from either recognized directory, and returns plain JSON", async () => {
    const result = await renderTemplate({
      root: await project(),
      template: "emails/order.tsx",
      fixture: "first",
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("formats with the requested locale and time zone", async () => {
    const root = await tempProject({
      "templates/when.tsx": emailTemplate("when", "Hello", {
        imports: 'import { fmt } from "@samva/markup/fmt";',
        body: "<Email><p>{fmt.number(1234.5)}</p></Email>",
      }),
    });
    const en = await renderTemplate({ root, template: "when", fixture: "first", locale: "en-US" });
    const de = await renderTemplate({ root, template: "when", fixture: "first", locale: "de-DE" });
    expect(en.ok && en.html).toContain("1,234.5");
    expect(de.ok && de.html).toContain("1.234,5");
  });

  it("answers with diagnostics for an unknown template, an unknown fixture and a channel it lacks", async () => {
    const root = await project();
    const unknownTemplate = await renderTemplate({ root, template: "missing", fixture: "first" });
    expect(unknownTemplate).toMatchObject({ ok: false });
    expect(!unknownTemplate.ok && unknownTemplate.diagnostics[0]?.code).toBe("template-not-found");

    const unknownFixture = await renderTemplate({ root, template: "welcome", fixture: "nope" });
    expect(!unknownFixture.ok && unknownFixture.diagnostics.map((item) => item.code)).toContain(
      "unknown-fixture",
    );
  });

  it("answers with the compile findings for a template that does not compile", async () => {
    const root = await tempProject({
      "templates/bad.tsx": emailTemplate("bad", "Hello", {
        body: "<Email><p>{input.nmae}</p></Email>",
      }),
    });
    const result = await renderTemplate({ root, template: "templates/bad.tsx", fixture: "first" });
    expect(!result.ok && result.diagnostics.map((item) => item.code)).toContain("unknown-field");
  });

  it("shows the compile findings when a template requested by id does not compile", async () => {
    const root = await tempProject({
      "templates/bad.tsx": emailTemplate("bad", "Hello", {
        body: "<Email><p>{input.nmae}</p></Email>",
      }),
      "templates/good.tsx": emailTemplate("good", "Hello"),
    });
    const result = await renderTemplate({ root, template: "bad", fixture: "first" });
    expect(!result.ok && result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["unknown-field", "template-not-found"]),
    );
  });

  it("refuses to render an id that two entries declare", async () => {
    const root = await tempProject({
      "templates/one.tsx": emailTemplate("twice", "One"),
      "emails/two.tsx": emailTemplate("twice", "Two"),
    });
    const result = await renderTemplate({ root, template: "twice", fixture: "first" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.diagnostics.map((item) => item.code)).toContain(
      "duplicate-template-id",
    );
  });

  it("renders a template that other entries' duplicate ids do not touch", async () => {
    const root = await tempProject({
      "templates/one.tsx": emailTemplate("twice", "One"),
      "emails/two.tsx": emailTemplate("twice", "Two"),
      "templates/unique.tsx": emailTemplate("unique", "Unique"),
    });
    expect(await renderTemplate({ root, template: "unique", fixture: "first" })).toMatchObject({
      ok: true,
      template: "unique",
    });
  });
});

describe("renderChannel", () => {
  it("renders the SMS text and the WhatsApp message", async () => {
    const root = await project();
    const sms = await renderChannel({ root, template: "order", fixture: "first", channel: "sms" });
    expect(sms).toMatchObject({ ok: true, channel: "sms", text: "Hi Ada, your order shipped." });
    const whatsapp = await renderChannel({
      root,
      template: "order",
      fixture: "first",
      channel: "whatsapp",
    });
    expect(whatsapp).toMatchObject({
      ok: true,
      channel: "whatsapp",
      message: {
        body: "Hi Ada, your order shipped.",
        language: "en_US",
        category: "utility",
        buttons: [{ type: "quick-reply", text: "Thanks" }],
      },
    });
  });

  it("refuses a channel the template does not declare", async () => {
    const result = await renderChannel({
      root: await project(),
      template: "welcome",
      fixture: "first",
      channel: "sms",
    });
    expect(!result.ok && result.diagnostics[0]?.code).toBe("missing-channel");
  });
});
