import type { EmailNode } from "./jsx-runtime";

// Selector matching at render time. Selectors are compiled once at build time
// (see `compileSelector` in ./css, which needs css-tree) and travel with the
// stylesheet as plain data, so the isolated render host carries a matcher and
// no parser.

export type EmailElementNode = Extract<EmailNode, { type: "Element" }>;

export interface AttributeTest {
  readonly name: string;
  readonly operator?: string | undefined;
  readonly value?: string | undefined;
}

export interface Compound {
  readonly tag?: string | undefined;
  readonly id?: string | undefined;
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeTest[];
  /** A compound the matcher cannot evaluate — a pseudo-class, say — never matches. */
  readonly opaque: boolean;
}

export type Combinator = "descendant" | "child" | "adjacent" | "sibling";

export interface CompiledSelector {
  /** Document order, left to right; each part names the combinator that follows it. */
  readonly parts: readonly { readonly compound: Compound; readonly after?: Combinator }[];
}

/** An element together with the ancestors and preceding siblings a combinator needs. */
export interface Ancestry {
  readonly element: EmailElementNode;
  readonly parent: Ancestry | undefined;
  readonly previous: readonly EmailElementNode[];
}

export const classListOf = (element: EmailElementNode): readonly string[] => {
  const value = element.props.class ?? element.props.className;
  return typeof value === "string" ? value.split(/\s+/).filter((name) => name !== "") : [];
};

const attributeOf = (element: EmailElementNode, name: string): string | undefined => {
  const value = element.props[name];
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return "";
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
};

const matchesAttribute = (element: EmailElementNode, test: AttributeTest): boolean => {
  const actual =
    test.name === "class" ? classListOf(element).join(" ") : attributeOf(element, test.name);
  if (actual === undefined) return false;
  if (test.operator === undefined || test.value === undefined) return true;
  switch (test.operator) {
    case "=":
      return actual === test.value;
    case "~=":
      return actual.split(/\s+/).includes(test.value);
    case "^=":
      return actual.startsWith(test.value);
    case "$=":
      return actual.endsWith(test.value);
    case "*=":
      return actual.includes(test.value);
    case "|=":
      return actual === test.value || actual.startsWith(`${test.value}-`);
    default:
      return false;
  }
};

const matchesCompound = (element: EmailElementNode, compound: Compound): boolean => {
  if (compound.opaque) return false;
  if (compound.tag !== undefined && compound.tag !== element.tag) return false;
  if (compound.id !== undefined && attributeOf(element, "id") !== compound.id) return false;
  if (compound.classes.length > 0) {
    const classes = classListOf(element);
    if (!compound.classes.every((name) => classes.includes(name))) return false;
  }
  return compound.attributes.every((test) => matchesAttribute(element, test));
};

const matchesFrom = (
  selector: CompiledSelector,
  index: number,
  ancestry: Ancestry | undefined,
): boolean => {
  if (ancestry === undefined) return false;
  const part = selector.parts[index];
  if (part === undefined) return false;
  if (!matchesCompound(ancestry.element, part.compound)) return false;
  const left = selector.parts[index - 1];
  if (left === undefined) return true;
  switch (left.after ?? "descendant") {
    case "child":
      return matchesFrom(selector, index - 1, ancestry.parent);
    case "descendant": {
      for (let parent = ancestry.parent; parent !== undefined; parent = parent.parent)
        if (matchesFrom(selector, index - 1, parent)) return true;
      return false;
    }
    case "adjacent": {
      const sibling = ancestry.previous.at(-1);
      return sibling === undefined
        ? false
        : matchesFrom(selector, index - 1, {
            element: sibling,
            parent: ancestry.parent,
            previous: ancestry.previous.slice(0, -1),
          });
    }
    case "sibling": {
      for (let position = ancestry.previous.length - 1; position >= 0; position--)
        if (
          matchesFrom(selector, index - 1, {
            element: ancestry.previous[position]!,
            parent: ancestry.parent,
            previous: ancestry.previous.slice(0, position),
          })
        )
          return true;
      return false;
    }
  }
};

/** Match a compiled selector against one element in its tree position. */
export const matchesSelector = (
  selector: CompiledSelector | undefined,
  ancestry: Ancestry,
): boolean =>
  selector === undefined || selector.parts.length === 0
    ? false
    : matchesFrom(selector, selector.parts.length - 1, ancestry);
