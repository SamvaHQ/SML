// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import { child, children, text, unwrap, type Node } from "./ast";
import type { Project, ProjectModule } from "./project";

// Fixtures, the input schema and a few definition fields are data: object literals, arrays and
// scalars, possibly assembled from constants. They are read here without evaluating anything. A
// constant may be spread or referenced from the same file or from another project file, and an
// imported asset resolves to its content-addressed URL.

export type StaticRead =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly node: Node;
      readonly module: ProjectModule;
      readonly reason: string;
    };

export interface StaticContext {
  readonly project: Project;
  /** The URL a project asset is served from. */
  readonly assetUrl: (path: string) => string | undefined;
}

const fail = (module: ProjectModule, node: Node, reason: string): StaticRead => ({
  ok: false,
  node,
  module,
  reason,
});

const keyOf = (property: Node): string | undefined => {
  if (property.type === "ObjectProperty" && property.computed !== true) {
    const key = child(property, "key");
    if (key === undefined) return undefined;
    if (key.type === "Identifier") return text(key, "name");
    if (key.type === "StringLiteral") return text(key, "value");
    if (key.type === "NumericLiteral") return String(key.value);
  }
  return undefined;
};

/** Resolve a top-level constant name in a module, following project imports and re-exports. */
const resolveName = (
  context: StaticContext,
  module: ProjectModule,
  name: string,
  seen: Set<string> = new Set(),
):
  | { readonly module: ProjectModule; readonly value: Node }
  | { readonly asset: string }
  | undefined => {
  const key = `${module.path}\0${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const declared = module.declarations.get(name);
  if (declared !== undefined) return { module, value: declared.value };
  const imported = module.imports.get(name);
  if (imported === undefined) return undefined;
  if (imported.kind === "asset") return { asset: imported.path };
  if (imported.kind !== "project") return undefined;
  const target = context.project.modules.get(imported.path);
  if (target === undefined) return undefined;
  if (imported.imported === "default") {
    const value = target.defaultExport;
    return value === undefined ? undefined : { module: target, value };
  }
  const local = target.exports.get(imported.imported);
  return local === undefined ? undefined : resolveName(context, target, local, seen);
};

/** Read a node as plain JSON-like data. */
export const readStatic = (
  context: StaticContext,
  module: ProjectModule,
  node: Node,
  seen: Set<string> = new Set(),
): StaticRead => {
  const current = unwrap(node);
  switch (current.type) {
    case "StringLiteral":
      return { ok: true, value: current.value };
    case "NumericLiteral":
      return { ok: true, value: current.value };
    case "BooleanLiteral":
      return { ok: true, value: current.value };
    case "NullLiteral":
      return { ok: true, value: null };
    case "TemplateLiteral": {
      if (children(current, "expressions").length > 0)
        return fail(module, current, "a template string with a `${}` part is computed at run time");
      const quasi = children(current, "quasis")[0];
      const value = quasi?.value as { cooked?: unknown; raw?: unknown } | undefined;
      const cooked = value?.cooked ?? value?.raw;
      return { ok: true, value: typeof cooked === "string" ? cooked : "" };
    }
    case "UnaryExpression": {
      const argument = child(current, "argument");
      if (
        text(current, "operator") === "-" &&
        argument !== undefined &&
        argument.type === "NumericLiteral" &&
        typeof argument.value === "number"
      )
        return { ok: true, value: -argument.value };
      return fail(module, current, "only a negative number literal is data");
    }
    case "Identifier": {
      const name = text(current, "name") ?? "";
      if (name === "undefined") return { ok: true, value: undefined };
      const resolved = resolveName(context, module, name);
      if (resolved === undefined)
        return fail(module, current, `\`${name}\` is not a constant in the project`);
      if ("asset" in resolved) {
        const url = context.assetUrl(resolved.asset);
        return url === undefined
          ? fail(module, current, `\`${name}\` names an asset the build did not address`)
          : { ok: true, value: url };
      }
      const key = `${resolved.module.path}\0${name}\0${resolved.value.start}`;
      if (seen.has(key)) return fail(module, current, `\`${name}\` refers to itself`);
      seen.add(key);
      const read = readStatic(context, resolved.module, resolved.value, seen);
      seen.delete(key);
      return read;
    }
    case "ArrayExpression": {
      const output: unknown[] = [];
      for (const element of Array.isArray(current.elements) ? current.elements : []) {
        if (element === null || typeof element !== "object")
          return fail(module, current, "an array hole");
        const item = element as Node;
        if (item.type === "SpreadElement") {
          const argument = child(item, "argument");
          if (argument === undefined) return fail(module, item, "an empty spread");
          const spread = readStatic(context, module, argument, seen);
          if (!spread.ok) return spread;
          if (!Array.isArray(spread.value)) return fail(module, item, "a spread of a non-array");
          output.push(...spread.value);
          continue;
        }
        const value = readStatic(context, module, item, seen);
        if (!value.ok) return value;
        output.push(value.value);
      }
      return { ok: true, value: output };
    }
    case "ObjectExpression": {
      const output: Record<string, unknown> = {};
      for (const property of children(current, "properties")) {
        if (property.type === "SpreadElement") {
          const argument = child(property, "argument");
          if (argument === undefined) return fail(module, property, "an empty spread");
          const spread = readStatic(context, module, argument, seen);
          if (!spread.ok) return spread;
          if (
            typeof spread.value !== "object" ||
            spread.value === null ||
            Array.isArray(spread.value)
          )
            return fail(module, property, "a spread of a non-object");
          Object.assign(output, spread.value);
          continue;
        }
        const key = keyOf(property);
        if (key === undefined) return fail(module, property, "a computed or method property");
        const valueNode = child(property, "value");
        if (valueNode === undefined) return fail(module, property, "a property without a value");
        const value = readStatic(context, module, valueNode, seen);
        if (!value.ok) return value;
        if (value.value !== undefined) output[key] = value.value;
      }
      return { ok: true, value: output };
    }
    case "CallExpression": {
      // `jsonSchema<T>({ ... })` declares its input type and returns the literal it was given.
      const callee = child(current, "callee");
      const first = children(current, "arguments")[0];
      if (
        callee?.type === "Identifier" &&
        text(callee, "name") === "jsonSchema" &&
        first !== undefined
      )
        return readStatic(context, module, first, seen);
      return fail(module, current, "a call is computed at run time");
    }
    default:
      return fail(module, current, `${current.type} is not data`);
  }
};

export { keyOf as propertyKey };
