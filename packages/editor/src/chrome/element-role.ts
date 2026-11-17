import {
  inspectSourceElement,
  type EmailElementSelection,
  type JsxSourceLocation,
  type SourceElement,
} from "@samva/markup/edit";

import { classTokens, friendlyName } from "./friendly";

// The breadcrumb names the blocks around an element by what they are to the author: the component
// they wrote (`OrderCard`), the label they gave it, or the role its styling gives it (a card, a
// band). An element with none of these keeps its plain tag name, which is only a fallback.

/** The authored template the selections' origins point into. */
export interface RoleSource {
  readonly file: string;
  readonly source: string;
}

/** What one element is called in the breadcrumb, and whether the author's own words or shape named it. */
export interface ElementRole {
  readonly label: string;
  /** False for a plain tag name (`Section`, `Box`), which says nothing about the block's job. */
  readonly named: boolean;
}

/** Components the markup package ships; naming a block after one says nothing about it. */
const BUILT_IN_COMPONENTS: ReadonlySet<string> = new Set([
  "Body",
  "Box",
  "Button",
  "Column",
  "Columns",
  "Container",
  "Divider",
  "Email",
  "Fragment",
  "Head",
  "Heading",
  "Hr",
  "Html",
  "Image",
  "Img",
  "Link",
  "Markdown",
  "Preview",
  "Row",
  "Section",
  "Spacer",
  "Text",
]);

/** Blocks whose styling can make them a card or a band. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "Box",
  "Column",
  "Container",
  "Row",
  "Section",
  "div",
  "table",
  "td",
]);

const IMAGE_ONLY = /^<(?:Image|Img|img)\b[^<]*\/>$/;

/** `order-card`, `orderCard` and `Order_Card` as "Order card". */
export const humanizeName = (raw: string): string => {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((word) => word !== "");
  if (words.length === 0) return "";
  const text = words.map((word) => word.toLowerCase()).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The element name written at an origin, read from its line without parsing the file. */
const tagAt = (source: string, origin: JsxSourceLocation): string | undefined => {
  const line = source.split("\n")[origin.lineNumber - 1];
  if (line === undefined) return undefined;
  return line
    .slice(Math.max(0, origin.columnNumber - 1))
    .match(/^<([A-Za-z][A-Za-z0-9_.:-]*)/)?.[1];
};

/** The first custom component among the call sites that produced this element, nearest first. */
const customComponent = (
  selection: EmailElementSelection,
  authored: RoleSource,
): string | undefined => {
  for (const origin of selection.origins) {
    if (origin.fileName !== authored.file) continue;
    const written = tagAt(authored.source, origin)?.split(".").at(-1);
    if (written !== undefined && /^[A-Z]/.test(written) && !BUILT_IN_COMPONENTS.has(written))
      return humanizeName(written);
  }
  return undefined;
};

/** `{/* Order card *\/}` directly before the element, or nothing. */
const commentLabel = (source: string, target: SourceElement): string | undefined => {
  const before = source.slice(0, target.start).trimEnd();
  // The comment's text never holds `*/`, so the match cannot start at an earlier comment.
  const text = /\{\s*\/\*((?:(?!\*\/)[\s\S])*)\*\/\s*\}$/.exec(before)?.[1]?.trim();
  return text === undefined || text === "" ? undefined : text;
};

const LABEL_PROPS = ["aria-label", "title", "id", "data-name"] as const;

/** A literal `aria-label`, `title`, `id` or `data-name` the author wrote on the element. */
const writtenProp = (target: SourceElement): string | undefined => {
  for (const name of LABEL_PROPS) {
    const field = target.properties.find((property) => property.name === name);
    if (field?.kind !== "literal" || field.literalType !== "string") continue;
    const value = field.value.trim();
    if (value === "") continue;
    return name === "id" || name === "data-name" ? humanizeName(value) : value;
  }
  return undefined;
};

const literalProp = (target: SourceElement, name: string): string | undefined => {
  const field = target.properties.find((property) => property.name === name);
  return field?.kind === "literal" ? field.value : undefined;
};

/** The element's literal Tailwind classes, without variants (`md:`, `dark:`). */
const plainClasses = (target: SourceElement): ReadonlyArray<string> =>
  classTokens(literalProp(target, "className") ?? "").filter((token) => !token.includes(":"));

const NOT_A_BACKGROUND_COLOR =
  /^bg-(?:none|auto|cover|contain|center|top|bottom|left|right|repeat|no-repeat|fixed|local|scroll|clip-|origin-|gradient-|linear-|radial-|conic-|blend-)/;

const hasBackground = (target: SourceElement, classes: ReadonlyArray<string>): boolean =>
  classes.some((token) => token.startsWith("bg-") && !NOT_A_BACKGROUND_COLOR.test(token)) ||
  target.properties.some(
    (field) =>
      (field.name === "style.backgroundColor" || field.name === "style.background") &&
      field.value !== "" &&
      field.value !== "transparent",
  ) ||
  literalProp(target, "bgcolor") !== undefined;

const hasRoundedCorners = (target: SourceElement, classes: ReadonlyArray<string>): boolean =>
  classes.some((token) => /^rounded(?:-(?!none$)|$)/.test(token)) ||
  target.properties.some(
    (field) =>
      field.name === "style.borderRadius" &&
      field.value !== "" &&
      Number.parseFloat(field.value) !== 0,
  );

const hasBorder = (target: SourceElement, classes: ReadonlyArray<string>): boolean =>
  classes.some((token) => token === "border" || /^border-(?:\d|[xytblrse](?:-\d|$))/.test(token)) ||
  target.properties.some((field) => field.name === "style.border" && field.value !== "");

const isFullWidth = (target: SourceElement, classes: ReadonlyArray<string>): boolean =>
  classes.includes("w-full") ||
  literalProp(target, "style.width") === "100%" ||
  literalProp(target, "width") === "100%";

/** A role the block's own shape gives it, or nothing. */
const shapeRole = (source: string, target: SourceElement): string | undefined => {
  if (target.tag === "Columns") return "Columns";
  if (!BLOCK_TAGS.has(target.tag)) return undefined;
  if (target.contentStart !== null && target.contentEnd !== null) {
    const content = source.slice(target.contentStart, target.contentEnd).trim();
    if (IMAGE_ONLY.test(content)) return "Image";
  }
  const classes = plainClasses(target);
  if (!hasBackground(target, classes)) return undefined;
  if (hasRoundedCorners(target, classes) || hasBorder(target, classes)) return "Card";
  if (isFullWidth(target, classes)) return "Band";
  return undefined;
};

/**
 * What one authored element is called in the breadcrumb: a custom component it comes from, a
 * label the author wrote, the role its styling gives it, or else its friendly tag name.
 */
export const elementRole = (
  selection: EmailElementSelection,
  authored: RoleSource,
): ElementRole => {
  const component = customComponent(selection, authored);
  if (component !== undefined) return { label: component, named: true };
  const origin = selection.origins[0];
  const target =
    origin === undefined || origin.fileName !== authored.file
      ? null
      : inspectSourceElement(authored.source, authored.file, origin);
  if (target !== null) {
    const written = commentLabel(authored.source, target) ?? writtenProp(target);
    if (written !== undefined) return { label: written, named: true };
    const shape = shapeRole(authored.source, target);
    if (shape !== undefined) return { label: shape, named: true };
  }
  return { label: friendlyName(selection, authored.source), named: false };
};

export interface RoleCrumb {
  readonly instancePath: string;
  readonly label: string;
}

/**
 * The trail between Email and the selected element: the nearest two blocks around it, by role.
 * A plain-tag block is left out when the chain holds a named one, and a block never repeats the
 * name beside it, so `Section › Section › Heading` reads `Section › Heading`.
 */
export const roleCrumbs = (
  ancestry: ReadonlyArray<EmailElementSelection>,
  authored: RoleSource,
  selectedLabel: string,
  limit = 2,
): ReadonlyArray<RoleCrumb> => {
  const roles = ancestry.map((selection) => ({
    instancePath: selection.instancePath,
    ...elementRole(selection, authored),
  }));
  const anyNamed = roles.some((role) => role.named);
  const kept: RoleCrumb[] = [];
  let next = selectedLabel;
  for (const role of roles.toReversed()) {
    if (anyNamed && !role.named) continue;
    if (role.label === next) continue;
    kept.unshift({ instancePath: role.instancePath, label: role.label });
    next = role.label;
    if (kept.length === limit) break;
  }
  return kept;
};
