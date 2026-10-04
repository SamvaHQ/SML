import type { StandardJSONSchemaV1 } from "@standard-schema/spec";

import type { EmailNode } from "./email/jsx-runtime";
import { inputSchema, type InputSchema } from "./input-schema";

/** One actual-input render owns all of a message's authored content. */
export interface EmailContent {
  readonly subject: string;
  readonly preheader?: string;
  readonly body: EmailNode;
  readonly text?: string;
}

/**
 * The one naming contract for a template id and a fixture key: a letter, a digit or `_` first,
 * then those plus `.`, `_` and `-`.
 *
 * Both names are written into file paths — a local export writes one page at
 * `templates/<id>/<fixture>.html` — so each has to be a single plain path segment. The rule lives
 * at the declaration, so a project that could not be exported is refused where the name is
 * written rather than at the end of a build. Consumers that resolve a path from these names
 * import this pattern; they do not restate it.
 */
export const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const checkTemplateName = (kind: "Template id" | "Fixture key", value: string): void => {
  if (TEMPLATE_NAME_PATTERN.test(value)) return;
  // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Synchronous authoring boundary reports an unusable name to the build caller.
  throw new TypeError(
    `${kind} ${JSON.stringify(value)} is not one path segment. A template id and a fixture key are written into file paths, so each must start with a letter, a digit or "_" and continue with letters, digits, ".", "_" or "-".`,
  );
};

/** Caller input for generated references and separate authoring consumers. */
export type TemplateInput<T extends { readonly schema: unknown }> =
  T["schema"] extends InputSchema<infer Input> ? Input : never;

/**
 * The one naming contract for a template `id`: lowercase kebab-case, the same rule as the CLI and
 * API slug, so the id a definition declares is the handle a caller sends by.
 */
export const TEMPLATE_ID_PATTERN = /^(?=.{1,100}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The email channel of a template: an envelope and a body, each a function of the input. */
export interface EmailChannel<Input> {
  readonly subject: (input: Input) => string;
  readonly preheader?: ((input: Input) => string | undefined) | undefined;
  readonly body: (input: Input) => EmailNode;
}

/** A template as `defineTemplate` returns it: its identity, input contract and each channel it declares. */
export interface SmlTemplate<Input> {
  readonly id: string;
  readonly schema: InputSchema<Input>;
  readonly fixtures: Readonly<Record<string, Input>>;
  readonly locale?: string | undefined;
  readonly email?: EmailChannel<Input> | undefined;
  readonly sms?: ((input: Input) => EmailNode) | undefined;
  readonly whatsapp?: ((input: Input) => EmailNode) | undefined;
}

// oxlint-disable samva/no-try-catch-or-throw, samva/no-error-constructor -- Synchronous authoring boundary reports an unusable template to the build caller.
/**
 * Define a template: one id, one input schema, named fixtures and one body per channel. Every
 * function in it receives the validated input and returns JSX or a string; a compiler reads them
 * without running them, so nothing here executes at send time. Types are inferred from the
 * Standard JSON Schema input.
 */
export const defineTemplate = <S extends StandardJSONSchemaV1>(definition: {
  readonly id: string;
  readonly schema: S;
  readonly fixtures: Readonly<Record<string, NoInfer<StandardJSONSchemaV1.InferInput<S>>>>;
  readonly locale?: string | undefined;
  readonly email?: EmailChannel<NoInfer<StandardJSONSchemaV1.InferInput<S>>> | undefined;
  readonly sms?: ((input: NoInfer<StandardJSONSchemaV1.InferInput<S>>) => EmailNode) | undefined;
  readonly whatsapp?:
    | ((input: NoInfer<StandardJSONSchemaV1.InferInput<S>>) => EmailNode)
    | undefined;
}): SmlTemplate<StandardJSONSchemaV1.InferInput<S>> => {
  if (!TEMPLATE_ID_PATTERN.test(definition.id))
    throw new TypeError(
      `Template id ${JSON.stringify(definition.id)} is not lowercase kebab-case. The id is the handle a send names, so write lowercase letters and digits joined by single hyphens, for example "order-shipped".`,
    );
  const fixtureNames = Object.keys(definition.fixtures);
  if (fixtureNames.length === 0)
    throw new TypeError(
      `Template ${definition.id} declares no fixtures. Fixtures are the preview, the agent's render targets and the publish check; declare at least one.`,
    );
  for (const fixture of fixtureNames) checkTemplateName("Fixture key", fixture);
  return { ...definition, schema: inputSchema(definition.schema) };
};
// oxlint-enable samva/no-try-catch-or-throw, samva/no-error-constructor
