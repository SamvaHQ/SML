import { parse, parseExpression } from "@babel/parser";

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

type Program = ReturnType<typeof parse>["program"];
type Statement = Program["body"][number];

/** The template's input schema as written: the object `defineTemplate`'s `schema` holds. */
export type InputSchemaNode = ValueNode;

const parseModule = (source: string): Program | null => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Babel parser boundary: an entry that does not parse names its bindings from their paths.
  try {
    return parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
  } catch {
    return null;
  }
};

/** The expressions a top-level statement evaluates: an export, a declaration's initializers. */
const statementValues = (statement: Statement): ReadonlyArray<ValueNode> => {
  switch (statement.type) {
    case "ExportDefaultDeclaration":
      return statement.declaration.type === "CallExpression" ||
        statement.declaration.type === "Identifier"
        ? [statement.declaration]
        : [];
    case "ExportNamedDeclaration":
      return statement.declaration?.type === "VariableDeclaration"
        ? statement.declaration.declarations.flatMap((item) =>
            item.init == null ? [] : [item.init],
          )
        : [];
    case "VariableDeclaration":
      return statement.declarations.flatMap((item) => (item.init == null ? [] : [item.init]));
    case "ExpressionStatement":
      return [statement.expression];
    default:
      return [];
  }
};

/** The initializer of a top-level `const name = …`. */
const topLevelConst = (program: Program, name: string): ValueNode | null => {
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations)
      if (item.id.type === "Identifier" && item.id.name === name && item.init != null)
        return item.init;
  }
  return null;
};

/** `jsonSchema<T>({ … })`, a named constant, or an object with `as`/`satisfies`: the object. */
const schemaObject = (program: Program, value: ValueNode, depth = 0): ValueNode | null => {
  if (depth > 4) return null;
  switch (value.type) {
    case "ObjectExpression":
      return value;
    case "CallExpression": {
      const first = value.arguments[0];
      return first === undefined ||
        first.type === "SpreadElement" ||
        first.type === "ArgumentPlaceholder"
        ? null
        : schemaObject(program, first, depth + 1);
    }
    case "Identifier": {
      const init = topLevelConst(program, value.name);
      return init === null ? null : schemaObject(program, init, depth + 1);
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return schemaObject(program, value.expression, depth + 1);
    default:
      return null;
  }
};

/** The input schema an entry's `defineTemplate({ schema })` declares, or null without one. */
export const inputSchemaOf = (entrySource: string): InputSchemaNode | null => {
  const program = parseModule(entrySource);
  if (program === null) return null;
  for (const statement of program.body)
    for (const value of statementValues(statement)) {
      const call =
        value.type === "Identifier"
          ? topLevelConst(program, value.name)
          : (value as ValueNode | null);
      if (
        call?.type !== "CallExpression" ||
        call.callee.type !== "Identifier" ||
        call.callee.name !== "defineTemplate"
      )
        continue;
      const definition = call.arguments[0];
      if (definition?.type !== "ObjectExpression") continue;
      const schema = member(definition, "schema");
      return schema === null ? null : schemaObject(program, schema);
    }
  return null;
};

/**
 * The `title` the input schema gives a bound path, walking `properties` (and `items` for a list
 * position) from the input root. A path outside the input (a loop variable) has none.
 */
export const schemaTitle = (
  schema: InputSchemaNode | null,
  path: ReadonlyArray<string>,
): string | null => {
  if (schema === null || path.length < 2 || !ROOTS.has(path[0]!)) return null;
  let node: ValueNode | null = schema;
  for (const segment of path.slice(1)) {
    if (node === null) return null;
    if (/^\d+$/.test(segment)) {
      node = member(node, "items");
      continue;
    }
    const properties = member(node, "properties");
    node = properties === null ? null : member(properties, segment);
  }
  if (node === null) return null;
  const title = member(node, "title");
  const text = title === null ? null : literal(title)?.trim();
  return text === undefined || text === null || text === "" ? null : text;
};
