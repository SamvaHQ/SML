// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type { IrNode, IrValue } from "./ir";

// Meta registers a template with positional placeholders (`{{1}}`) and a send supplies one
// parameter per placeholder. This derives both from the IR of a text part.

export interface WhatsAppTemplateText {
  /** The registration text: literal pieces with `{{n}}` where a value is read at send time. */
  readonly template: string;
  /** The value behind each placeholder; `params[n - 1]` is `{{n}}`. */
  readonly params: readonly IrValue[];
}

const isConcat = (value: IrValue): value is { readonly concat: readonly IrValue[] } =>
  typeof value === "object" && value !== null && "concat" in value;

/**
 * Number the non-literal values of a header, body or footer in order of first appearance. A value
 * that appears twice (by JSON identity) shares its placeholder. Text pieces stay literal.
 */
export const whatsappTemplate = (part: readonly IrNode[]): WhatsAppTemplateText => {
  const params: IrValue[] = [];
  const keys: string[] = [];
  let template = "";
  const visit = (node: IrNode): void => {
    if (node === null || typeof node === "boolean") return;
    if (typeof node === "string") {
      template += node;
      return;
    }
    if (typeof node === "number") {
      template += String(node);
      return;
    }
    if (typeof node === "object" && isConcat(node as IrValue)) {
      for (const inner of (node as { readonly concat: readonly IrValue[] }).concat) visit(inner);
      return;
    }
    if (typeof node === "object" && ("el" in node || "each" in node || "raw" in node)) {
      // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- The compiler refuses structure in a text part before this runs; reaching it is a caller bug.
      throw new TypeError("A WhatsApp text part holds text and values only.");
    }
    if (
      typeof node === "object" &&
      "if" in node &&
      Array.isArray((node as { then?: unknown }).then)
    ) {
      // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Same contract as above.
      throw new TypeError("A WhatsApp text part cannot branch.");
    }
    const value = node as IrValue;
    const key = JSON.stringify(value);
    let index = keys.indexOf(key);
    if (index < 0) {
      index = keys.length;
      keys.push(key);
      params.push(value);
    }
    template += `{{${index + 1}}}`;
  };
  for (const node of part) visit(node);
  return { template, params };
};
