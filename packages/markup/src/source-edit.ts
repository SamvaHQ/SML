import { parse } from "@babel/parser";

import { buildLineMap } from "./diagnostic-model";
import { isObject } from "./internal/guards";
import { checkStaticProfile, introducedProfileErrors } from "./sml/profile";
import type { JsxSourceLocation } from "./source-locations";

/** One exact source replacement; before text guards against concurrent changes. */
export interface SourceReplacement {
  readonly start: number;
  readonly end: number;
  readonly before: string;
  readonly after: string;
}
export type SourceEditResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly reason: string };
export interface SourceProperty {
  readonly name: string;
  readonly kind: "literal" | "binding" | "computed";
  readonly value: string;
  readonly literalType: "string" | "number" | "boolean";
  readonly start: number;
  readonly end: number;
  readonly syntax: "attribute" | "child" | "value";
}
export interface SourceElement {
  readonly start: number;
  readonly end: number;
  readonly contentStart: number | null;
  readonly contentEnd: number | null;
  readonly tag: string;
  readonly attributeInsertion: number;
  readonly hasSpread: boolean;
  readonly properties: readonly SourceProperty[];
  readonly structural: boolean;
  /** The JSX element sibling directly before / after this one, when both share a JSX parent. */
  readonly previous: SourceRange | null;
  readonly next: SourceRange | null;
}
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}
interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}
const node = (value: unknown): value is Node =>
  isObject(value) &&
  "type" in value &&
  typeof value.type === "string" &&
  "start" in value &&
  typeof value.start === "number" &&
  "end" in value &&
  typeof value.end === "number";
const children = (value: unknown): readonly Node[] =>
  Array.isArray(value) ? value.filter(node) : [];
const walk = (
  value: unknown,
  visit: (value: Node, parent: Node | null) => void,
  parent: Node | null = null,
): void => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, parent);
    return;
  }
  if (!node(value)) return;
  visit(value, parent);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "loc" && key !== "extra" && key !== "comments") walk(child, visit, value);
  }
};
const parsed = (source: string): Node | null => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Babel parser boundary: incomplete source is an unavailable visual operation.
  try {
    const result = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    return node(result) ? result : null;
  } catch {
    return null;
  }
};
const binding = (value: Node): boolean =>
  value.type === "Identifier" ||
  (value.type === "MemberExpression" &&
    value.computed === false &&
    node(value.object) &&
    binding(value.object));
/** JSX trims each line of text and joins the non-empty lines with one space. */
const collapseJsxText = (value: string): string =>
  value
    .split(/\r\n|\n|\r|\u2028|\u2029/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
const property = (
  name: string,
  value: Node,
  source: string,
  syntax: SourceProperty["syntax"],
): SourceProperty => {
  const expression =
    value.type === "JSXExpressionContainer" && node(value.expression) ? value.expression : value;
  const literal =
    expression.type === "StringLiteral" ||
    expression.type === "NumericLiteral" ||
    expression.type === "BooleanLiteral" ||
    expression.type === "JSXText";
  // JSX text keeps its surrounding whitespace outside the editable span.
  const raw = source.slice(expression.start, expression.end);
  const inset =
    expression.type === "JSXText"
      ? {
          start: expression.start + (raw.length - raw.trimStart().length),
          end: expression.end - (raw.length - raw.trimEnd().length),
        }
      : { start: value.start, end: value.end };
  return {
    name,
    literalType:
      expression.type === "NumericLiteral"
        ? "number"
        : expression.type === "BooleanLiteral"
          ? "boolean"
          : "string",
    kind: literal ? "literal" : binding(expression) ? "binding" : "computed",
    value:
      literal && expression.type === "JSXText" && typeof expression.value === "string"
        ? collapseJsxText(expression.value)
        : literal &&
            (typeof expression.value === "string" ||
              typeof expression.value === "number" ||
              typeof expression.value === "boolean")
          ? String(expression.value)
          : source.slice(expression.start, expression.end),
    start: inset.start,
    end: inset.end,
    syntax,
  };
};

/** The JSX elements directly before and after `element` in its parent's child list. */
const siblingsOf = (
  element: Node,
  parent: Node | null,
  source: string,
): Pick<SourceElement, "previous" | "next"> => {
  if (parent?.type !== "JSXElement" && parent?.type !== "JSXFragment")
    return { previous: null, next: null };
  const list = children(parent.children).filter(
    (child) => child.type !== "JSXText" || source.slice(child.start, child.end).trim() !== "",
  );
  const index = list.findIndex((child) => child.start === element.start);
  const range = (child: Node | undefined): SourceRange | null =>
    child?.type === "JSXElement" ? { start: child.start, end: child.end } : null;
  return { previous: range(list[index - 1]), next: range(list[index + 1]) };
};

/** Resolve a renderer origin against the unchanged authored entry, never against HTML offsets. */
export const inspectSourceElement = (
  source: string,
  file: string,
  origin: JsxSourceLocation,
): SourceElement | null => {
  if (file !== origin.fileName) return null;
  const tree = parsed(source);
  if (tree === null) return null;
  const lines = buildLineMap(source);
  const lineStart = lines[origin.lineNumber - 1];
  if (lineStart === undefined || !Number.isInteger(origin.columnNumber) || origin.columnNumber < 1)
    return null;
  const offset = lineStart + origin.columnNumber - 1;
  if (offset >= (lines[origin.lineNumber] ?? source.length)) return null;
  let found: SourceElement | null = null;
  walk(tree, (element, parent) => {
    if (element.type !== "JSXElement" || element.start !== offset || !node(element.openingElement))
      return;
    const opening = element.openingElement;
    const properties: SourceProperty[] = [];
    for (const attribute of children(opening.attributes)) {
      if (
        attribute.type === "JSXAttribute" &&
        node(attribute.name) &&
        typeof attribute.name.name === "string" &&
        node(attribute.value)
      ) {
        const value = attribute.value;
        const expression =
          value.type === "JSXExpressionContainer" && node(value.expression)
            ? value.expression
            : null;
        if (
          attribute.name.name === "style" &&
          expression?.type === "ObjectExpression" &&
          !children(expression.properties).some((member) => member.type === "SpreadElement")
        ) {
          for (const member of children(expression.properties)) {
            if (
              member.type !== "ObjectProperty" ||
              member.computed === true ||
              !node(member.key) ||
              !node(member.value)
            )
              continue;
            const key = member.key.type === "Identifier" ? member.key.name : member.key.value;
            if (typeof key === "string")
              properties.push(property(`style.${key}`, member.value, source, "value"));
          }
        } else properties.push(property(attribute.name.name, value, source, "attribute"));
      }
    }
    const meaningful = children(element.children).filter(
      (child) => child.type !== "JSXText" || source.slice(child.start, child.end).trim() !== "",
    );
    if (
      meaningful.length === 1 &&
      meaningful[0] !== undefined &&
      meaningful[0].type !== "JSXElement" &&
      meaningful[0].type !== "JSXFragment"
    ) {
      properties.unshift(property("children", meaningful[0], source, "child"));
    } else if (meaningful.length > 1) {
      // Mixed content: each run of authored text is its own literal, beside its bindings.
      const texts = meaningful.flatMap((child, index) =>
        child.type === "JSXText" ? [property(`text.${index}`, child, source, "child")] : [],
      );
      properties.unshift(...texts);
    }
    found = {
      start: element.start,
      end: element.end,
      contentStart: opening.selfClosing === true ? null : opening.end,
      contentEnd: node(element.closingElement) ? element.closingElement.start : null,
      tag: node(opening.name) ? source.slice(opening.name.start, opening.name.end) : "element",
      properties,
      attributeInsertion: (() => {
        const last = children(opening.attributes).at(-1);
        if (last !== undefined) return last.end;
        return node(opening.name) ? opening.name.end : opening.end - 1;
      })(),
      hasSpread: children(opening.attributes).some(
        (attribute) => attribute.type === "JSXSpreadAttribute",
      ),
      // Only siblings in a JSX child list can move or disappear without replacing control flow.
      structural: parent?.type === "JSXElement" || parent?.type === "JSXFragment",
      ...siblingsOf(element, parent, source),
    };
  });
  return found;
};

const PLAIN_JSX_TEXT = /^[^\s{}<>&](?:[^{}<>&\r\n\u2028\u2029]*[^\s{}<>&])?$/;

/** Literal controls cannot overwrite a binding or computed expression. */
export const literalReplacement = (
  source: string,
  field: SourceProperty,
  value: string,
): SourceReplacement | null => {
  if (field.kind !== "literal") return null;
  if (field.literalType === "number" && (value.trim() === "" || !Number.isFinite(Number(value))))
    return null;
  if (field.literalType === "boolean" && value !== "true" && value !== "false") return null;
  const literal =
    field.literalType === "string"
      ? JSON.stringify(value)
      : field.literalType === "number"
        ? String(Number(value))
        : value;
  const before = source.slice(field.start, field.end);
  // Plain JSX text stays plain when nothing in it needs an expression to be read back the same.
  const plainText =
    field.syntax === "child" && !before.startsWith("{") && PLAIN_JSX_TEXT.test(value);
  return {
    start: field.start,
    end: field.end,
    before,
    after: plainText
      ? value
      : field.syntax === "child" || (field.syntax === "attribute" && field.literalType !== "string")
        ? `{${literal}}`
        : literal,
  };
};

/** Explicit expression changes are proposals: callers show before/after and require Apply. */
export const expressionReplacement = (
  source: string,
  field: SourceProperty,
  expression: string,
): SourceReplacement => ({
  start: field.start,
  end: field.end,
  before: source.slice(field.start, field.end),
  after: field.syntax === "value" ? expression : `{${expression}}`,
});

/**
 * Where an edited file sits in its template project. Every edit of a template is checked against
 * the static profile: one that would leave it is refused, so a visual edit can never produce a
 * template the compiler rejects.
 */
export interface ProfileGuard {
  /** The template entry the profile check reads. */
  readonly entry: string;
  /** The file the edit changes; the entry when omitted. A partial names itself here. */
  readonly file?: string | undefined;
  /** The project's other files, when the edited file is not the entry. */
  readonly files?: Readonly<Record<string, string>> | undefined;
}
export interface ApplyOptions {
  readonly profile?: ProfileGuard | undefined;
}

const profileRefusal = (source: string, result: string, guard: ProfileGuard): string | null => {
  const file = guard.file ?? guard.entry;
  const project = (content: string) => ({ ...guard.files, [file]: content });
  const introduced = introducedProfileErrors(
    checkStaticProfile(project(source), guard.entry),
    checkStaticProfile(project(result), guard.entry),
  );
  const first = introduced[0];
  if (first === undefined) return null;
  const more = introduced.length > 1 ? ` (and ${introduced.length - 1} more)` : "";
  return `This change leaves the static profile: ${first.message}${first.fix === undefined ? "" : ` ${first.fix}`}${more}`;
};

/** Apply exact, nonoverlapping edits and refuse syntax damage without changing the original. */
export const applySourceReplacements = (
  source: string,
  edits: readonly SourceReplacement[],
  options: ApplyOptions = {},
): SourceEditResult => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let boundary = source.length;
  let result = source;
  for (const edit of sorted) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > boundary ||
      source.slice(edit.start, edit.end) !== edit.before
    ) {
      return {
        ok: false,
        reason: "Source changed at this target. Select it again before applying the edit.",
      };
    }
    result = result.slice(0, edit.start) + edit.after + result.slice(edit.end);
    boundary = edit.start;
  }
  if (parsed(result) === null)
    return { ok: false, reason: "This change is not valid TSX. Review it in Source." };
  if (options.profile !== undefined && result !== source) {
    const refusal = profileRefusal(source, result, options.profile);
    if (refusal !== null) return { ok: false, reason: refusal };
  }
  return { ok: true, source: result };
};

export type SourceProposal =
  | { readonly ok: true; readonly edits: readonly SourceReplacement[] }
  | { readonly ok: false; readonly reason: string };

const indentation = (source: string, offset: number): string | null => {
  const lineStart = Math.max(
    source.lastIndexOf("\n", offset - 1),
    source.lastIndexOf("\r", offset - 1),
  );
  const lead = source.slice(lineStart + 1, offset);
  return /^[ \t]*$/.test(lead) ? lead : null;
};

/** The whole lines an element alone occupies, so removing it leaves no blank line behind. */
const ownLines = (source: string, element: SourceRange): SourceRange => {
  if (indentation(source, element.start) === null) return element;
  const trailing = /^[ \t]*(\r\n|\n|\r)/.exec(source.slice(element.end));
  if (trailing === null) return element;
  return {
    start: element.start - (indentation(source, element.start) ?? "").length,
    end: element.end + trailing[0].length,
  };
};

/** Structural edits name a whole authored block; loop iterations are never source nodes. */
export const structuralReplacements = (
  source: string,
  element: SourceElement,
  operation:
    | { readonly kind: "delete" }
    | { readonly kind: "duplicate" }
    | { readonly kind: "reorder"; readonly direction: "before" | "after" }
    | { readonly kind: "insert"; readonly tsx: string }
    | { readonly kind: "move"; readonly destination: SourceElement },
): readonly SourceReplacement[] | null => {
  if (operation.kind === "insert") {
    if (element.contentEnd === null) return null;
    return [
      { start: element.contentEnd, end: element.contentEnd, before: "", after: operation.tsx },
    ];
  }
  if (!element.structural) return null;
  const text = source.slice(element.start, element.end);
  if (operation.kind === "duplicate") {
    const indent = indentation(source, element.start);
    return [
      {
        start: element.end,
        end: element.end,
        before: "",
        after: indent === null ? text : `\n${indent}${text}`,
      },
    ];
  }
  if (operation.kind === "reorder") {
    const neighbour = operation.direction === "before" ? element.previous : element.next;
    if (neighbour === null) return null;
    return [
      {
        start: neighbour.start,
        end: neighbour.end,
        before: source.slice(neighbour.start, neighbour.end),
        after: text,
      },
      {
        start: element.start,
        end: element.end,
        before: text,
        after: source.slice(neighbour.start, neighbour.end),
      },
    ];
  }
  const removal = ownLines(source, element);
  const removed = {
    start: removal.start,
    end: removal.end,
    before: source.slice(removal.start, removal.end),
    after: "",
  };
  if (operation.kind === "delete") return [removed];
  const destination = operation.destination.contentEnd;
  if (destination === null || (destination >= element.start && destination <= element.end))
    return null;
  return [removed, { start: destination, end: destination, before: "", after: text }];
};

export interface SourceFixture {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly source: string;
}
/** The object literal a top-level `const name = { ... }` holds. */
const topLevelObject = (tree: Node, name: string): Node | null => {
  const program = tree.program;
  if (!node(program)) return null;
  for (const item of children(program.body)) {
    const declaration =
      item.type === "ExportNamedDeclaration" && node(item.declaration) ? item.declaration : item;
    if (declaration.type !== "VariableDeclaration") continue;
    for (const declarator of children(declaration.declarations)) {
      if (
        node(declarator.id) &&
        declarator.id.name === name &&
        node(declarator.init) &&
        declarator.init.type === "ObjectExpression"
      )
        return declarator.init;
    }
  }
  return null;
};

/** Declared fixture values are separate source targets from body bindings and literals. */
export const inspectSourceFixtures = (source: string): readonly SourceFixture[] => {
  const tree = parsed(source);
  if (tree === null) return [];
  const found: SourceFixture[] = [];
  walk(tree, (call) => {
    if (
      call.type !== "CallExpression" ||
      !node(call.callee) ||
      call.callee.type !== "Identifier" ||
      call.callee.name !== "defineTemplate"
    )
      return;
    const definition = children(call.arguments)[0];
    if (definition?.type !== "ObjectExpression") return;
    const fixtures = children(definition.properties).find(
      (field) =>
        field.type === "ObjectProperty" &&
        node(field.key) &&
        field.key.name === "fixtures" &&
        field.computed !== true,
    );
    if (
      fixtures === undefined ||
      !node(fixtures.value) ||
      fixtures.value.type !== "ObjectExpression"
    )
      return;
    for (const field of children(fixtures.value.properties)) {
      if (
        field.type !== "ObjectProperty" ||
        field.computed === true ||
        !node(field.key) ||
        !node(field.value)
      )
        continue;
      const name = field.key.type === "Identifier" ? field.key.name : field.key.value;
      // A fixture written as a named constant is edited where the constant is declared.
      const value =
        field.value.type === "Identifier" && typeof field.value.name === "string"
          ? (topLevelObject(tree, field.value.name) ?? field.value)
          : field.value;
      if (typeof name === "string")
        found.push({
          name,
          start: value.start,
          end: value.end,
          source: source.slice(value.start, value.end),
        });
    }
  });
  return found;
};

export type ClassNameOperation =
  | { readonly kind: "set"; readonly value: string }
  | { readonly kind: "add"; readonly tokens: string }
  | { readonly kind: "remove"; readonly tokens: string };

const tokens = (value: string): readonly string[] =>
  value.split(/\s+/).filter((item) => item !== "");

/**
 * Edit an element's class list where it is written. A literal `className` is replaced, extended or
 * trimmed in place; a missing one is added; one that is a condition or any other expression is
 * refused, because rewriting it would discard the choice the author encoded.
 */
export const classNameEdit = (
  source: string,
  element: SourceElement,
  operation: ClassNameOperation,
): SourceProposal => {
  const field = element.properties.find((item) => item.name === "className");
  const next = (current: readonly string[]): string => {
    if (operation.kind === "set") return tokens(operation.value).join(" ");
    const wanted = tokens(operation.tokens);
    return operation.kind === "add"
      ? [...current, ...wanted.filter((item) => !current.includes(item))].join(" ")
      : current.filter((item) => !wanted.includes(item)).join(" ");
  };
  if (field === undefined) {
    if (element.hasSpread)
      return {
        ok: false,
        reason:
          "A spread attribute can supply className here, so a class list cannot be added safely. Edit it in Source.",
      };
    if (operation.kind === "remove") return { ok: true, edits: [] };
    const value = next([]);
    if (value === "") return { ok: true, edits: [] };
    return {
      ok: true,
      edits: [
        {
          start: element.attributeInsertion,
          end: element.attributeInsertion,
          before: "",
          after: ` className=${JSON.stringify(value)}`,
        },
      ],
    };
  }
  if (field.kind !== "literal" || field.literalType !== "string")
    return {
      ok: false,
      reason: `className is ${field.kind === "binding" ? "bound to" : "computed from"} \`${field.value}\`, so editing it would discard that choice. Change the literal classes inside it in Source.`,
    };
  const value = next(tokens(field.value));
  return {
    ok: true,
    edits: [
      {
        start: field.start,
        end: field.end,
        before: source.slice(field.start, field.end),
        after: JSON.stringify(value),
      },
    ],
  };
};
