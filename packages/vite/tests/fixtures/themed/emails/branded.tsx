import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "branded",
  schema: jsonSchema<{ name: string }>({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Ada" } },
  email: {
    subject: () => "Hi",
    body: (input) => (
      <Email>
        <p className="bg-brand dark:bg-brand-dark rounded-card">Hi {input.name}</p>
      </Email>
    ),
  },
});
