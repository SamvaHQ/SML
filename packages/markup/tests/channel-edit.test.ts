import { describe, expect, it } from "@effect/vitest";

import {
  editSmsChannel,
  editWhatsAppChannel,
  readSmsChannel,
  readWhatsAppChannel,
  type SmsEdit,
  type WhatsAppEdit,
} from "../src/channel-edit";
import { applySourceReplacements } from "../src/source-edit";

const wrapSms = (body: string): string => `import { defineTemplate } from "@samva/markup";
import { Sms } from "@samva/markup/sms";

export default defineTemplate({
  id: "code",
  schema,
  fixtures,
  sms: (input) => (
${body}
  ),
});
`;

const SMS = wrapSms(`    <Sms category="transactional">
      Hi {input.name}, your code is {input.code}.
      {input.vip && " Priority."}
    </Sms>`);

const wrapWhatsApp = (body: string): string => `import { defineTemplate } from "@samva/markup";
import { WhatsApp } from "@samva/markup/whatsapp";

export default defineTemplate({
  id: "order",
  schema,
  fixtures,
  whatsapp: (input) => (
${body}
  ),
});
`;

const WHATSAPP =
  wrapWhatsApp(`    <WhatsApp name="order_update" language="en_US" category="utility">
      <WhatsApp.Header>Order {input.order.id}</WhatsApp.Header>
      <WhatsApp.Body>
        Hi {input.name}, your order shipped.
      </WhatsApp.Body>
      <WhatsApp.Footer>Reply STOP to opt out</WhatsApp.Footer>
      <WhatsApp.Buttons>
        <WhatsApp.UrlButton url={input.trackingUrl}>Track</WhatsApp.UrlButton>
        <WhatsApp.QuickReplyButton>Stop</WhatsApp.QuickReplyButton>
        {input.vip && <WhatsApp.PhoneButton phone="+15551234567">Call</WhatsApp.PhoneButton>}
      </WhatsApp.Buttons>
    </WhatsApp>`);

const applied = (source: string, result: ReturnType<typeof editSmsChannel>): string => {
  if (!result.ok) throw new Error(result.reason);
  const next = applySourceReplacements(source, result.edits);
  if (!next.ok) throw new Error(next.reason);
  return next.source;
};

const sms = (source: string, edit: SmsEdit): string =>
  applied(source, editSmsChannel(source, edit));
const whatsapp = (source: string, edit: WhatsAppEdit): string =>
  applied(source, editWhatsAppChannel(source, edit));

describe("SMS channel form", () => {
  it("reads the category, editable text between locked expressions and the input fields", () => {
    const form = readSmsChannel(SMS)!;
    expect(form.category).toEqual({ kind: "literal", value: "transactional" });
    expect(
      form.segments.map((segment) =>
        segment.kind === "text" ? ["text", segment.text] : ["locked", segment.summary],
      ),
    ).toEqual([
      ["text", "Hi "],
      ["locked", "{input.name}"],
      ["text", ", your code is "],
      ["locked", "{input.code}"],
      ["text", "."],
      ["locked", '{input.vip && " Priority."}'],
      ["text", ""],
    ]);
    expect(form.variables).toEqual(["code", "name", "vip"]);
  });

  it("reads string expressions as text", () => {
    const form = readSmsChannel(
      wrapSms(`    <Sms>
      {"Hi "}
      {input.name}
      {"!"}
    </Sms>`),
    )!;
    expect(form.segments.map((segment) => (segment.kind === "text" ? segment.text : "·"))).toEqual([
      "Hi ",
      "·",
      "!",
    ]);
  });

  it("rewrites one text segment and leaves every other byte alone", () => {
    const next = sms(SMS, { kind: "text", segment: 2, text: ", your login code is " });
    expect(next).toBe(SMS.replace(", your code is ", ", your login code is "));
  });

  it("keeps the newlines around a text segment and guards the edge JSX would trim", () => {
    const next = sms(SMS, { kind: "text", segment: 4, text: " Thanks. " });
    expect(next).toContain('{input.code} Thanks.{" "}\n      {input.vip');
    expect(readSmsChannel(next)!.segments[4]).toMatchObject({ kind: "text", text: " Thanks. " });
  });

  it("writes characters JSX text cannot carry as string expressions and reads them back", () => {
    const text = "Hi {name} & <you>\nline two";
    const next = sms(SMS, { kind: "text", segment: 0, text });
    const read = readSmsChannel(next)!.segments[0];
    expect(read).toMatchObject({ kind: "text", text });
    expect(next).not.toContain("Hi {name}");
  });

  it("puts text where a locked expression sits at the edge of the body", () => {
    const next = sms(SMS, { kind: "text", segment: 6, text: "Bye" });
    expect(readSmsChannel(next)!.segments.at(-1)).toMatchObject({ kind: "text", text: "Bye" });
    expect(next).toContain('{input.vip && " Priority."}');
  });

  it("makes an empty body writable", () => {
    const empty = wrapSms("    <Sms />");
    expect(readSmsChannel(empty)!.segments).toHaveLength(1);
    const next = sms(empty, { kind: "text", segment: 0, text: "Hello" });
    expect(next).toContain("<Sms>Hello</Sms>");
  });

  it("sets, changes and removes the category", () => {
    const set = sms(wrapSms("    <Sms>Hi</Sms>"), { kind: "category", value: "promotional" });
    expect(set).toContain('<Sms category="promotional">Hi</Sms>');
    expect(sms(SMS, { kind: "category", value: "promotional" })).toContain(
      '<Sms category="promotional">',
    );
    expect(sms(SMS, { kind: "category", value: undefined })).toContain("<Sms>");
  });

  it("refuses a category that reads the input", () => {
    const dynamic = wrapSms("    <Sms category={input.kind}>Hi</Sms>");
    expect(readSmsChannel(dynamic)!.category.kind).toBe("expression");
    expect(editSmsChannel(dynamic, { kind: "category", value: "promotional" }).ok).toBe(false);
  });

  it("has no form for a channel that is not an in-place <Sms>", () => {
    expect(readSmsChannel(WHATSAPP)).toBeNull();
    expect(readSmsChannel("export default")).toBeNull();
    expect(readSmsChannel(wrapSms("    <p>Hi</p>"))).toBeNull();
  });
});

describe("WhatsApp channel form", () => {
  it("reads attributes, parts and buttons", () => {
    const form = readWhatsAppChannel(WHATSAPP)!;
    expect(form.name).toEqual({ kind: "literal", value: "order_update" });
    expect(form.language).toEqual({ kind: "literal", value: "en_US" });
    expect(form.category).toEqual({ kind: "literal", value: "utility" });
    expect(form.headerType).toEqual({ kind: "absent" });
    expect(form.header?.map((segment) => segment.kind)).toEqual(["text", "locked", "text"]);
    expect(form.body[0]).toMatchObject({ kind: "text", text: "Hi " });
    expect(form.footer).toMatchObject([{ kind: "text", text: "Reply STOP to opt out" }]);
    expect(form.buttons).toMatchObject([
      { kind: "editable", type: "url", text: "Track", url: { kind: "expression" } },
      { kind: "editable", type: "quick-reply", text: "Stop" },
      { kind: "locked" },
    ]);
    expect(form.variables).toEqual(["name", "order.id", "trackingUrl", "vip"]);
  });

  it("edits the root attributes", () => {
    expect(
      whatsapp(WHATSAPP, { kind: "attribute", name: "category", value: "marketing" }),
    ).toContain('category="marketing"');
    expect(whatsapp(WHATSAPP, { kind: "attribute", name: "language", value: "de" })).toContain(
      'language="de"',
    );
    expect(whatsapp(WHATSAPP, { kind: "attribute", name: "name", value: "" })).not.toContain(
      "order_update",
    );
    expect(
      editWhatsAppChannel(WHATSAPP, { kind: "attribute", name: "category", value: "spam" }).ok,
    ).toBe(false);
  });

  it("edits the text of the body, header and footer in place", () => {
    const body = whatsapp(WHATSAPP, {
      kind: "text",
      part: "body",
      segment: 2,
      text: ", your parcel shipped.",
    });
    expect(body).toBe(WHATSAPP.replace(", your order shipped.", ", your parcel shipped."));
    expect(
      whatsapp(WHATSAPP, { kind: "text", part: "footer", segment: 0, text: "No more" }),
    ).toContain("<WhatsApp.Footer>No more</WhatsApp.Footer>");
  });

  it("adds a header and footer with their first text and removes them when emptied", () => {
    const bare = wrapWhatsApp(`    <WhatsApp language="en_US" category="utility">
      <WhatsApp.Body>Hello</WhatsApp.Body>
    </WhatsApp>`);
    const withHeader = whatsapp(bare, { kind: "text", part: "header", segment: 0, text: "Hi" });
    expect(withHeader).toContain(
      "      <WhatsApp.Header>Hi</WhatsApp.Header>\n      <WhatsApp.Body>Hello</WhatsApp.Body>",
    );
    const withFooter = whatsapp(withHeader, {
      kind: "text",
      part: "footer",
      segment: 0,
      text: "Bye",
    });
    expect(withFooter).toContain(
      "<WhatsApp.Body>Hello</WhatsApp.Body>\n      <WhatsApp.Footer>Bye</WhatsApp.Footer>",
    );
    const emptied = whatsapp(withFooter, { kind: "text", part: "header", segment: 0, text: "" });
    expect(emptied).toBe(withFooter.replace("      <WhatsApp.Header>Hi</WhatsApp.Header>\n", ""));
  });

  it("sets the header type only once there is a header", () => {
    const typed = whatsapp(WHATSAPP, { kind: "headerType", value: "image" });
    expect(typed).toContain('<WhatsApp.Header type="image">');
    expect(readWhatsAppChannel(typed)!.headerType).toEqual({ kind: "literal", value: "image" });
    expect(whatsapp(typed, { kind: "headerType", value: "text" })).toContain("<WhatsApp.Header>");
    const bare = wrapWhatsApp(`    <WhatsApp language="en_US" category="utility">
      <WhatsApp.Body>Hello</WhatsApp.Body>
    </WhatsApp>`);
    expect(editWhatsAppChannel(bare, { kind: "headerType", value: "image" }).ok).toBe(false);
  });

  it("edits a button's label and its literal attributes, and refuses a bound one", () => {
    expect(whatsapp(WHATSAPP, { kind: "buttonText", button: 1, text: "Unsubscribe" })).toContain(
      "<WhatsApp.QuickReplyButton>Unsubscribe</WhatsApp.QuickReplyButton>",
    );
    expect(
      editWhatsAppChannel(WHATSAPP, {
        kind: "buttonAttribute",
        button: 0,
        name: "url",
        value: "https://example.com",
      }).ok,
    ).toBe(false);
    expect(editWhatsAppChannel(WHATSAPP, { kind: "buttonText", button: 2, text: "x" }).ok).toBe(
      false,
    );
  });

  it("changes a button's type by rewriting only that element", () => {
    const next = whatsapp(WHATSAPP, { kind: "buttonType", button: 1, type: "url" });
    expect(next).toContain(
      '<WhatsApp.UrlButton url="https://example.com">Stop</WhatsApp.UrlButton>',
    );
    expect(next).toContain("{input.vip && <WhatsApp.PhoneButton");
    const phone = whatsapp(next, {
      kind: "buttonAttribute",
      button: 1,
      name: "url",
      value: "https://samva.dev/a?b=1&c=2",
    });
    expect(phone).toContain('url={"https://samva.dev/a?b=1&c=2"}');
  });

  it("adds a button after the last one and creates the group when there is none", () => {
    const added = whatsapp(WHATSAPP, { kind: "buttonAdd", type: "phone" });
    expect(readWhatsAppChannel(added)!.buttons).toHaveLength(4);
    expect(added).toContain(
      '        {input.vip && <WhatsApp.PhoneButton phone="+15551234567">Call</WhatsApp.PhoneButton>}\n        <WhatsApp.PhoneButton',
    );
    const bare = wrapWhatsApp(`    <WhatsApp language="en_US" category="utility">
      <WhatsApp.Body>Hello</WhatsApp.Body>
    </WhatsApp>`);
    const grouped = whatsapp(bare, { kind: "buttonAdd", type: "copy-code" });
    expect(grouped).toContain(
      "      <WhatsApp.Buttons>\n        <WhatsApp.CopyCodeButton>CODE</WhatsApp.CopyCodeButton>\n      </WhatsApp.Buttons>",
    );
    expect(readWhatsAppChannel(grouped)!.buttons).toMatchObject([
      { kind: "editable", type: "copy-code", text: "CODE" },
    ]);
  });

  it("removes a button, and the group with the last one", () => {
    const removed = whatsapp(WHATSAPP, { kind: "buttonRemove", button: 1 });
    expect(removed).not.toContain("QuickReplyButton");
    expect(readWhatsAppChannel(removed)!.buttons).toHaveLength(2);
    const single = wrapWhatsApp(`    <WhatsApp language="en_US" category="utility">
      <WhatsApp.Body>Hello</WhatsApp.Body>
      <WhatsApp.Buttons>
        <WhatsApp.QuickReplyButton>Stop</WhatsApp.QuickReplyButton>
      </WhatsApp.Buttons>
    </WhatsApp>`);
    expect(whatsapp(single, { kind: "buttonRemove", button: 0 })).toBe(
      wrapWhatsApp(`    <WhatsApp language="en_US" category="utility">
      <WhatsApp.Body>Hello</WhatsApp.Body>
    </WhatsApp>`),
    );
  });

  it("has no form without a body or when the channel is not written in place", () => {
    expect(
      readWhatsAppChannel(wrapWhatsApp(`    <WhatsApp language="en_US" category="utility" />`)),
    ).toBeNull();
    expect(readWhatsAppChannel(SMS)).toBeNull();
  });
});
