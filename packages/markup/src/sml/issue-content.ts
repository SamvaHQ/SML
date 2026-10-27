import type { CompiledNode } from "../compiled-template";
import type { EmailBrand } from "../email/brand";
import { callFormatter, createFmt } from "../fmt";
import { isValueNode } from "../ir/nodes";
import type { IssueFrontmatter } from "../markdown/types";
import { child, text, type Node } from "./ast";
import type { Ctx, Lowerer } from "./lower";

/** Static content inserted by the compiler at the layout's IssueContent directive. */
export interface IssueContentInput {
  readonly file: string;
  readonly nodes: readonly CompiledNode[];
  readonly frontmatter?: IssueFrontmatter;
}

/** Copy parser nodes into the layout's source table and resolve its host-owned brand. */
export const issueNodes = (
  nodes: readonly CompiledNode[],
  sourceIndex: number,
  brand: EmailBrand | undefined,
): CompiledNode[] =>
  nodes.map((node): CompiledNode => {
    if (isValueNode(node) || !("type" in node)) return node;
    const kids =
      node.children === undefined
        ? {}
        : { children: issueNodes(node.children, sourceIndex, brand) };
    const src =
      node.src === undefined ? {} : { src: [node.src[0], node.src[1], sourceIndex] as const };
    if (
      node.type === "component" &&
      (node.name === "BrandLogo" || node.name === "BrandFooter") &&
      brand !== undefined
    ) {
      const { css: _css, ...resolved } = brand;
      void _css;
      return { ...node, ...kids, ...src, brand: resolved };
    }
    return { ...node, ...kids, ...src };
  });

/** Literal classes on parsed issue nodes join Tailwind's candidate set before the cascade. */
export const issueClasses = (nodes: readonly CompiledNode[]): readonly string[] =>
  nodes.flatMap((node) => {
    if (isValueNode(node) || !("type" in node)) return [];
    const value =
      node.type === "component"
        ? node.props?.className
        : (node.attrs?.className ?? node.attrs?.class);
    return [
      ...(typeof value === "string" ? value.split(/\s+/).filter(Boolean) : []),
      ...issueClasses(node.children ?? []),
    ];
  });

/** Internal marker: authored intrinsic tags cannot use this compiler-owned name. */
export const ISSUE_SLOT_TAG = "sml-issue-content";
const ISSUE_TITLE_TAG = "sml-issue-title";
const ISSUE_DATE_TAG = "sml-issue-date";

/** Retain metadata markers until partial expansion has made their placement visible. */
export const issueMetadataSlot = (
  lowerer: Lowerer,
  ctx: Ctx,
  node: Node,
  attributes: readonly Node[],
  name: "IssueTitle" | "IssueDate",
  frontmatter: IssueFrontmatter,
): CompiledNode[] => {
  const props = new Map<string, string>();
  for (const attribute of attributes) {
    const key = text(child(attribute, "name") ?? attribute, "name");
    const valueNode = child(attribute, "value");
    const literal =
      valueNode?.type === "JSXExpressionContainer" ? child(valueNode, "expression") : valueNode;
    const value = literal?.type === "StringLiteral" ? text(literal, "value") : undefined;
    if (
      name !== "IssueDate" ||
      (key !== "style" && key !== "locale") ||
      value === undefined ||
      props.has(key)
    ) {
      lowerer.error(
        ctx,
        attribute,
        "issue-slot",
        `${name} accepts only its documented literal props.`,
      );
      return [];
    }
    props.set(key, value);
  }
  let value = frontmatter.title;
  if (name === "IssueDate") {
    // Validate formatting props even when this particular issue has no date.
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- Intl and fmt reject invalid literal options; surface those failures as positioned compiler diagnostics.
    try {
      value = callFormatter(createFmt(), "date", [
        frontmatter.date ?? "1970-01-01",
        props.get("style"),
        props.get("locale"),
      ]);
    } catch (error) {
      lowerer.error(
        ctx,
        node,
        "issue-slot",
        error instanceof Error ? error.message : "Invalid IssueDate formatting options.",
      );
      return [];
    }
  }
  return [
    {
      type: "inline",
      tag: name === "IssueTitle" ? ISSUE_TITLE_TAG : ISSUE_DATE_TAG,
      children: name === "IssueDate" && frontmatter.date === undefined ? [] : [value],
      src: lowerer.src(ctx.module, node),
    },
  ];
};

/** Resolve the final expanded layout, where partials have already used or discarded children. */
export const replaceIssueSlots = (
  nodes: readonly CompiledNode[],
  content: readonly CompiledNode[],
  report: (source: import("../compiled-template").CompiledSource | undefined) => void,
): { readonly nodes: CompiledNode[]; readonly count: number } => {
  let count = 0;
  const walk = (items: readonly CompiledNode[], conditional: boolean): CompiledNode[] =>
    items.flatMap((node): CompiledNode[] => {
      if (isValueNode(node)) return [node];
      if (
        "type" in node &&
        node.type !== "component" &&
        (node.tag === ISSUE_SLOT_TAG || node.tag === ISSUE_TITLE_TAG || node.tag === ISSUE_DATE_TAG)
      ) {
        if (node.tag === ISSUE_SLOT_TAG) count++;
        if (conditional) report(node.src);
        return node.tag === ISSUE_SLOT_TAG ? [...content] : [...(node.children ?? [])];
      }
      if ("if" in node)
        return [
          {
            ...node,
            then: walk(node.then, true),
            ...(node.else === undefined ? {} : { else: walk(node.else, true) }),
          },
        ];
      if ("each" in node) return [{ ...node, children: walk(node.children, true) }];
      return [
        {
          ...node,
          ...("children" in node && node.children !== undefined
            ? { children: walk(node.children, conditional) }
            : {}),
        },
      ];
    });
  const expanded = walk(nodes, false);
  return { nodes: expanded, count };
};
