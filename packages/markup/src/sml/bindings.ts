// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type { CompiledNode, CompiledValue } from "../compiled-template";

// What a name means while a body is being lowered. Nothing here is a runtime value: a `path`
// names a place in the input, and lowering only ever builds IR that reads it at render time.

export type Binding =
  /** A place in the input, `""` for the input itself, `"$item.title"` inside a loop. */
  | { readonly k: "path"; readonly path: string }
  /** A value the compiler already resolved: a literal, a formatted string, a conditional. */
  | { readonly k: "value"; readonly value: CompiledValue }
  /** A literal object passed as a partial's prop. */
  | { readonly k: "object"; readonly fields: ReadonlyMap<string, Binding> }
  /** The content passed between a partial's tags. */
  | { readonly k: "nodes"; readonly nodes: readonly CompiledNode[] };

export type Env = ReadonlyMap<string, Binding>;

export const joinPath = (base: string, segment: string): string =>
  base === "" ? segment : `${base}.${segment}`;

/** The IR value a binding reads, or `undefined` for bindings that are not values. */
export const bindingValue = (binding: Binding): CompiledValue | undefined => {
  switch (binding.k) {
    case "path":
      return binding.path === "" ? undefined : { bind: binding.path };
    case "value":
      return binding.value;
    default:
      return undefined;
  }
};

export { isStaticScalar, isValueNode } from "../ir/nodes";
