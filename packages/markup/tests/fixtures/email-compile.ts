import type { EmailDiagnostic } from "../../src/email/diagnostics";
import { EmailCompileError } from "../../src/email/diagnostics";
import type { EmailNode } from "../../src/email/jsx-runtime";
import { compileEmail } from "../../src/email/render";
import { inputSchema, jsonSchema } from "../../src/input-schema";
import type { EmailContent } from "../../src/template";
import type { TemplateDefinition } from "../support/email-fixture";

/**
 * Corpus templates are built from the channel-neutral definition shape so the
 * corpus states its own input schema instead of depending on one authoring
 * helper's name.
 */
export const corpusTemplate = <Input>(
  schema: Record<string, unknown>,
  render: (input: Input) => EmailContent,
  id = "corpus",
): TemplateDefinition<Input> => ({
  id,
  schema: inputSchema(jsonSchema<Input>(schema)),
  fixtures: {},
  render,
});

/** Every finding a compile produces, whether or not it blocked. */
export const diagnose = (node: EmailNode): readonly EmailDiagnostic[] => {
  try {
    return compileEmail(node).diagnostics;
  } catch (cause) {
    if (cause instanceof EmailCompileError) return cause.diagnostics;
    throw cause;
  }
};

/** The codes a compile reported, in order. */
export const diagnosticCodes = (node: EmailNode): readonly string[] =>
  diagnose(node).map((diagnostic) => diagnostic.code);
