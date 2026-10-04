import type { JsxSourceLocation } from "@samva/markup/edit";
import type { EmailElementSelection } from "@samva/markup/render";
import { emailSelectionIndex } from "@samva/markup/render";

/**
 * The editor's tree view of one render. It is built from the render's own
 * selections — `parentPath` is the edge, document order is the sibling order —
 * so the layers rail, the breadcrumb and the canvas all point at the same
 * rendered instances rather than at a separately parsed model of the source.
 */
export interface EmailOutlineNode {
  readonly instancePath: string;
  readonly selection: EmailElementSelection;
  readonly children: ReadonlyArray<EmailOutlineNode>;
}

export interface EmailOutline {
  /** Top-level nodes, which is normally the single document root. */
  readonly roots: ReadonlyArray<EmailOutlineNode>;
  /** Every rendered element by instance path. */
  readonly index: ReadonlyMap<string, EmailElementSelection>;
  readonly nodes: ReadonlyMap<string, EmailOutlineNode>;
}

/** The authoring element that produced a rendered element, when there is one. */
export const authoringOrigin = (selection: EmailElementSelection): JsxSourceLocation | undefined =>
  selection.origins[0];

/** `templates/welcome.tsx:12:3` — how the inspector and the layers rail name an origin. */
export const formatOrigin = (origin: JsxSourceLocation): string =>
  `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`;

/**
 * What this rendered element is: its tag, and — when one piece of authoring
 * produced several rendered elements — which of them this is.
 */
export const selectionLabel = (selection: EmailElementSelection): string =>
  selection.occurrences > 1
    ? `${selection.tag} ${selection.occurrence} of ${selection.occurrences}`
    : selection.tag;

/** Compiler-generated wrappers are named as such so no one reads them as authored markup. */
export const selectionKindLabel = (selection: EmailElementSelection): string =>
  selection.authored ? "Authored" : "Generated";

/** The authored JSX component at a selection's first origin, when source is available. */
export const selectionComponentLabel = (
  selection: EmailElementSelection,
  authoredSource: string,
): string => {
  const origin = selection.origins[0];
  if (origin === undefined) return selectionLabel(selection);
  const line = authoredSource.split("\n")[origin.lineNumber - 1];
  if (line === undefined) return selectionLabel(selection);
  const atOrigin = line.slice(Math.max(0, origin.columnNumber - 1));
  const component = atOrigin.match(/<([A-Za-z][A-Za-z0-9_.:-]*)/)?.[1];
  return component ?? selectionLabel(selection);
};

/** A short recipient-visible text hint for an Assistant layer target. */
export const selectionTextExcerpt = (
  selection: EmailElementSelection,
  html: string,
): string | undefined => {
  const excerpt = html
    .slice(selection.start, selection.end)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (excerpt === "") return undefined;
  return excerpt.length > 72 ? `${excerpt.slice(0, 69).trimEnd()}…` : excerpt;
};

export interface EmailOutlineEntry {
  readonly depth: number;
  readonly node: EmailOutlineNode;
}

/** Flatten the rendered hierarchy without losing its display depth or document order. */
export const outlineEntries = (outline: EmailOutline): ReadonlyArray<EmailOutlineEntry> => {
  const entries: EmailOutlineEntry[] = [];
  const visit = (node: EmailOutlineNode, depth: number) => {
    entries.push({ depth, node });
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of outline.roots) visit(root, 0);
  return entries;
};

/** Build the tree for one render's selections, in document order. */
export const emailOutline = (selections: ReadonlyArray<EmailElementSelection>): EmailOutline => {
  const index = emailSelectionIndex(selections);
  const children = new Map<string, EmailOutlineNode[]>();
  const nodes = new Map<string, EmailOutlineNode>();
  const roots: EmailOutlineNode[] = [];

  for (const selection of selections) {
    const own: EmailOutlineNode[] = [];
    children.set(selection.instancePath, own);
    const node: EmailOutlineNode = {
      instancePath: selection.instancePath,
      selection,
      children: own,
    };
    nodes.set(selection.instancePath, node);
    // Selections arrive in document order, so a parent is always placed before
    // its children. A path whose parent is absent from this render is a root.
    const parent =
      selection.parentPath === undefined ? undefined : children.get(selection.parentPath);
    if (parent === undefined) roots.push(node);
    else parent.push(node);
  }

  return { roots, index, nodes };
};

/** Ancestor paths of `instancePath`, outermost first, excluding the element itself. */
export const outlineAncestry = (
  outline: EmailOutline,
  instancePath: string,
): ReadonlyArray<string> => {
  const chain: string[] = [];
  let current = outline.index.get(instancePath)?.parentPath;
  while (current !== undefined) {
    chain.unshift(current);
    current = outline.index.get(current)?.parentPath;
  }
  return chain;
};

export interface Crumb {
  readonly instancePath: string;
  readonly label: string;
}

/** Breadcrumb from the outermost rendered ancestor down to `instancePath`, inclusive. */
export const outlineBreadcrumb = (
  outline: EmailOutline,
  instancePath: string,
): ReadonlyArray<Crumb> =>
  [...outlineAncestry(outline, instancePath), instancePath].flatMap((path) => {
    const selection = outline.index.get(path);
    return selection === undefined
      ? []
      : [{ instancePath: path, label: selectionLabel(selection) }];
  });

/** The root and every node that directly holds children, so the tree opens on structure. */
export const defaultExpanded = (outline: EmailOutline | null): Set<string> => {
  const expanded = new Set<string>();
  if (outline === null) return expanded;
  for (const root of outline.roots) {
    expanded.add(root.instancePath);
    for (const child of root.children) {
      if (child.children.length > 0) expanded.add(child.instancePath);
    }
  }
  return expanded;
};
