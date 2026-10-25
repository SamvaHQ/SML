/* oxlint-disable samva/no-hand-rolled-object-guard, samva/no-unsafe-type-assertion -- Target lowering discriminates JSON IR; renderEmail validates and bounds it before entering here. */
import type { CompiledNode, CompiledValue } from "../compiled-template";
import { brandComponents } from "../email/brand";
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
  equalColumnWidth,
} from "../email/components";
import {
  collectEmailDiagnostics,
  type EmailChild,
  type EmailNode,
  type EmailFinding,
} from "../email/jsx-runtime";
import { PRIMITIVE_CLASSES } from "../email/primitive-css";
import { samvaBrandPlugin } from "../email/samva-brand-plugin";
import { isValueNode, type SemanticComponent, type SemanticProp } from "../ir/nodes";
import { emailNodeToIr, propFor, Tokens } from "../ir/tokens";

const COMPONENTS = { Email, Section, Columns, Column, Button, Spacer, Divider, Image, Link };

const prop = (tokens: Tokens, value: SemanticProp): unknown => {
  if (typeof value === "object" && value !== null && "object" in value)
    return Object.fromEntries(
      Object.entries(value.object).map(([key, field]) => [key, prop(tokens, field)]),
    );
  return propFor(tokens, value);
};

/** Pass tokens through the real primitives, preserving their string-child/VML behavior. */
const childrenProp = (tokens: Tokens, nodes: readonly CompiledNode[]): EmailChild => {
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (only !== undefined && isValueNode(only) && only !== null && typeof only !== "boolean")
    return typeof only === "string" ? only : tokens.value(only);
  return nodes.map((node) =>
    isValueNode(node)
      ? typeof node === "string"
        ? node
        : tokens.value(node)
      : tokens.nodes([node]),
  );
};

interface ColumnContext {
  readonly width?: CompiledValue | undefined;
  readonly stack?: boolean | undefined;
}

const columnWidth = (component: SemanticComponent): CompiledValue | undefined => {
  const list = component.props?.each;
  if (list === undefined) return undefined;
  const per = component.props?.per;
  if (typeof per === "number") return equalColumnWidth(per);
  const count: CompiledValue = { length: list as CompiledValue };
  return {
    concat: [
      { op: "/", args: [{ op: "-", args: [100, { op: "%", args: [100, count] }] }, count] },
      "%",
    ],
  };
};

/**
 * Expand one semantic document through the existing email primitives. Input expressions remain
 * expressions: expansion does not evaluate input, call the compiler or resolve any stylesheet.
 * Both compiler CSS preparation and send-time rendering use this exact lowering.
 */
export const lowerEmailNodes = (
  nodes: readonly CompiledNode[],
  brandPlugin: BrandPlugin = samvaBrandPlugin,
  report?: (diagnostic: EmailFinding) => void,
): CompiledNode[] => {
  const walk = (list: readonly CompiledNode[], context: ColumnContext): CompiledNode[] =>
    list.flatMap((node): CompiledNode[] => {
      if (isValueNode(node)) return [node];
      if ("type" in node) {
        if (node.type !== "component") {
          const { type: _type, tag, children, ...rest } = node;
          void _type;
          return [
            {
              el: tag,
              ...rest,
              ...(children === undefined ? {} : { children: walk(children, context) }),
            },
          ];
        }
        const childContext: ColumnContext =
          node.name === "Columns"
            ? {
                width: columnWidth(node),
                stack: node.props?.stack === undefined || node.props.stack === true,
              }
            : {};
        const kids = walk(node.children ?? [], childContext);
        const tokens = new Tokens();
        const props: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(node.props ?? {})) {
          if (
            node.name === "Columns" &&
            (name === "each" ||
              name === "per" ||
              (name === "stack" && node.props?.each !== undefined))
          )
            continue;
          props[name] = prop(tokens, value);
        }
        if (node.name === "Column") {
          if (props.width === undefined && context.width !== undefined)
            props.width = propFor(tokens, context.width);
          if (context.stack === true)
            props.className =
              typeof props.className === "string" && props.className !== ""
                ? `${PRIMITIVE_CLASSES.stack} ${props.className}`
                : PRIMITIVE_CLASSES.stack;
        }
        if (kids.length > 0) props.children = childrenProp(tokens, kids);
        if (
          node.name === "Button" &&
          typeof props.children === "string" &&
          props.children !== "" &&
          props.width === undefined &&
          props.height !== undefined &&
          tokens.toValue(props.children) !== props.children
        )
          report?.({
            code: "button-dynamic-label",
            severity: "error",
            message:
              "A button with a dynamic label requires an explicit width for its Outlook fallback.",
          });
        const fn =
          node.name === "BrandLogo" || node.name === "BrandFooter"
            ? brandComponents({ ...node.brand!, css: "" }, brandPlugin)[node.name]
            : COMPONENTS[node.name];
        const output = (fn as (props: Record<string, unknown>) => EmailNode | null)(props);
        if (output !== null)
          for (const diagnostic of collectEmailDiagnostics(output)) report?.(diagnostic);
        return [...emailNodeToIr(output, tokens, node.src)];
      }
      if ("el" in node)
        return [
          {
            ...node,
            ...(node.children === undefined ? {} : { children: walk(node.children, context) }),
          },
        ];
      if ("each" in node) return [{ ...node, children: walk(node.children, context) }];
      if ("if" in node)
        return [
          {
            ...node,
            then: walk(node.then, context),
            ...(node.else === undefined ? {} : { else: walk(node.else, context) }),
          },
        ];
      return [node];
    });
  return walk(nodes, {});
};
