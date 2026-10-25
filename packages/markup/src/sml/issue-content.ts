import type { CompiledNode } from "../compiled-template";
import type { EmailBrand } from "../email/brand";
import { isValueNode } from "../ir/nodes";

/** Static content inserted by the compiler at the layout's IssueContent directive. */
export interface IssueContentInput {
  readonly file: string;
  readonly nodes: readonly CompiledNode[];
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
