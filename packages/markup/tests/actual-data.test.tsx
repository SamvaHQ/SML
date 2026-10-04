/* oxlint-disable react/jsx-key, react/jsx-no-script-url -- Adversarial semantic email fixtures intentionally include unsafe source. */
/** @jsxImportSource @samva/markup/email */
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { jsxDEV } from "../src/email/jsx-dev-runtime";
import { EmailNode } from "../src/email/jsx-runtime";
import { compileEmail } from "../src/email/render";
import { Card } from "./fixtures/email-card";
import { defineEmail, renderEmail } from "./support/email-fixture";

const receipt = defineEmail({
  id: "receipt",
  schema: Schema.toStandardJSONSchemaV1(
    Schema.Struct({
      customer: Schema.Struct({ name: Schema.String }),
      items: Schema.Array(Schema.String),
      show: Schema.Boolean,
    }),
  ),
  fixtures: { basic: { customer: { name: "Ada" }, items: ["Book"], show: true } },
  render: (input) => ({
    subject: `Receipt for ${input.customer.name}`,
    preheader: "Your order",
    body: (
      <html lang="en">
        <body>
          <Card name={input.customer.name} />
          {input.show && (
            <ul>
              {input.items.map((item) => (
                <li key={item}>{item.toUpperCase()}</li>
              ))}
            </ul>
          )}
          <a href="https://example.com">View order</a>
        </body>
      </html>
    ),
  }),
});
it("renders nested actual JSON through imported functions, loops, conditions and escaping", () => {
  const rendered = renderEmail(receipt, {
    customer: { name: "<Ada & Co>" },
    items: ["book", "pen"],
    show: true,
  });
  expect(rendered.html).toContain("Hello &lt;Ada &amp; Co&gt;");
  expect(rendered.html).toContain("<li>BOOK</li><li>PEN</li>");
  expect(rendered.text).toContain("- BOOK\n- PEN");
  expect(
    renderEmail(receipt, { customer: { name: "Ada" }, items: ["Book"], show: false }).html,
  ).not.toContain("<ul>");
  expect(() => renderEmail(receipt, { customer: { name: 2 }, items: [], show: false })).toThrow(
    "Invalid template input",
  );
});
it("retains element and imported component call-site provenance without print/reparse", () => {
  const location = { fileName: "receipt.tsx", lineNumber: 4, columnNumber: 3 };
  const node = jsxDEV("p", { children: "Hello" }, undefined, false, location);
  expect(node).toMatchObject({ type: "Element", origins: [location] });
  expect(compileEmail(node).html).toBe("<p>Hello</p>");
});
it("rejects scripts, handlers, unsafe URLs, CSS injection and header injection", () => {
  const raw = (tag: string, props: Record<string, unknown>) =>
    EmailNode.Element({ tag, props, children: [], origins: [], authored: true });
  for (const tree of [
    // Outside the vocabulary and an event handler: both are type errors too,
    // so build them directly to prove the serializer refuses them as well.
    raw("script", {}),
    raw("p", { onclick: "bad" }),
    <a href="javascript:bad">bad</a>,
    <img src="data:text/html,bad" alt="" />,
    <p style={{ color: "red;display:none" }}>bad</p>,
  ])
    expect(() => compileEmail(tree)).toThrow();
  expect(() =>
    renderEmail(
      { ...receipt, render: () => ({ subject: "bad\r\nBcc: other", body: <p>Hi</p> }) },
      receipt.fixtures.basic,
    ),
  ).toThrow("Invalid email subject");
});
