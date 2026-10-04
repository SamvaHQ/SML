import { emailElement } from "./elements";
import type { EmailNode } from "./jsx-runtime";

// The plain-text alternative is derived from the same semantic tree the HTML
// comes from, in document order, so the two parts always say the same thing in
// the same sequence. Layout tables are transparent; a data table keeps its rows
// and columns; links keep their destination; images keep their alt text.

interface TextContext {
  readonly preformatted: boolean;
  readonly listDepth: number;
}

const PARAGRAPH = "\n\n";
const LINE = "\n";

// Zero-width and directional marks are spacer scaffolding (preheader padding,
// empty layout cells). They carry nothing to read, so the text lane drops them
// and the surrounding block disappears with them.
const INVISIBLE = /\u200b|\u200c|\u200d|\u200e|\u200f|\u2060|\ufeff/g;

const isLayoutTable = (props: Readonly<Record<string, unknown>>): boolean =>
  props.role === "presentation" || props.role === "none";

/**
 * A data-table cell that reads as nothing and holds only imagery with empty alt text carries no
 * column of its own; an empty cell without such an image is a positional placeholder.
 */
const isDecorativeCell = (cell: EmailNode & { type: "Element" }, context: TextContext): boolean => {
  const images = collect(
    cell.children,
    (tag) => tag === "img",
    () => true,
  );
  return (
    images.length > 0 &&
    images.every((image) => image.props.alt === "") &&
    childText(cell, context).trim() === ""
  );
};

/** Wrap a block's content in separators; empty blocks contribute nothing. */
const block = (inner: string, separator: string): string => {
  const trimmed = inner.replace(/^\s+/, "").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${separator}${trimmed}${separator}`;
};

const collect = (
  nodes: readonly EmailNode[],
  keep: (tag: string) => boolean,
  descend: (tag: string) => boolean,
): readonly (EmailNode & { type: "Element" })[] =>
  nodes.flatMap((child) => {
    if (child.type === "Fragment") return collect(child.children, keep, descend);
    if (child.type !== "Element") return [];
    if (keep(child.tag)) return [child];
    return descend(child.tag) ? collect(child.children, keep, descend) : [];
  });

const TABLE_SECTIONS = new Set(["thead", "tbody", "tfoot"]);

const childText = (node: EmailNode & { type: "Element" }, context: TextContext): string =>
  node.children.map((child) => derive(child, context)).join("");

const derive = (node: EmailNode, context: TextContext): string => {
  switch (node.type) {
    case "Text":
      return context.preformatted
        ? node.value
        : node.value.replace(INVISIBLE, "").replace(/[^\S\n]+/g, " ");
    case "Raw":
      return node.text;
    case "Fragment":
      return node.children.map((child) => derive(child, context)).join("");
    case "Element": {
      const spec = emailElement(node.tag);
      // An unsupported element is already a compile error; keep its content in
      // reading order rather than dropping the author's text silently.
      if (spec === undefined) return childText(node, context);
      switch (spec.layout) {
        case "metadata":
          return "";
        case "document":
        case "inline":
        case "list-item":
          return childText(node, context);
        case "break":
          return LINE;
        case "rule":
          return `${PARAGRAPH}---${PARAGRAPH}`;
        case "image": {
          const alt = typeof node.props.alt === "string" ? node.props.alt.trim() : "";
          return alt === "" ? "" : `[${alt}]`;
        }
        case "link": {
          const label = childText(node, context).replace(/\s+/g, " ").trim();
          const href = typeof node.props.href === "string" ? node.props.href : "";
          if (href === "" || href === label) return label;
          return label === "" ? href : `${label} (${href})`;
        }
        case "list": {
          const indent = "  ".repeat(context.listDepth);
          const start = Number(node.props.start ?? 1);
          const first = Number.isFinite(start) ? start : 1;
          const nested = { ...context, listDepth: context.listDepth + 1 };
          const items = collect(
            node.children,
            (tag) => tag === "li",
            () => false,
          );
          const lines = items.map((item, index) => {
            const marker = node.tag === "ol" ? `${first + index}.` : "-";
            const continuation = `${indent}${" ".repeat(marker.length + 1)}`;
            // Inside an item a blank line reads as a broken list, so nested
            // lists and paragraphs become plain line breaks under the marker.
            const [head = "", ...rest] = derive(item, nested)
              .replace(/^\s+/, "")
              .replace(/\s+$/, "")
              .replace(/\n{2,}/g, LINE)
              .split("\n");
            return [
              `${indent}${marker} ${head}`,
              ...rest.map((line) =>
                line.trim() === "" ? "" : /^\s/.test(line) ? line : `${continuation}${line}`,
              ),
            ].join(LINE);
          });
          return block(lines.join(LINE), PARAGRAPH);
        }
        case "table": {
          if (isLayoutTable(node.props)) return childText(node, context);
          const rows = collect(
            node.children,
            (tag) => tag === "tr",
            (tag) => TABLE_SECTIONS.has(tag),
          ).map((row) =>
            collect(
              row.children,
              (tag) => tag === "td" || tag === "th",
              () => false,
            )
              .filter((cell) => !isDecorativeCell(cell, context))
              .map((cell) => childText(cell, context).replace(/\s+/g, " ").trim())
              .join(" | "),
          );
          return block(rows.join(LINE), PARAGRAPH);
        }
        case "row":
          return block(
            collect(
              node.children,
              (tag) => tag === "td" || tag === "th",
              () => false,
            )
              .map((cell) => childText(cell, context).replace(/^\s+|\s+$/g, ""))
              .filter((cell) => cell !== "")
              .join(LINE),
            LINE,
          );
        case "table-section":
        case "cell":
          return block(childText(node, context), LINE);
        case "preformatted":
          return block(childText(node, { ...context, preformatted: true }), PARAGRAPH);
        case "block":
          return block(childText(node, context), PARAGRAPH);
      }
    }
  }
};

/** Collapse the separators the walk emits into readable plain text. */
const normalize = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, PARAGRAPH)
    .trim();

/** Derive the plain-text alternative from the semantic tree in reading order. */
export const deriveEmailText = (node: EmailNode): string =>
  normalize(derive(node, { preformatted: false, listDepth: 0 }));
