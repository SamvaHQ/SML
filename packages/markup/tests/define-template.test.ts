import { describe, expect, it } from "@effect/vitest";

import { defineTemplate } from "../src";
import { jsonSchema } from "../src/input-schema";

const schema = jsonSchema<{ name: string }>({
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
  additionalProperties: false,
});

describe("defineTemplate", () => {
  it("returns the definition with an email render adapter", () => {
    const template = defineTemplate({
      id: "order-shipped",
      schema,
      fixtures: { default: { name: "Ada" } },
      email: {
        subject: (input) => `Hi ${input.name}`,
        preheader: (input) => `Shipped, ${input.name}`,
        body: () => ({ type: "Fragment", children: [] }),
      },
    });
    expect(template.id).toBe("order-shipped");
    expect(template.fixtures).toEqual({ default: { name: "Ada" } });
    expect(template.email?.subject({ name: "Ada" })).toBe("Hi Ada");
    expect(template.email?.preheader?.({ name: "Ada" })).toBe("Shipped, Ada");
  });

  it("refuses ids that are not lowercase kebab-case", () => {
    for (const id of [
      "Order",
      "order_shipped",
      "order--x",
      "-order",
      "order-",
      "",
      "a".repeat(101),
    ])
      expect(() => defineTemplate({ id, schema, fixtures: { default: { name: "Ada" } } })).toThrow(
        /kebab-case/,
      );
  });

  it("requires at least one fixture and path-safe fixture keys", () => {
    expect(() => defineTemplate({ id: "a", schema, fixtures: {} })).toThrow(/at least one/);
    expect(() =>
      defineTemplate({ id: "a", schema, fixtures: { "../x": { name: "Ada" } } }),
    ).toThrow(/path segment/);
  });
});
