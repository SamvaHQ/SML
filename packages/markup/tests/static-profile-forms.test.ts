import { describe, expect, it } from "@effect/vitest";

import { PROFILE_FORMS, PROFILE_REJECTED, checkStaticProfile } from "../src/sml/profile";

const template = (body: string, bodyFunction = false): string => `
import { defineTemplate } from "@samva/markup";
import { fmt } from "@samva/markup/fmt";
import { Email, Columns, Column } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "forms",
  schema: jsonSchema<{
    name: string;
    orderId: string;
    trackingUrl?: string;
    vip: boolean;
    total: number;
    currency: string;
    items: { title: string; qty: number }[];
  }>({
    type: "object",
    properties: {
      name: { type: "string" },
      orderId: { type: "string" },
      trackingUrl: { type: "string" },
      vip: { type: "boolean" },
      total: { type: "number" },
      currency: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, qty: { type: "number" } },
          required: ["title", "qty"],
        },
      },
    },
    required: ["name", "orderId", "vip", "total", "currency", "items"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Ada", orderId: "1", vip: true, total: 4, currency: "USD", items: [] } },
  email: {
    subject: (input) => \`Hi \${input.name}\`,
    body: ${bodyFunction ? body : "(input) => (<Email><div>" + body + "</div></Email>)"},
  },
});
`;

describe("static profile forms", () => {
  it.each(PROFILE_FORMS.map((entry) => [entry.form, entry.example] as const))(
    "reads %s",
    (_form, example) => {
      const wrapped = example.startsWith("`") ? `{${example}}` : example;
      const errors = checkStaticProfile(template(wrapped)).filter(
        (item) => item.severity === "error",
      );
      expect(errors).toEqual([]);
    },
  );

  it.each(
    PROFILE_REJECTED.map(
      (entry) => [entry.form, entry.example, entry.code, "scope" in entry] as const,
    ),
  )("refuses %s with its code", (_form, example, code, bodyFunction) => {
    const codes = checkStaticProfile(template(example, bodyFunction)).map((item) => item.code);
    expect(codes).toContain(code);
  });
});
