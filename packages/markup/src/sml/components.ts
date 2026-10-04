import { brandComponents, type EmailBrand } from "../email/brand";
import type { BrandPlugin } from "../email/brand-plugin";
import {
  Button,
  Column,
  Columns,
  Divider,
  Email,
  Image,
  Link,
  Section,
  Spacer,
} from "../email/components";
import { equalColumnWidth } from "../email/components";
import { drainEmailDiagnostics, type EmailChild } from "../email/jsx-runtime";
import { isObject } from "../internal/guards";
import type { IrEach, IrNode, IrValue } from "../ir";
import { child, children, text, unwrap, type Node } from "./ast";
import { bindingValue, isValueNode, type Binding } from "./bindings";
import type { Ctx, Lowerer } from "./lower";
import type { ImportBinding } from "./project";
import { emailNodeToIr, propFor, Tokens } from "./tokens";

/** Everything a component lowering needs about one tag in the source. */
export interface ComponentCall {
  readonly lowerer: Lowerer;
  readonly ctx: Ctx;
  readonly node: Node;
  readonly attributes: readonly Node[];
  /** The tag as written, `WhatsApp.Header` included. */
  readonly name: string;
  readonly binding: Extract<ImportBinding, { kind: "markup" | "brand" }>;
  readonly brand: EmailBrand | undefined;
  readonly brandPlugin: BrandPlugin;
  readonly channel: ChannelLowering | undefined;
}

/** Lowers the SMS and WhatsApp components; supplied when a channel body is being read. */
export type ChannelLowering = (call: ComponentCall) => IrNode[] | undefined;

const NUMERIC: Readonly<Record<string, readonly string[]>> = {
  Button: ["height", "paddingX", "borderRadius", "borderWidth", "fontSize", "width"],
  Spacer: ["height"],
  Divider: ["thickness"],
  BrandLogo: ["width"],
};

const COMPONENTS: Readonly<Record<string, (props: never) => unknown>> = {
  Email,
  Section,
  Columns,
  Column,
  Button,
  Spacer,
  Divider,
  Image,
  Link,
};

const bindingToProp = (
  call: ComponentCall,
  tokens: Tokens,
  name: string,
  binding: Binding,
): unknown => {
  switch (binding.k) {
    case "object": {
      const output: Record<string, unknown> = {};
      for (const [key, field] of binding.fields)
        output[key] = bindingToProp(call, tokens, key, field);
      return output;
    }
    case "nodes":
      call.lowerer.error(
        call.ctx,
        call.node,
        "dynamic-expression",
        `<${call.name} ${name}> takes text, not markup.`,
      );
      return undefined;
    default: {
      const value = bindingValue(binding);
      if (value === undefined) {
        call.lowerer.error(
          call.ctx,
          call.node,
          "dynamic-expression",
          `<${call.name} ${name}> cannot be the input as a whole.`,
          "Bind one field.",
        );
        return undefined;
      }
      return propFor(tokens, value);
    }
  }
};

/** Content between the tags, the way a primitive would have received it. */
const childrenProp = (tokens: Tokens, nodes: readonly IrNode[]): EmailChild => {
  const only = nodes.length === 1 ? nodes[0] : undefined;
  // A single text child arrives as a string, exactly as React hands it to a component.
  if (only !== undefined && isValueNode(only) && only !== null && typeof only !== "boolean") {
    return typeof only === "string" ? only : tokens.value(only);
  }
  return nodes.map((node) =>
    isValueNode(node)
      ? typeof node === "string"
        ? node
        : tokens.value(node)
      : tokens.nodes([node]),
  );
};

/** The width each cell of a `<Columns each>` row takes when it states none. */
const equalWidth = (per: number | undefined, list: IrValue): IrValue => {
  if (per !== undefined) return equalColumnWidth(per);
  // floor(100 / n) is (100 - 100 % n) / n, exact for whole n, so the renderer needs no floor.
  const count: IrValue = { length: list };
  return {
    concat: [
      { op: "/", args: [{ op: "-", args: [100, { op: "%", args: [100, count] }] }, count] },
      "%",
    ],
  };
};

/**
 * `<Columns each={list} per={n}>{(item, i) => <Column … />}</Columns>`: one row per chunk of `n`
 * items (all in one row without `per`), each cell from the callback. Returns the nodes to place
 * inside the Columns table, and a wrapper that repeats that table per chunk.
 */
const columnsEach = (
  call: ComponentCall,
  bindings: ReadonlyMap<string, Binding>,
): { readonly cells: IrNode; readonly wrap: (table: IrNode[]) => IrNode[] } | undefined => {
  const { lowerer, ctx, node } = call;
  const listValue = bindings.get("each");
  const list = listValue === undefined ? undefined : bindingValue(listValue);
  if (list === undefined) {
    lowerer.error(
      ctx,
      node,
      "invalid-columns-each",
      "<Columns each> takes a list from the input.",
      "Write each={input.items}.",
    );
    return undefined;
  }
  const perBinding = bindings.get("per");
  const perValue = perBinding?.k === "value" ? perBinding.value : undefined;
  if (
    perBinding !== undefined &&
    !(typeof perValue === "number" && Number.isInteger(perValue) && perValue >= 1)
  ) {
    lowerer.error(
      ctx,
      node,
      "invalid-columns-per",
      "<Columns per> is a whole number of cells, one or more.",
      "Write per={2}.",
    );
    return undefined;
  }
  const per = typeof perValue === "number" ? perValue : undefined;
  const contents = children(node, "children").filter(
    (item) => !(item.type === "JSXText" && (text(item, "value") ?? "").trim() === ""),
  );
  const container = contents.length === 1 ? contents[0] : undefined;
  const expression =
    container?.type === "JSXExpressionContainer" ? child(container, "expression") : undefined;
  const fn = expression === undefined ? undefined : unwrap(expression);
  if (fn === undefined || !/Function/.test(fn.type)) {
    lowerer.error(
      ctx,
      node,
      "invalid-columns-each",
      "<Columns each> takes a function of one item as its only child.",
      "Write {(item) => <Column>…</Column>}.",
    );
    return undefined;
  }
  const row = per === undefined ? undefined : lowerer.freshName(ctx, "row");
  const cellCtx = {
    ...ctx,
    loops: row === undefined ? ctx.loops : [...ctx.loops, row],
    columnWidth: equalWidth(per, list),
  };
  const cells = lowerer.eachOver(cellCtx, node, row === undefined ? list : { bind: `$${row}` }, fn);
  if (cells === undefined) return undefined;
  return {
    cells,
    wrap: (table) => {
      if (row === undefined || per === undefined) return table;
      const chunked: IrEach = {
        each: list,
        as: row,
        chunk: per,
        children: table,
        src: lowerer.src(ctx.module, node),
      };
      return [chunked];
    },
  };
};

/** Run a compiler primitive at compile time and lower what it returns. */
export const runBuiltinComponent = (call: ComponentCall): IrNode[] => {
  const { lowerer, ctx, node, binding } = call;
  const specifier = binding.specifier;
  if (
    binding.kind === "markup" &&
    (specifier === "@samva/markup/sms" || specifier === "@samva/markup/whatsapp")
  ) {
    const lowered = call.channel?.(call);
    if (lowered !== undefined) return lowered;
    lowerer.error(
      ctx,
      node,
      "wrong-channel",
      `<${call.name}> belongs in the ${specifier.split("/").pop()} body of a template.`,
      "Write it in the `sms` or `whatsapp` function of defineTemplate.",
    );
    return [];
  }
  const exported = binding.imported;
  const isEmail = binding.kind === "markup" && specifier === "@samva/markup/email";
  const isBrand = binding.kind === "brand";
  if (!(isEmail || isBrand)) {
    lowerer.error(
      ctx,
      node,
      "unknown-component",
      `<${call.name}> is not a component the profile can read.`,
      `Import components from @samva/markup/email, ${call.brandPlugin.specifier}, or the project.`,
    );
    return [];
  }
  let fn: ((props: never) => unknown) | undefined;
  if (isEmail) fn = COMPONENTS[exported];
  else {
    if (call.brand === undefined) {
      lowerer.error(
        ctx,
        node,
        "brand-unavailable",
        `<${call.name}> comes from ${binding.specifier}, and this build has no brand to resolve it.`,
        "Compile with a brand, or remove the brand components.",
      );
      return [];
    }
    const brand = brandComponents(call.brand, call.brandPlugin);
    fn =
      exported === "BrandLogo"
        ? brand.BrandLogo
        : exported === "BrandFooter"
          ? brand.BrandFooter
          : undefined;
  }
  if (fn === undefined || (!Object.hasOwn(COMPONENTS, exported) && isEmail)) {
    lowerer.error(
      ctx,
      node,
      "unknown-component",
      `\`${exported}\` is not an email component.`,
      `Use one of ${Object.keys(COMPONENTS).join(", ")}, BrandLogo or BrandFooter.`,
    );
    return [];
  }
  const declared = lowerer.attributeBindings(ctx, call.attributes);
  if (declared === undefined) return [];
  let bindings: ReadonlyMap<string, Binding> = declared;
  let wrap = (table: IrNode[]): IrNode[] => table;
  let kids: IrNode[];
  const childCtx = { ...ctx, columnWidth: undefined };
  if (exported === "Columns" && declared.has("each")) {
    const chunked = columnsEach(call, declared);
    if (chunked === undefined) return [];
    bindings = new Map([...declared].filter(([name]) => name !== "each" && name !== "per"));
    kids = [chunked.cells];
    wrap = chunked.wrap;
  } else kids = lowerer.jsxChildren(childCtx, node);
  const tokens = new Tokens();
  const props: Record<string, unknown> = {};
  for (const [name, bound] of bindings) props[name] = bindingToProp(call, tokens, name, bound);
  for (const name of NUMERIC[exported] ?? []) {
    const value = props[name];
    if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value) && value !== undefined) {
      lowerer.error(
        ctx,
        node,
        "dynamic-numeric-prop",
        `<${call.name} ${name}> sizes the layout at compile time, so it must be a number literal.`,
        `Write ${name}={44}.`,
      );
      return [];
    }
  }
  if (exported === "Column" && props.width === undefined && ctx.columnWidth !== undefined)
    props.width = propFor(tokens, ctx.columnWidth);
  if (kids.length > 0) props.children = childrenProp(tokens, kids);
  if (
    exported === "Button" &&
    typeof props.children === "string" &&
    props.children !== "" &&
    props.width === undefined &&
    props.height !== undefined &&
    tokens.toValue(props.children) !== props.children
  ) {
    lowerer.error(
      ctx,
      node,
      "button-dynamic-label",
      "Classic Outlook draws the button from a fixed box, and a label read at render time cannot size it.",
      "Give the button a width: <Button width={200} …>.",
    );
    return [];
  }
  drainEmailDiagnostics();
  const output = (fn as (props: Record<string, unknown>) => unknown)(props);
  const location = lowerer.findings.locate(ctx.module.parsed, node);
  for (const diagnostic of drainEmailDiagnostics())
    lowerer.findings.items.push({ ...diagnostic, origins: [location] });
  if (output !== null && (!isObject(output) || typeof output.type !== "string")) return [];
  return wrap([
    ...emailNodeToIr(
      output as Parameters<typeof emailNodeToIr>[0],
      tokens,
      lowerer.src(ctx.module, node),
    ),
  ]);
};
