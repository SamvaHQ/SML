import { defineTemplate, type TemplateInput } from "@samva/markup";
import { Schema } from "effect";

import { renderReceipt } from "./render";

export const receipt = defineTemplate({
  id: "order-receipt",
  schema: Schema.toStandardJSONSchemaV1(
    Schema.Struct({
      customer: Schema.Struct({ name: Schema.String }),
      items: Schema.Array(Schema.String),
    }),
  ),
  fixtures: { basic: { customer: { name: "Ada" }, items: ["Book"] } },
  email: {
    subject: (input) => input.customer.name,
    body: (input) => renderReceipt(input),
  },
});
export const valid: TemplateInput<typeof receipt> = { customer: { name: "Ada" }, items: [] };
// @ts-expect-error Nested caller input remains required.
export const missing: TemplateInput<typeof receipt> = { customer: {}, items: [] };
// @ts-expect-error Incorrect array element does not widen the inferred schema.
export const wrongItem: TemplateInput<typeof receipt> = { customer: { name: "Ada" }, items: [1] };
defineTemplate({
  id: "invalid",
  schema: Schema.toStandardJSONSchemaV1(Schema.Struct({ name: Schema.String })),
  // @ts-expect-error Fixtures are checked against schema input.
  fixtures: { bad: { name: 42 } },
});
