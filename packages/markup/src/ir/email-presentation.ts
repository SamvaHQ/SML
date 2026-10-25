// oxlint-disable samva/no-hand-rolled-object-guard -- This walks typed, compiler-owned email IR to save and restore presentation fields.
import type { CompiledElement, CompiledNode } from "../compiled-template";
import { isValueNode, type EmailPresentation, type EmailPresentationOverride } from "./nodes";

/** Visit only the deterministic email expansion, including both conditional branches once. */
export const mapEmailPresentation = (
  nodes: readonly CompiledNode[],
  edit: (node: CompiledNode, ordinal: number) => CompiledNode,
): CompiledNode[] => {
  let ordinal = 0;
  const walk = (list: readonly CompiledNode[]): CompiledNode[] =>
    list.map((node) => {
      if (isValueNode(node)) return node;
      if ("el" in node) {
        const edited = edit(node, ordinal++) as CompiledElement;
        return {
          ...edited,
          ...(node.children === undefined ? {} : { children: walk(node.children) }),
        };
      }
      if ("raw" in node) return edit(node, ordinal++);
      if ("each" in node) return { ...node, children: walk(node.children) };
      if ("if" in node)
        return {
          ...node,
          then: walk(node.then),
          ...(node.else === undefined ? {} : { else: walk(node.else) }),
        };
      return node;
    });
  return walk(nodes);
};

/** Save changed presentation fields, never tags, text children or a second body tree. */
export const emailPresentationOverrides = (
  before: CompiledNode,
  styled: CompiledNode,
): Readonly<Record<string, EmailPresentationOverride>> => {
  const originals: CompiledNode[] = [];
  mapEmailPresentation([before], (node) => {
    originals.push(node);
    return node;
  });
  const overrides: Record<string, EmailPresentationOverride> = {};
  mapEmailPresentation([styled], (node, ordinal) => {
    const original = originals[ordinal];
    if (
      typeof node !== "object" ||
      node === null ||
      typeof original !== "object" ||
      original === null
    )
      return node;
    if ("el" in node && "el" in original) {
      const attrs =
        JSON.stringify(node.attrs) === JSON.stringify(original.attrs) ? undefined : node.attrs;
      const style =
        JSON.stringify(node.style) === JSON.stringify(original.style)
          ? undefined
          : (node.style ?? "");
      if (attrs !== undefined || style !== undefined)
        overrides[ordinal] = {
          ...(attrs === undefined ? {} : { attrs }),
          ...(style === undefined ? {} : { style }),
        };
    } else if (
      "raw" in node &&
      "raw" in original &&
      JSON.stringify(node.raw) !== JSON.stringify(original.raw)
    )
      overrides[ordinal] = { raw: node.raw };
    return node;
  });
  return overrides;
};

/** Apply the resolved cascade and append head-only CSS after all ordinal-based overrides. */
export const applyEmailPresentation = (
  nodes: readonly CompiledNode[],
  presentation: EmailPresentation,
): CompiledNode[] => {
  const painted = mapEmailPresentation(nodes, (node, ordinal) => ({
    ...(node as CompiledElement),
    ...presentation.nodes[ordinal],
  }));
  if (presentation.headCss === "" && presentation.fontFaceCss === "") return painted;
  let done = false;
  const additions: CompiledNode[] = [
    ...(presentation.headCss === "" ? [] : [{ el: "style", children: [presentation.headCss] }]),
    ...(presentation.fontFaceCss === ""
      ? []
      : [
          { raw: ["<!--[if !mso]><!-->"] },
          { el: "style", children: [presentation.fontFaceCss] },
          { raw: ["<!--<![endif]-->"] },
        ]),
  ];
  const walk = (list: readonly CompiledNode[]): CompiledNode[] =>
    list.map((node) => {
      if (done || isValueNode(node)) return node;
      if ("el" in node) {
        if (node.el === "head") {
          done = true;
          return { ...node, children: [...(node.children ?? []), ...additions] };
        }
        return {
          ...node,
          ...(node.children === undefined ? {} : { children: walk(node.children) }),
        };
      }
      if ("each" in node) return { ...node, children: walk(node.children) };
      if ("if" in node)
        return {
          ...node,
          then: walk(node.then),
          ...(node.else === undefined ? {} : { else: walk(node.else) }),
        };
      return node;
    });
  return walk(painted);
};
