import { parseExpression } from "@babel/parser";

import { sentence } from "./theme-tokens";

// A binding is data the template fills in on each send (`{input.product.shortName}`). The
// inspector names it the way an author says it ("Product short name") and shows the value the
// active fixture gives it, keeping the raw path for the tooltip.

/** Roots that hold the template's input rather than naming anything an author would say. */
const ROOTS = new Set(["input", "props", "data"]);

/** `input.product.shortName`, `items[0].name`, `input?.name`: a plain path, as its segments. */
export const bindingPath = (expression: string): ReadonlyArray<string> | null => {
  const text = expression
    .trim()
    .replace(/^\{|\}$/g, "")
    .trim();
  if (!/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(text)) return null;
  return text
    .replace(/\?\./g, ".")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".");
};

/** The segments that name the data: the input root and list positions left out. */
const namedSegments = (path: ReadonlyArray<string>): ReadonlyArray<string> => {
  const rest = path.length > 1 && ROOTS.has(path[0]!) ? path.slice(1) : path;
  return rest.filter((segment) => !/^\d+$/.test(segment));
};

/** `shortName` → ["short", "name"], `claimURL` → ["claim", "URL"], `first_name` → ["first", "name"]. */
const words = (segment: string): ReadonlyArray<string> =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((word) => word !== "");

/**
 * What an author calls a binding: `input.product.shortName` → "Product short name",
 * `input.firstName` → "First name". A segment repeated by the next one is said once
 * (`input.product.productName` → "Product name").
 */
export const bindingName = (path: ReadonlyArray<string>): string => {
  const said: string[] = [];
  for (const segment of namedSegments(path)) {
    const next = words(segment).map((word) => word.toLowerCase());
    const overlap = said.length > 0 && next[0] === said.at(-1) ? 1 : 0;
    said.push(...next.slice(overlap));
  }
  return said.length === 0 ? "Data" : sentence(said);
};

type Parsed = ReturnType<typeof parseExpression>;
type ObjectNode = Extract<Parsed, { readonly type: "ObjectExpression" }>;
type PropertyNode = Extract<ObjectNode["properties"][number], { readonly type: "ObjectProperty" }>;
/** Any node a fixture value can be: an expression, or what an object property holds. */
type ValueNode = Parsed | PropertyNode["value"];

const keyOf = (property: PropertyNode): string | null => {
  if (property.computed) return null;
  const key = property.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral" || key.type === "NumericLiteral") return String(key.value);
  return null;
};

const member = (value: ValueNode, segment: string): ValueNode | null => {
  switch (value.type) {
    case "ObjectExpression": {
      const property = value.properties.find(
        (item): item is PropertyNode => item.type === "ObjectProperty" && keyOf(item) === segment,
      );
      return property?.value ?? null;
    }
    case "ArrayExpression": {
      if (!/^\d+$/.test(segment)) return null;
      const item = value.elements[Number(segment)];
      return item === undefined || item === null || item.type === "SpreadElement" ? null : item;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return member(value.expression, segment);
    default:
      return null;
  }
};

const literal = (value: ValueNode): string | null => {
  switch (value.type) {
    case "StringLiteral":
    case "NumericLiteral":
      return String(value.value);
    case "BooleanLiteral":
      return value.value ? "true" : "false";
    case "TemplateLiteral":
      return value.expressions.length > 0 ? null : (value.quasis[0]?.value.cooked ?? null);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return literal(value.expression);
    default:
      return null;
  }
};

const parseFixture = (source: string): Parsed | null => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Babel parser boundary: a fixture that does not parse has no sample to show.
  try {
    return parseExpression(source, { plugins: ["typescript", "jsx"] });
  } catch {
    return null;
  }
};

/**
 * The value a fixture object (its source, as `inspectSourceFixtures` returns it) gives a binding
 * path, when it is written as a literal. A path under the input root is looked up from the
 * fixture's top; a loop variable's path (`item.name`) has no fixture key and gets no sample.
 */
export const fixtureSample = (
  fixtureSource: string,
  path: ReadonlyArray<string>,
): string | null => {
  const root = parseFixture(fixtureSource);
  if (root === null) return null;
  const segments = path.length > 1 && ROOTS.has(path[0]!) ? path.slice(1) : path;
  let value: ValueNode | null = root;
  for (const segment of segments) {
    value = value === null ? null : member(value, segment);
    if (value === null) return null;
  }
  return value === null ? null : literal(value);
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What each binding rendered as, read from the element's rendered text by taking away the typed
 * text around it. `parts` lists the content in order: typed text as a string, a binding as null.
 * A binding whose value cannot be told apart from its neighbour's (two in a row) is null.
 */
export const renderedSamples = (
  rendered: string,
  parts: ReadonlyArray<string | null>,
): ReadonlyArray<string | null> => {
  const normalize = (text: string) => text.replace(/\s+/g, " ");
  let pattern = "";
  const ambiguous: boolean[] = [];
  parts.forEach((part, index) => {
    if (part === null) {
      ambiguous.push(parts[index - 1] === null || parts[index + 1] === null);
      pattern += "(.*?)";
    } else pattern += normalize(part).split(" ").map(escapeRegExp).join("\\s*");
  });
  const match = new RegExp(`^\\s*${pattern}\\s*$`, "s").exec(normalize(rendered));
  return ambiguous.map((isAmbiguous, index) => {
    const value = match?.[index + 1]?.trim();
    return isAmbiguous || value === undefined || value === "" ? null : value;
  });
};
