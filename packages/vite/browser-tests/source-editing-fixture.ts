export const SOURCE = `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
const Note = ({ label }: { label: string }) => <p>{label}</p>;
export default defineTemplate({
  id: "visual-proof",
  schema: jsonSchema<{name: string}>({type: "object", required: ["name"], properties: {name: {type: "string"}}, additionalProperties: false}),
  fixtures: { first: { name: "Ada" }, second: { name: "Grace" } },
  email: {
    subject: () => "Visual editing",
    body: (input) => (<Email title="Visual editing">
      <h1>Editable heading</h1>
      <a href="https://example.com">Visit example</a>
      <p>{input.name}</p>
      <Note label="shared content" /><Note label="second shared" />
      <div><p>Movable block</p></div><div>Destination</div>
    </Email>),
  },
});
`;

export const COPY = {
  heading: "Editable heading",
  changedHeading: "Changed heading",
  ada: "Ada",
  grace: "Grace",
  lin: "Lin",
  movable: "Movable block",
  destination: "Destination",
  added: "Added text",
} as const;
