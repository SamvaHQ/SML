import { describe, expect, it } from "@effect/vitest";

import { renderIr, renderIrSms, renderIrWhatsApp } from "../src/render-ir";
import { compileTemplate } from "../src/sml/compile";
import { whatsappTemplate } from "../src/whatsapp-template";

const SCHEMA = `jsonSchema<{
  name: string;
  order: { id: string; total: number };
  items: { title: string }[];
  trackingUrl?: string;
  note?: string;
  vip: boolean;
  currency: string;
  phone: string;
  code: string;
}>({
  type: "object",
  properties: {
    name: { type: "string" },
    order: {
      type: "object",
      properties: { id: { type: "string" }, total: { type: "number" } },
      required: ["id", "total"],
      additionalProperties: false,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    },
    trackingUrl: { type: "string" },
    note: { type: "string" },
    vip: { type: "boolean" },
    currency: { type: "string" },
    phone: { type: "string" },
    code: { type: "string" },
  },
  required: ["name", "order", "items", "vip", "currency", "phone", "code"],
  additionalProperties: false,
})`;

const FIXTURES = `{
  default: {
    name: "Ada",
    order: { id: "A-1", total: 84 },
    items: [{ title: "Shirt" }, { title: "Hat" }],
    vip: true,
    currency: "USD",
    phone: "+15551234567",
    code: "SAVE10",
    trackingUrl: "https://track.example/A-1",
  },
  bare: {
    name: "Bo",
    order: { id: "B-2", total: 5 },
    items: [],
    vip: false,
    currency: "USD",
    phone: "+15551234567",
    code: "SAVE10",
  },
}`;

const IMPORTS = `
import { defineTemplate } from "@samva/markup";
import { fmt } from "@samva/markup/fmt";
import { Email } from "@samva/markup/email";
import { Sms } from "@samva/markup/sms";
import { WhatsApp } from "@samva/markup/whatsapp";
import { jsonSchema } from "@samva/markup/input-schema";
`;

const template = (channels: string, imports = IMPORTS): string => `${imports}
export default defineTemplate({
  id: "order-shipped",
  schema: ${SCHEMA},
  fixtures: ${FIXTURES},
  ${channels}
});
`;

const compile = (channels: string, imports?: string) =>
  compileTemplate({
    files: { "templates/entry.tsx": template(channels, imports) },
    entry: "templates/entry.tsx",
    assetBase: "https://assets.example",
  });

const errorCodes = async (channels: string, imports?: string) =>
  (await compile(channels, imports)).diagnostics
    .filter((item) => item.severity === "error")
    .map((item) => item.code);

const ok = async (channels: string) => {
  const compiled = await compile(channels);
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return compiled;
};

const SMS = `sms: (input) => (
    <Sms category="transactional">
      Hi {input.name}, order {input.order.id} ships.
      {input.vip && " Priority."}
      {input.trackingUrl && \` Track: \${input.trackingUrl}\`}
      {" Total "}{fmt.money(input.order.total, input.currency)}.
      {input.items.map((item) => \` [\${item.title}]\`)}
    </Sms>
  ),`;

const WHATSAPP = `whatsapp: (input) => (
    <WhatsApp name="order_shipped" language="en_US" category="utility">
      <WhatsApp.Header>Order {input.order.id}</WhatsApp.Header>
      <WhatsApp.Body>Hi {input.name}, your order {input.order.id} has shipped.</WhatsApp.Body>
      <WhatsApp.Footer>Thanks for shopping</WhatsApp.Footer>
      <WhatsApp.Buttons>
        {input.trackingUrl && <WhatsApp.UrlButton url={input.trackingUrl}>Track</WhatsApp.UrlButton>}
        <WhatsApp.QuickReplyButton>Stop</WhatsApp.QuickReplyButton>
        <WhatsApp.PhoneButton phone={input.phone}>Call us</WhatsApp.PhoneButton>
        <WhatsApp.CopyCodeButton>{input.code}</WhatsApp.CopyCodeButton>
      </WhatsApp.Buttons>
    </WhatsApp>
  ),`;

describe("the sms channel", () => {
  it("lowers bindings, conditionals, formatters and maps to plain text", async () => {
    const compiled = await ok(SMS);
    expect(compiled.ir?.sms?.category).toBe("transactional");
    expect(renderIrSms(compiled.ir!, compiled.fixtures.default)).toBe(
      "Hi Ada, order A-1 ships. Priority. Track: https://track.example/A-1 Total $84.00. [Shirt] [Hat]",
    );
    expect(renderIrSms(compiled.ir!, compiled.fixtures.bare)).toBe(
      "Hi Bo, order B-2 ships. Total $5.00.",
    );
  });

  it("refuses an element in the body", async () => {
    expect(await errorCodes(`sms: (input) => (<Sms>Hi <b>{input.name}</b></Sms>),`)).toContain(
      "sms-markup",
    );
  });

  it("refuses a category outside the set and a dynamic one", async () => {
    expect(await errorCodes(`sms: (input) => (<Sms category="spam">Hi</Sms>),`)).toContain(
      "invalid-attribute",
    );
    expect(await errorCodes(`sms: (input) => (<Sms category={input.name}>Hi</Sms>),`)).toContain(
      "dynamic-expression",
    );
  });

  it("checks bindings inside the body", async () => {
    expect(await errorCodes(`sms: (input) => (<Sms>Hi {input.nmae}</Sms>),`)).toContain(
      "unknown-field",
    );
    expect(await errorCodes(`sms: (input) => (<Sms>Note {input.note}</Sms>),`)).toContain(
      "unguarded-optional",
    );
    expect(
      await errorCodes(`sms: (input) => (<Sms>{input.note && \`Note \${input.note}\`}</Sms>),`),
    ).toEqual([]);
  });

  it("requires the body to return the Sms root", async () => {
    expect(await errorCodes(`sms: (input) => (<p>Hi</p>),`)).toContain("wrong-channel");
    expect(
      await errorCodes(`sms: (input) => (<WhatsApp language="en" category="utility" />),`),
    ).toContain("wrong-channel");
  });
});

describe("the whatsapp channel", () => {
  it("lowers header, body, footer and buttons, with the url button conditional", async () => {
    const compiled = await ok(WHATSAPP);
    const ir = compiled.ir!.whatsapp!;
    expect(ir.name).toBe("order_shipped");
    expect(ir.buttons?.[0]).toHaveProperty("if");
    expect(renderIrWhatsApp(compiled.ir!, compiled.fixtures.default)).toEqual({
      name: "order_shipped",
      language: "en_US",
      category: "utility",
      header: { type: "text", text: "Order A-1" },
      body: "Hi Ada, your order A-1 has shipped.",
      footer: "Thanks for shopping",
      buttons: [
        { type: "url", text: "Track", url: "https://track.example/A-1" },
        { type: "quick-reply", text: "Stop" },
        { type: "phone", text: "Call us", phone: "+15551234567" },
        { type: "copy-code", code: "SAVE10" },
      ],
    });
    expect(
      renderIrWhatsApp(compiled.ir!, compiled.fixtures.bare).buttons.map((b) => b.type),
    ).toEqual(["quick-reply", "phone", "copy-code"]);
  });

  it("supports a media header and ternary buttons", async () => {
    const compiled = await ok(`whatsapp: (input) => (
      <WhatsApp language="en_US" category="marketing">
        <WhatsApp.Header type="image">https://cdn.example/a.png</WhatsApp.Header>
        <WhatsApp.Body>Hello</WhatsApp.Body>
        <WhatsApp.Buttons>
          {input.vip ? <WhatsApp.QuickReplyButton>VIP</WhatsApp.QuickReplyButton> : <WhatsApp.QuickReplyButton>Join</WhatsApp.QuickReplyButton>}
        </WhatsApp.Buttons>
      </WhatsApp>
    ),`);
    const rendered = renderIrWhatsApp(compiled.ir!, compiled.fixtures.bare);
    expect(rendered.header).toEqual({ type: "image", text: "https://cdn.example/a.png" });
    expect(rendered.buttons).toEqual([{ type: "quick-reply", text: "Join" }]);
  });

  it("checks bindings in buttons: guarded optional passes, unguarded fails", async () => {
    expect(
      await errorCodes(`whatsapp: (input) => (
        <WhatsApp language="en_US" category="utility">
          <WhatsApp.Body>Hi</WhatsApp.Body>
          <WhatsApp.Buttons><WhatsApp.UrlButton url={input.trackingUrl}>Track</WhatsApp.UrlButton></WhatsApp.Buttons>
        </WhatsApp>
      ),`),
    ).toContain("unguarded-optional");
    expect(
      await errorCodes(`whatsapp: (input) => (
        <WhatsApp language="en_US" category="utility">
          <WhatsApp.Body>Hi {input.nope}</WhatsApp.Body>
        </WhatsApp>
      ),`),
    ).toContain("unknown-field");
  });

  it("refuses branching text parts", async () => {
    const body = (content: string) => `whatsapp: (input) => (
      <WhatsApp language="en_US" category="utility">
        <WhatsApp.Body>${content}</WhatsApp.Body>
      </WhatsApp>
    ),`;
    expect(await errorCodes(body("{input.vip && 'VIP'}"))).toContain("whatsapp-conditional");
    expect(await errorCodes(body("{input.items.map((i) => i.title)}"))).toContain(
      "whatsapp-conditional",
    );
    expect(await errorCodes(body("<b>x</b>"))).toContain("whatsapp-conditional");
  });

  it("enforces Meta's button counts over the conditional maximum", async () => {
    const url = (n: number) =>
      `<WhatsApp.UrlButton url="https://a.example/${n}">U${n}</WhatsApp.UrlButton>`;
    const wrap = (buttons: string) => `whatsapp: (input) => (
      <WhatsApp language="en_US" category="utility">
        <WhatsApp.Body>Hi</WhatsApp.Body>
        <WhatsApp.Buttons>${buttons}</WhatsApp.Buttons>
      </WhatsApp>
    ),`;
    expect(await errorCodes(wrap(`${url(1)}${url(2)}${url(3)}`))).toContain(
      "whatsapp-button-limit",
    );
    expect(
      await errorCodes(wrap(`${url(1)}{input.vip && ${url(2)}}{input.vip && ${url(3)}}`)),
    ).toContain("whatsapp-button-limit");
    expect(await errorCodes(wrap(`${url(1)}{input.vip ? ${url(2)} : ${url(3)}}`))).toEqual([]);
    const phones = `<WhatsApp.PhoneButton phone="+1">A</WhatsApp.PhoneButton><WhatsApp.PhoneButton phone="+2">B</WhatsApp.PhoneButton>`;
    expect(await errorCodes(wrap(phones))).toContain("whatsapp-button-limit");
    const quick = Array.from(
      { length: 11 },
      (_, n) => `<WhatsApp.QuickReplyButton>Q${n}</WhatsApp.QuickReplyButton>`,
    ).join("");
    expect(await errorCodes(wrap(quick))).toContain("whatsapp-button-limit");
  });

  it("warns on length, requires a body, and limits header variables", async () => {
    const long = "x".repeat(70);
    const compiled = await compile(`whatsapp: (input) => (
      <WhatsApp language="en_US" category="utility">
        <WhatsApp.Header>${long}</WhatsApp.Header>
        <WhatsApp.Body>Hi</WhatsApp.Body>
        <WhatsApp.Buttons><WhatsApp.QuickReplyButton>${long}</WhatsApp.QuickReplyButton></WhatsApp.Buttons>
      </WhatsApp>
    ),`);
    const warnings = compiled.diagnostics.filter((item) => item.code === "whatsapp-length");
    expect(warnings).toHaveLength(2);
    expect(warnings.every((item) => item.severity === "warning" && item.fix !== undefined)).toBe(
      true,
    );
    expect(compiled.ir).toBeDefined();

    expect(
      await errorCodes(`whatsapp: (input) => (<WhatsApp language="en_US" category="utility" />),`),
    ).toContain("whatsapp-body-required");
    expect(
      await errorCodes(`whatsapp: (input) => (
        <WhatsApp language="en_US" category="utility">
          <WhatsApp.Header>{input.name} {input.order.id}</WhatsApp.Header>
          <WhatsApp.Body>Hi</WhatsApp.Body>
        </WhatsApp>
      ),`),
    ).toContain("whatsapp-header-variables");
    expect(
      await errorCodes(`whatsapp: (input) => (
        <WhatsApp language="en_US" category="utility">
          <WhatsApp.Header>{input.name} {input.name}</WhatsApp.Header>
          <WhatsApp.Body>Hi</WhatsApp.Body>
        </WhatsApp>
      ),`),
    ).toEqual([]);
  });

  it("requires category and language, and a known category", async () => {
    expect(
      await errorCodes(
        `whatsapp: (input) => (<WhatsApp><WhatsApp.Body>x</WhatsApp.Body></WhatsApp>),`,
      ),
    ).toContain("missing-attribute");
    expect(
      await errorCodes(
        `whatsapp: (input) => (<WhatsApp language="en" category="promo"><WhatsApp.Body>x</WhatsApp.Body></WhatsApp>),`,
      ),
    ).toContain("invalid-attribute");
  });
});

describe("channel components in the wrong place", () => {
  it("reports <Sms> inside the email body", async () => {
    expect(
      await errorCodes(`email: {
        subject: (input) => \`Hi\`,
        body: (input) => (<Email><Sms>Hi</Sms></Email>),
      },`),
    ).toContain("wrong-channel");
  });

  it("reports <WhatsApp.Body> outside a WhatsApp root", async () => {
    expect(
      await errorCodes(`email: {
        subject: (input) => \`Hi\`,
        body: (input) => (<Email><WhatsApp.Body>Hi</WhatsApp.Body></Email>),
      },`),
    ).toContain("wrong-channel");
    expect(
      await errorCodes(`sms: (input) => (<Sms><WhatsApp.Body>Hi</WhatsApp.Body></Sms>),`),
    ).toContain("wrong-channel");
  });
});

describe("whatsappTemplate", () => {
  it("numbers distinct values in order of first appearance and keeps text literal", () => {
    const result = whatsappTemplate([
      "Hi ",
      { bind: "name" },
      ", order ",
      { concat: ["#", { bind: "order.id" }, " for ", { bind: "name" }] },
      ". ",
      { format: "money", args: [{ bind: "order.total" }, "USD"] },
    ]);
    expect(result.template).toBe("Hi {{1}}, order #{{2}} for {{1}}. {{3}}");
    expect(result.params).toEqual([
      { bind: "name" },
      { bind: "order.id" },
      { format: "money", args: [{ bind: "order.total" }, "USD"] },
    ]);
  });

  it("derives the registration text from a compiled body", async () => {
    const compiled = await ok(WHATSAPP);
    const derived = whatsappTemplate(compiled.ir!.whatsapp!.body);
    expect(derived.template).toBe("Hi {{1}}, your order {{2}} has shipped.");
    expect(derived.params).toEqual([{ bind: "name" }, { bind: "order.id" }]);
  });
});

describe("one template, three channels", () => {
  it("compiles email, sms and whatsapp from one schema", async () => {
    const compiled = await ok(`email: {
      subject: (input) => \`Order \${input.order.id}\`,
      body: (input) => (<Email><p>Hi {input.name}</p></Email>),
    },
    ${SMS}
    ${WHATSAPP}`);
    const ir = compiled.ir!;
    expect(ir.email).toBeDefined();
    expect(ir.sms).toBeDefined();
    expect(ir.whatsapp).toBeDefined();
    expect(renderIr(ir, compiled.fixtures.default).subject).toBe("Order A-1");
    expect(renderIrSms(ir, compiled.fixtures.default)).toContain("Hi Ada");
    expect(renderIrWhatsApp(ir, compiled.fixtures.default).body).toContain("Hi Ada");
  });
});
