const entry = (body: string, partial = false) => `
import { defineTemplate } from "@samva/markup";
import { Email, Columns, Column } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
${partial ? 'import { Cell } from "./cell";' : ""}
export default defineTemplate({
  id: "regression",
  schema: jsonSchema({ type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "string" } } } }),
  fixtures: { basic: { items: ["First", "Second", "Third"] } },
  email: { subject: () => "Regression", body: (input) => (${body}) },
});`;

const partial =
  'import { Column } from "@samva/markup/email"; export const Cell = ({ label }) => <Column>{label}</Column>;';

export const EMAIL_REGRESSIONS = [
  { name: "deep-body", body: `<Email>${"<div>".repeat(33)}Deep${"</div>".repeat(33)}</Email>` },
  {
    name: "partial-static",
    body: '<Email><Columns><Cell label="First" /><Cell label="Second" /></Columns></Email>',
    partial: true,
  },
  {
    name: "partial-each",
    body: "<Email><Columns each={input.items}>{(item) => <Cell label={item} />}</Columns></Email>",
    partial: true,
  },
  {
    name: "partial-per",
    body: "<Email><Columns each={input.items} per={2}>{(item) => <Cell label={item} />}</Columns></Email>",
    partial: true,
  },
  {
    name: "mixed-static",
    body: '<Email><Columns><Column>Direct</Column><Cell label="Partial" /></Columns></Email>',
    partial: true,
  },
  {
    name: "direct-per",
    body: "<Email><Columns each={input.items} per={2}>{(item) => <Column>{item}</Column>}</Columns></Email>",
  },
].map((scenario) => ({
  name: scenario.name,
  options: {
    files: {
      "entry.tsx": entry(scenario.body, scenario.partial),
      ...(scenario.partial ? { "cell.tsx": partial } : {}),
    },
    entry: "entry.tsx",
    assetBase: "https://assets.example.test/regression",
  },
}));
