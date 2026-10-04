import type { StandardJSONSchemaV1 } from "@standard-schema/spec";

import type { SerializeEmailOptions } from "../../src/email/html";
import { renderEmailContent, type RenderedEmail } from "../../src/email/render";
import { inputSchema, type InputSchema } from "../../src/input-schema";
import type { EmailContent } from "../../src/template";
import { snapshotStylesheets } from "./stylesheet-registry";

// Tests of the email primitives, the cascade and the serializer build a message from a plain
// function of its input. This is that scaffolding: a definition holding a validated input contract
// and a render function, and a render bound to the stylesheets registered so far. Nothing in the
// shipped package runs a template like this; the static compiler reads bodies instead.

export interface TemplateDefinition<Input> {
  readonly id: string;
  readonly schema: InputSchema<Input>;
  readonly fixtures: Readonly<Record<string, Input>>;
  readonly render: (input: Input) => EmailContent;
}

export const defineEmail = <S extends StandardJSONSchemaV1>(definition: {
  readonly id: string;
  readonly schema: S;
  readonly fixtures: Readonly<Record<string, NoInfer<StandardJSONSchemaV1.InferInput<S>>>>;
  readonly render: (input: NoInfer<StandardJSONSchemaV1.InferInput<S>>) => EmailContent;
}): TemplateDefinition<StandardJSONSchemaV1.InferInput<S>> => ({
  ...definition,
  schema: inputSchema(definition.schema),
});

export const renderEmail = <Input>(
  template: TemplateDefinition<Input>,
  data: unknown,
  options: SerializeEmailOptions = {},
): RenderedEmail => {
  if (!template.schema.validate(data))
    throw new TypeError(
      `Invalid template input: ${JSON.stringify(template.schema.validate.errors)}`,
    );
  return renderEmailContent(snapshotStylesheets(), () => template.render(data as Input), options);
};
