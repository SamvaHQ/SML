import type { EmailElementSelection } from "@samva/markup/edit";

import { selectionComponentLabel, type EmailOutline } from "./email-outline";

// The Design tab speaks the author's language: the blocks and components they wrote, by name,
// rather than the tables, rows and cells the compiler renders them into. Provenance comes from
// the compiler (`selection.authored`): exactly one rendered element per authored JSX element is
// marked authored, and everything else is scaffolding the author never wrote.

/** What an intrinsic tag is called where an author would look for it. */
const TAG_NAMES: Readonly<Record<string, string>> = {
  html: "Email",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  p: "Text",
  span: "Text",
  strong: "Bold text",
  em: "Italic text",
  a: "Link",
  img: "Image",
  div: "Box",
  ul: "List",
  ol: "List",
  li: "List item",
  hr: "Divider",
  table: "Table",
  td: "Cell",
  button: "Button",
  br: "Line break",
};

/**
 * The name an author knows an element by: the component they wrote (`Button`, `Section`), or a
 * plain word for an HTML element (`Heading`, `Text`, `Image`). The root is the Email.
 */
export const friendlyName = (selection: EmailElementSelection, authoredSource: string): string => {
  if (selection.tag === "html") return "Email";
  const written = selectionComponentLabel(selection, authoredSource);
  if (/^[A-Z]/.test(written)) return written.split(".").at(-1) ?? written;
  return TAG_NAMES[written] ?? TAG_NAMES[selection.tag] ?? written;
};

/** "2 of 3" for an element a loop or a repeated component renders more than once. */
export const occurrenceNote = (selection: EmailElementSelection): string | undefined =>
  selection.occurrences > 1 ? `${selection.occurrence} of ${selection.occurrences}` : undefined;

/** One authored element in the layers, with the authored elements nested inside it. */
export interface AuthoredNode {
  readonly instancePath: string;
  readonly selection: EmailElementSelection;
  readonly children: ReadonlyArray<AuthoredNode>;
  /** How many times a loop draws this element side by side; the layer stands for all of them. */
  readonly copies: number;
}

/**
 * Copies a loop drew share every origin, call sites included; two uses of one partial share the
 * partial's line but not the call that placed them, so they stay separate layers.
 */
const originKey = (selection: EmailElementSelection): string =>
  selection.origins.length === 0
    ? selection.instancePath
    : selection.origins
        .map((origin) => `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`)
        .join(">");

/** Neighbours a loop drew from one authored element become one layer that counts them. */
const foldCopies = (nodes: ReadonlyArray<AuthoredNode>): AuthoredNode[] => {
  const folded: AuthoredNode[] = [];
  for (const node of nodes) {
    const last = folded.at(-1);
    if (last !== undefined && originKey(last.selection) === originKey(node.selection)) {
      folded[folded.length - 1] = { ...last, copies: last.copies + 1 };
    } else folded.push(node);
  }
  return folded;
};

/**
 * The render's tree with the scaffolding taken out: every authored element, nested under the
 * nearest authored element around it. A generated node's authored descendants move up to take
 * its place, so a `Section`'s table, row and cell never show.
 */
export const authoredTree = (outline: EmailOutline): ReadonlyArray<AuthoredNode> => {
  const lift = (instancePath: string): AuthoredNode[] => {
    const node = outline.nodes.get(instancePath);
    if (node === undefined) return [];
    const children = foldCopies(node.children.flatMap((child) => lift(child.instancePath)));
    return node.selection.authored
      ? [{ instancePath, selection: node.selection, children, copies: 1 }]
      : children;
  };
  return outline.roots.flatMap((root) => lift(root.instancePath));
};

/** The authored elements around `instancePath`, outermost first, excluding the root Email. */
export const authoredAncestry = (
  outline: EmailOutline,
  instancePath: string,
): ReadonlyArray<EmailElementSelection> => {
  const chain: EmailElementSelection[] = [];
  let current = outline.index.get(instancePath)?.parentPath;
  while (current !== undefined) {
    const selection = outline.index.get(current);
    if (selection === undefined) break;
    if (selection.authored && selection.tag !== "html") chain.unshift(selection);
    current = selection.parentPath;
  }
  return chain;
};

/** The nearest authored element at or above `instancePath`, so a click on scaffolding lands. */
export const nearestAuthored = (
  outline: EmailOutline,
  instancePath: string,
): EmailElementSelection | undefined => {
  let current: string | undefined = instancePath;
  while (current !== undefined) {
    const selection = outline.index.get(current);
    if (selection === undefined) return undefined;
    if (selection.authored) return selection;
    current = selection.parentPath;
  }
  return undefined;
};

/** A color token the theme declares, with its light value when the theme file says it. */
export interface ThemeColor {
  readonly name: string;
  readonly value: string | undefined;
}

/**
 * The colors a theme declares as `--color-<name>` in its first `@theme` block (the light
 * values), in declaration order.
 */
export const themeColors = (css: string): ReadonlyArray<ThemeColor> => {
  const block = /@theme\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const colors: ThemeColor[] = [];
  for (const match of block.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && !colors.some((color) => color.name === name))
      colors.push({ name, value: value?.trim() });
  }
  return colors;
};

/** Utilities that look like colors but are something else. */
const NOT_COLORS = new Set([
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "transparent",
  "current",
  "inherit",
  "clip",
  "ellipsis",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
]);

/**
 * The color tokens a template already uses (`text-primary`, `bg-card`), for a project whose
 * theme file the editor cannot read. Arbitrary values and sizes are left out.
 */
export const usedColorTokens = (source: string): ReadonlyArray<string> => {
  const found = new Set<string>();
  for (const match of source.matchAll(
    /(?:^|[\s"'`])(?:text|bg|border)-([a-z][a-z0-9-]*)(?=[\s"'`]|$)/g,
  )) {
    const token = match[1];
    if (token !== undefined && !NOT_COLORS.has(token) && !/^\d/.test(token)) found.add(token);
  }
  return [...found];
};

/** The class list as tokens. */
export const classTokens = (value: string): ReadonlyArray<string> =>
  value.split(/\s+/).filter((token) => token !== "");

/** `paddingX` → "Padding X", `borderRadius` → "Border radius". */
export const propLabel = (name: string): string => {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.length === 1
          ? word.toUpperCase()
          : word.toLowerCase(),
    )
    .join(" ");
};
