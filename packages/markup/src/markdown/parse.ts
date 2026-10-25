import type { Definition, Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxExpressionFromMarkdown } from "mdast-util-mdx-expression";
import { mdxJsxFromMarkdown } from "mdast-util-mdx-jsx";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxJsx } from "micromark-extension-mdx-jsx";

import contract from "../../generated/contract.json";
import type { CompiledNode, CompiledSource, CompiledValue } from "../compiled-template";
import { buildLineMap, lineColumn } from "../diagnostic-model";
import type { EmailDiagnostic } from "../email/diagnostics";
import { checkAttribute, serializeStyle } from "../email/html";
import { hasProperty } from "../internal/guards";
import { COMPONENT_DEGRADATIONS } from "../ir/degradations";
import { isValueNode, type SemanticComponentName } from "../ir/nodes";
import { lowerEmailNodes } from "../lower/email";
import { readFrontmatter } from "./frontmatter";
import type { MarkdownSourceNode, MarkdownSourceProperty, ParseIssueResult } from "./types";

type JsxNode = Extract<Nodes, { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }>;
type ComponentSpec = (typeof contract.components)[number];

const componentName = (name: string): name is SemanticComponentName =>
  Object.hasOwn(COMPONENT_DEGRADATIONS, name);

/** Parse a static issue without importing, evaluating or passing through authored HTML. */
export const parseIssue = (source: string, file: string): ParseIssueResult => {
  const diagnostics: EmailDiagnostic[] = [];
  const sourceNodes: MarkdownSourceNode[] = [];
  const lines = buildLineMap(source);
  const location = (offset: number) => {
    const at = lineColumn(lines, offset);
    return { fileName: file, lineNumber: at.line, columnNumber: at.column };
  };
  const report = (code: string, message: string, offset: number): void => {
    diagnostics.push({ code, message, severity: "error", origins: [location(offset)] });
  };
  const { markdown, frontmatter } = readFrontmatter(source, (message, offset) =>
    report("markdown-frontmatter", message, offset),
  );
  const result = (nodes: readonly CompiledNode[]): ParseIssueResult => ({
    nodes: diagnostics.some((item) => item.severity === "error") ? [] : nodes,
    frontmatter,
    diagnostics,
    sources: [file],
    sourceNodes,
  });
  let tree: Root;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- The MDX tokenizer throws syntax errors; this boundary returns located diagnostics instead.
  try {
    tree = fromMarkdown(markdown, {
      extensions: [{ disable: { null: ["htmlFlow", "htmlText"] } }, mdxJsx(), mdxExpression()],
      mdastExtensions: [mdxJsxFromMarkdown(), mdxExpressionFromMarkdown()],
    });
  } catch (cause) {
    const line = hasProperty(cause, "line") && typeof cause.line === "number" ? cause.line : 1;
    const column =
      hasProperty(cause, "column") && typeof cause.column === "number" ? cause.column : 1;
    const offset = (lines[line - 1] ?? 0) + column - 1;
    const html = /<!--|<![A-Z]|<\?/.exec(markdown);
    report(
      html === null ? "markdown-syntax" : "markdown-html",
      html === null
        ? `Invalid static Markdown: ${String(cause)}`
        : "Raw HTML, comments and processing instructions are not supported; use Markdown or SML components.",
      html?.index ?? offset,
    );
    return result([]);
  }
  const start = (node: Nodes): number => node.position?.start.offset ?? 0;
  const end = (node: Nodes): number => node.position?.end.offset ?? start(node);
  const src = (node: Nodes): CompiledSource => {
    const at = lineColumn(lines, start(node));
    return [at.line, at.column, 0];
  };
  const record = (
    node: Nodes,
    kind: MarkdownSourceNode["kind"],
    tag: string,
    properties: readonly MarkdownSourceProperty[] = [],
    content?: readonly [number, number],
  ): void => {
    const children = "children" in node ? node.children : [];
    const text =
      node.type === "text"
        ? node
        : children.length === 1 && children[0]?.type === "text"
          ? children[0]
          : undefined;
    const textProperties: MarkdownSourceProperty[] =
      text === undefined
        ? []
        : [
            {
              name: "children",
              value: text.value,
              literalType: "string",
              start: start(text),
              end: end(text),
              syntax: "markdown",
            },
          ];
    sourceNodes.push({
      kind,
      tag,
      start: start(node),
      end: end(node),
      contentStart: content?.[0] ?? (children[0] === undefined ? start(node) : start(children[0])),
      contentEnd:
        content?.[1] ?? (children.length === 0 ? end(node) : end(children[children.length - 1]!)),
      src: src(node),
      properties: [...properties, ...textProperties],
    });
  };
  const attach = (items: readonly EmailDiagnostic[], offset: number): void => {
    for (const diagnostic of items)
      diagnostics.push({ ...diagnostic, origins: [location(offset)] });
  };
  const attribute = (tag: string, name: string, value: string | number, offset: number): void => {
    attach(checkAttribute(tag, name, value, [location(offset)]).diagnostics, offset);
  };
  const definitions = new Map<string, Definition>();
  const collectDefinitions = (node: Nodes): void => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node) for (const child of node.children) collectDefinitions(child);
  };
  collectDefinitions(tree);
  const linkProperties = (
    node: Extract<Nodes, { type: "link" | "image" | "linkReference" | "imageReference" }>,
    reference: Definition | Extract<Nodes, { type: "link" | "image" }>,
    image: boolean,
  ): MarkdownSourceProperty[] => {
    const properties: MarkdownSourceProperty[] = [];
    const property = (name: string, value: string, from: number, to: number): void => {
      properties.push({
        name,
        value,
        literalType: "string",
        start: from,
        end: to,
        syntax: "markdown",
      });
    };
    const labelEnd = (from: number, to: number): number => {
      let depth = 0;
      for (let index = from; index < to; index++) {
        if (source[index] === "\\") {
          index++;
          continue;
        }
        if (source[index] === "`") {
          let count = 1;
          while (source[index + count] === "`") count++;
          const delimiter = "`".repeat(count);
          let close = source.indexOf(delimiter, index + count);
          while (
            close >= 0 &&
            close < to &&
            (source[close - 1] === "`" || source[close + count] === "`")
          )
            close = source.indexOf(delimiter, close + count);
          if (close >= 0 && close < to) {
            index = close + count - 1;
            continue;
          }
        }
        if (source[index] === "[") depth++;
        if (source[index] === "]" && --depth === 0) return index;
      }
      return to;
    };
    const labelStart = start(node) + (image ? 2 : 1);
    if (image && "alt" in node)
      property("alt", node.alt ?? "", labelStart, labelEnd(labelStart - 1, end(node)));
    const from = start(reference);
    const to = end(reference);
    const autolink = source[from] === "<";
    let cursor = autolink ? from + 1 : labelEnd(from, to) + 2;
    while (/\s/.test(source[cursor] ?? "") && cursor < to) cursor++;
    const angle = source[cursor] === "<";
    if (angle) cursor++;
    const urlStart = cursor;
    let depth = 0;
    for (; cursor < to; cursor++) {
      const character = source[cursor];
      if (character === "\\") {
        cursor++;
        continue;
      }
      if ((autolink || angle) && character === ">") break;
      if (!autolink && !angle) {
        if (character === "(") depth++;
        else if (character === ")") {
          if (depth === 0) break;
          depth--;
        } else if (/\s/.test(character ?? "")) break;
      }
    }
    property(image ? "src" : "href", reference.url, urlStart, cursor);
    if (angle) cursor++;
    while (/\s/.test(source[cursor] ?? "") && cursor < to) cursor++;
    if (reference.title !== null && reference.title !== undefined) {
      const delimiter = source[cursor] === "(" ? ")" : source[cursor];
      const titleStart = ++cursor;
      for (; cursor < to; cursor++) {
        if (source[cursor] === "\\") {
          cursor++;
          continue;
        }
        if (source[cursor] === delimiter) break;
      }
      property("title", reference.title, titleStart, cursor);
    }
    return properties;
  };
  const propValue = (
    spec: ComponentSpec["props"][number],
    value: string | boolean,
    offset: number,
  ): string | number | boolean | undefined => {
    const types = spec.type.split(/\s*\|\s*/);
    if (types.includes("boolean")) {
      if (value === true || value === "true") return true;
      if (value === "false") return false;
    }
    if (typeof value === "string") {
      if (types.includes("string")) return value;
      if (types.includes("number") && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
      }
      if (types.some((type) => type === JSON.stringify(value))) return value;
    }
    report("markdown-prop", `${spec.name} requires a static ${spec.type} value.`, offset);
    return undefined;
  };
  const component = (node: JsxNode): CompiledNode[] => {
    const name = node.name;
    if (name === null || !componentName(name)) {
      report(
        name !== null && /^[a-z]/.test(name) ? "markdown-html" : "unknown-component",
        `Unsupported tag <${name ?? ""}>; use Markdown or a component from the SML component registry.`,
        start(node),
      );
      return [];
    }
    const spec = contract.components.find((candidate) => candidate.name === name);
    if (spec === undefined) {
      report("markdown-prop", `The generated prop contract is missing ${name}.`, start(node));
      return [];
    }
    const props: Record<string, string | number | boolean> = {};
    const properties: MarkdownSourceProperty[] = [];
    const seen = new Set<string>();
    for (const attr of node.attributes) {
      const offset = attr.position?.start.offset ?? start(node);
      if (
        attr.type !== "mdxJsxAttribute" ||
        (attr.value !== null && attr.value !== undefined && typeof attr.value !== "string")
      ) {
        report(
          "markdown-expression",
          "Expressions and spread attributes are not supported in SML Markdown.",
          offset,
        );
        continue;
      }
      if (seen.has(attr.name)) {
        report("markdown-prop", `Duplicate ${attr.name} attribute on <${name}>.`, offset);
        continue;
      }
      seen.add(attr.name);
      const field = spec.props.find((prop) => prop.name === attr.name && prop.name !== "children");
      if (field === undefined) {
        report("markdown-prop", `<${name}> does not support the ${attr.name} attribute.`, offset);
        continue;
      }
      const value = propValue(field, attr.value ?? true, offset);
      if (value === undefined) continue;
      props[attr.name] = value;
      if (name === "BrandLogo" && attr.name === "width" && typeof value === "number")
        attribute("img", "width", value, offset);
      const attrEnd = attr.position?.end.offset ?? offset + attr.name.length;
      const raw = source.slice(offset, attrEnd);
      const quote = raw.search(/["']/);
      properties.push({
        name: attr.name,
        value,
        literalType:
          typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean",
        start: quote < 0 ? offset : offset + quote,
        end: attrEnd,
        syntax: quote < 0 ? "boolean" : "quoted",
      });
      if (typeof value === "string") {
        // oxlint-disable-next-line no-control-regex -- Reject control bytes at the authored scalar boundary before primitive lowering.
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uE000\uE001]/.test(value))
          report(
            "markdown-prop",
            `${attr.name} contains a control character or reserved token delimiter.`,
            offset,
          );
        if (attr.name === "href") attribute("a", "href", value, offset);
        if (attr.name === "src") attribute("img", "src", value, offset);
      }
    }
    for (const field of spec.props)
      if (!field.optional && !Object.hasOwn(props, field.name))
        report("markdown-prop", `<${name}> requires the ${field.name} attribute.`, start(node));
    const kids = node.children.flatMap(walk);
    const raw = source.slice(start(node), end(node));
    // Attribute positions are tokenizer-owned, so quoted > characters cannot end the opener.
    const lastAttribute = node.attributes[node.attributes.length - 1];
    const openEnd = source.indexOf(">", lastAttribute?.position?.end.offset ?? start(node));
    const selfClosing = source[openEnd - 1] === "/";
    const closeStart = selfClosing ? openEnd + 1 : start(node) + raw.lastIndexOf("</");
    record(node, "component", name, properties, [openEnd + 1, closeStart]);
    if (kids.length > 0 && !spec.props.some((field) => field.name === "children"))
      report("markdown-prop", `<${name}> does not accept children.`, start(node));
    return [{ type: "component", name, props, children: kids, src: src(node) }];
  };
  const intrinsic = (
    node: Nodes,
    type: "block" | "inline",
    tag: string,
    kids: readonly CompiledNode[],
    attrs?: Readonly<Record<string, CompiledValue>>,
    properties: readonly MarkdownSourceProperty[] = [],
  ): CompiledNode[] => {
    record(node, type, tag, properties);
    return [
      { type, tag, children: kids, ...(attrs === undefined ? {} : { attrs }), src: src(node) },
    ];
  };
  const walk = (node: Nodes): CompiledNode[] => {
    switch (node.type) {
      case "root":
        return node.children.flatMap(walk);
      case "text":
        record(node, "text", "#text");
        if (/[\uE000\uE001]/.test(node.value))
          report(
            "markdown-syntax",
            "Text contains a reserved compiler token delimiter.",
            start(node),
          );
        return [node.value];
      case "paragraph":
        return intrinsic(node, "block", "p", node.children.flatMap(walk));
      case "heading":
        return intrinsic(node, "block", `h${node.depth}`, node.children.flatMap(walk));
      case "blockquote":
        return intrinsic(node, "block", "blockquote", node.children.flatMap(walk));
      case "list":
        return intrinsic(
          node,
          "block",
          node.ordered ? "ol" : "ul",
          node.children.flatMap(walk),
          node.ordered && node.start !== null && node.start !== undefined && node.start !== 1
            ? { start: node.start }
            : undefined,
        );
      case "listItem":
        return intrinsic(node, "block", "li", node.children.flatMap(walk));
      case "strong":
        return intrinsic(node, "inline", "strong", node.children.flatMap(walk));
      case "emphasis":
        return intrinsic(node, "inline", "em", node.children.flatMap(walk));
      case "inlineCode":
        return intrinsic(node, "inline", "code", [node.value]);
      case "code":
        return intrinsic(node, "block", "pre", [
          { type: "inline", tag: "code", children: [node.value], src: src(node) },
        ]);
      case "break":
        return intrinsic(node, "inline", "br", []);
      case "thematicBreak":
        return intrinsic(node, "block", "hr", []);
      case "link":
      case "image":
      case "linkReference":
      case "imageReference": {
        const reference =
          node.type === "linkReference" || node.type === "imageReference"
            ? definitions.get(node.identifier)
            : node;
        if (reference === undefined) {
          report("markdown-syntax", "The Markdown reference has no definition.", start(node));
          return [];
        }
        const image = node.type === "image" || node.type === "imageReference";
        const attrs: Record<string, CompiledValue> = image
          ? { src: reference.url, alt: "alt" in node ? (node.alt ?? "") : "" }
          : { href: reference.url };
        if (reference.title !== null && reference.title !== undefined)
          attrs.title = reference.title;
        attribute(image ? "img" : "a", image ? "src" : "href", reference.url, start(node));
        return intrinsic(
          node,
          "inline",
          image ? "img" : "a",
          "children" in node ? node.children.flatMap(walk) : [],
          attrs,
          linkProperties(node, reference, image),
        );
      }
      case "definition":
        return [];
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
        return component(node);
      case "mdxFlowExpression":
      case "mdxTextExpression":
        report(
          "markdown-expression",
          "Expressions are not supported in SML Markdown; write static content.",
          start(node),
        );
        return [];
      case "html":
        report(
          "markdown-html",
          "Raw HTML is not supported; use Markdown or SML components.",
          start(node),
        );
        return [];
      default:
        report("markdown-syntax", `Unsupported Markdown construct ${node.type}.`, start(node));
        return [];
    }
  };
  const nodes = walk(tree);
  if (!diagnostics.some((item) => item.severity === "error")) {
    // Unresolved brands are host-owned. Validate the remaining static primitives through their
    // real lowering, including numeric bounds, CSS values and generated attribute URLs.
    const lowerStatic = (list: readonly CompiledNode[]): CompiledNode[] =>
      list.flatMap((node): CompiledNode[] => {
        if (isValueNode(node)) return [node];
        if (
          "type" in node &&
          node.type === "component" &&
          (node.name === "BrandLogo" || node.name === "BrandFooter")
        )
          return [];
        const lowered = {
          ...node,
          ...("children" in node && node.children !== undefined
            ? { children: lowerStatic(node.children) }
            : {}),
        };
        const at =
          "src" in node && node.src !== undefined
            ? (lines[node.src[0] - 1] ?? 0) + node.src[1] - 1
            : 0;
        return lowerEmailNodes([lowered], undefined, (diagnostic) =>
          attach([{ ...diagnostic, origins: [] }], at),
        );
      });
    const lowered = lowerStatic(nodes);
    const validate = (list: readonly CompiledNode[]): void => {
      for (const node of list) {
        if (isValueNode(node)) continue;
        if ("el" in node) {
          const at = node.src === undefined ? 0 : (lines[node.src[0] - 1] ?? 0) + node.src[1] - 1;
          for (const [name, value] of Object.entries(node.attrs ?? {}))
            if (typeof value === "string" || typeof value === "number")
              attribute(node.el, name, value, at);
          if (Array.isArray(node.style))
            attach(serializeStyle(Object.fromEntries(node.style), [location(at)]).diagnostics, at);
        }
        if ("children" in node && node.children !== undefined) validate(node.children);
      }
    };
    validate(lowered);
  }
  sourceNodes.sort((a, b) => a.start - b.start || b.end - a.end);
  return result(nodes);
};
