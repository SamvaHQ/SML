// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type { IrNode, IrValue } from "../ir";

// What a name means while a body is being lowered. Nothing here is a runtime value: a `path`
// names a place in the input, and lowering only ever builds IR that reads it at render time.

export type Binding =
  /** A place in the input, `""` for the input itself, `"$item.title"` inside a loop. */
  | { readonly k: "path"; readonly path: string }
  /** A value the compiler already resolved: a literal, a formatted string, a conditional. */
  | { readonly k: "value"; readonly value: IrValue }
  /** A literal object passed as a partial's prop. */
  | { readonly k: "object"; readonly fields: ReadonlyMap<string, Binding> }
  /** The content passed between a partial's tags. */
  | { readonly k: "nodes"; readonly nodes: readonly IrNode[] };

export type Env = ReadonlyMap<string, Binding>;

export const joinPath = (base: string, segment: string): string =>
  base === "" ? segment : `${base}.${segment}`;

/** The IR value a binding reads, or `undefined` for bindings that are not values. */
export const bindingValue = (binding: Binding): IrValue | undefined => {
  switch (binding.k) {
    case "path":
      return binding.path === "" ? undefined : { bind: binding.path };
    case "value":
      return binding.value;
    default:
      return undefined;
  }
};

export const isStaticScalar = (value: IrValue): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** True when a node in child position is a value (rendered as text) rather than structure. */
export const isValueNode = (node: IrNode): node is IrValue => {
  if (typeof node !== "object" || node === null) return true;
  if ("el" in node || "each" in node || "raw" in node || "preheader" in node) return false;
  if ("if" in node && Array.isArray((node as { then?: unknown }).then)) return false;
  return true;
};
