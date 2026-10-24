import { isObject } from "../internal/guards";
import type { JsxSourceLocation } from "../source-locations";
import type { CssDeclaration, CssRule, Specificity, Stylesheet } from "./css";
import { downlevelMediaQuery, finalizeValue, renderHeadCss } from "./css-values";
import { DARK_SCHEME_MEDIA, withinDarkScheme } from "./dark-scheme";
import type { EmailDiagnostic } from "./diagnostics";
import { fontFallbackDiagnostic, fontShorthandFamilies, lacksGenericFallback } from "./font-stacks";
import { declarationValue, escapeAttribute, kebab } from "./html";
import { EmailNode } from "./jsx-runtime";
import { classListOf, matchesSelector, type Ancestry, type EmailElementNode } from "./selectors";

// Declarations are resolved against the semantic tree, not against serialized
// HTML. The tree is what carries `origins`, so a finding about a declaration can
// still name the authoring element, and a preview can still select it. Matching
// runs over the same node identities the serializer will emit, against selectors
// the build already compiled — the render lane carries no CSS parser.

const VARIABLE_REFERENCE = /var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g;

/**
 * Compatibility markup a primitive emits (a Button's VML) and a presentational
 * `bgcolor` attribute are not CSS, so no client resolves `var()` in them. Their
 * theme variables resolve here, in the scope of the element they sit in, as a
 * declaration on that element would.
 */
const resolveMarkupVariables = (
  markup: string,
  variables: Readonly<Record<string, string>>,
): string =>
  markup.replace(VARIABLE_REFERENCE, (reference) => {
    const value = finalizeValue(reference, variables);
    return value === reference ? reference : escapeAttribute(value);
  });

/**
 * Cascade rank as the tuple CSS actually sorts by: importance first, then
 * whether the declaration is attached to the element itself, then layer, then
 * specificity, then order of appearance down to the declaration. Normal
 * declarations sort by layer ascending (unlayered last, so it wins); important
 * declarations reverse the layer order, which is why the layer term is negated
 * for them. Element-attached declarations are compared before layers and
 * specificity, so an author's important inline value beats an important
 * stylesheet declaration exactly as it does in a browser. Two declarations never
 * tie: rule order is unique across every registered sheet, and the position
 * inside a rule separates the declarations that share it.
 */
const rank = (
  important: boolean,
  attached: boolean,
  layer: number,
  specificity: Specificity,
  order: number,
  position: number,
): readonly number[] => [
  important ? 1 : 0,
  attached ? 1 : 0,
  important ? -layer : layer,
  specificity[0],
  specificity[1],
  specificity[2],
  order,
  position,
];

const compareRank = (left: readonly number[], right: readonly number[]): number => {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
};

const outranks = (left: readonly number[], right: readonly number[]): boolean =>
  compareRank(left, right) >= 0;

/** An authored `style` object becomes declarations with the same normalization the serializer uses. */
const inlineDeclarations = (style: unknown): readonly CssDeclaration[] => {
  if (!isObject(style) || Array.isArray(style)) return [];
  const output: CssDeclaration[] = [];
  for (const [property, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = declarationValue(property, value);
    const important = /!important\s*$/i.test(text);
    output.push({
      property: kebab(property),
      value: important ? text.replace(/\s*!important\s*$/i, "") : text,
      important,
    });
  }
  return output;
};

interface WritingContext {
  readonly direction: string;
  readonly writingMode: string;
}

const horizontalWriting: WritingContext = { direction: "ltr", writingMode: "horizontal-tb" };

// Split the one/two-value axis shorthands without splitting spaces inside calc().
const paddingValues = (value: string): readonly string[] => {
  const values: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (/\s/.test(character!) && depth === 0) {
      if (index > start) values.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (start < value.length) values.push(value.slice(start));
  return values;
};

const physicalPadding = (
  property: string,
  value: string,
  context: WritingContext,
): readonly (readonly [string, string])[] => {
  const original = [[property, value]] as const;
  const match = /^padding-(inline|block)(?:-(start|end))?$/.exec(property);
  if (
    match === null ||
    context.writingMode !== "horizontal-tb" ||
    !["ltr", "rtl"].includes(context.direction) ||
    /^(inherit|revert|revert-layer)$/.test(value) ||
    value.includes("var(")
  )
    return original;
  const values = paddingValues(value.trim());
  if (values.length < 1 || values.length > (match[2] === undefined ? 2 : 1)) return original;
  const sides =
    match[1] === "block"
      ? ["top", "bottom"]
      : context.direction === "rtl"
        ? ["right", "left"]
        : ["left", "right"];
  if (match[2] !== undefined)
    return [[`padding-${sides[match[2] === "start" ? 0 : 1]}`, values[0]!]];
  return [
    [`padding-${sides[0]}`, values[0]!],
    [`padding-${sides[1]}`, values[1] ?? values[0]!],
  ];
};

export interface AppliedStyles {
  readonly tree: EmailNode;
  /** Rules that could not be inlined, ready for a `<style>` element in `<head>` after `darkRules`. */
  readonly headCss: string;
  /**
   * A generated class for each distinct set of dark-mode declarations, mapped
   * to those declarations. An element whose inlined styles read a color the
   * theme's dark-mode block redefines carries the class.
   */
  readonly darkRules: ReadonlyMap<string, string>;
  /** Project `@font-face` rules, for a `<head>` style classic Outlook cannot see. */
  readonly fontFaceCss: string;
  readonly diagnostics: readonly EmailDiagnostic[];
}

/** Generated dark-mode classes share this prefix; it is reserved for the compiler. */
export const DARK_CLASS_PREFIX = "sml-dark-";

/**
 * Generated lock classes share this prefix; it is reserved for the compiler.
 * An important color the dark-mode class restates is inlined without
 * `!important`, so a weaker retained rule (also marked `!important`) would
 * otherwise take it. The lock class carries that color on a more specific copy
 * of the retained selector.
 */
const LOCK_CLASS_PREFIX = "sml-lock-";

/** FNV-1a, 32-bit, so equal declaration sets share one class and builds are stable. */
const classSuffix = (body: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index++) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/** A class named for its declarations, so equal sets share one rule and builds are stable. */
const darkClassName = (body: string): string => `${DARK_CLASS_PREFIX}${classSuffix(body)}`;

const SIDES = ["top", "right", "bottom", "left"] as const;
const BORDER_PARTS = ["width", "style", "color"] as const;
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
const BORDER_IMAGE = ["source", "slice", "width", "outset", "repeat"].map(
  (part) => `border-image-${part}`,
);

/**
 * The longhands a border property writes: `border` writes the twelve per-side longhands and
 * resets the border image, `border-top` the top three, `border-color` the four colors,
 * `border-radius` the four corners.
 * `undefined` for a property outside the border box.
 */
const borderLonghands = (property: string): readonly string[] | undefined => {
  if (property === "border")
    return [
      ...SIDES.flatMap((side) => BORDER_PARTS.map((part) => `border-${side}-${part}`)),
      ...BORDER_IMAGE,
    ];
  if (property === "border-image") return BORDER_IMAGE;
  if (property === "border-radius") return CORNERS.map((corner) => `border-${corner}-radius`);
  const side = /^border-(top|right|bottom|left)$/.exec(property)?.[1];
  if (side !== undefined) return BORDER_PARTS.map((part) => `border-${side}-${part}`);
  const part = /^border-(width|style|color)$/.exec(property)?.[1];
  if (part !== undefined) return SIDES.map((each) => `border-${each}-${part}`);
  return property.startsWith("border-") ? [property] : undefined;
};

/**
 * Whether two declarations can override one another because they write a property in common:
 * `background` and `background-color`, `border-color` and `border-top`, `font` and `line-height`.
 * `border-radius` shares nothing with `border-color`.
 */
const overlaps = (left: string, right: string): boolean => {
  if (left === right) return true;
  const leftBorder = borderLonghands(left);
  const rightBorder = borderLonghands(right);
  if (leftBorder !== undefined || rightBorder !== undefined)
    return (
      leftBorder !== undefined &&
      rightBorder !== undefined &&
      leftBorder.some((longhand) => rightBorder.includes(longhand))
    );
  const sets = (shorthand: string, longhand: string) =>
    longhand.startsWith(`${shorthand}-`) || (shorthand === "font" && longhand === "line-height");
  return sets(left, right) || sets(right, left);
};

/** Add a class to an element's props, whichever of `class` and `className` it uses. */
const withClass = (
  props: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> => {
  const key =
    typeof props.class === "string" || props.className === undefined ? "class" : "className";
  const current = props[key];
  return {
    ...props,
    [key]: typeof current === "string" && current.trim() !== "" ? `${current} ${name}` : name,
  };
};

interface LockedDeclaration {
  readonly property: string;
  readonly light: string;
  readonly dark: string;
  readonly key: readonly number[];
}

/** Index where the subject compound starts, after the last combinator. */
const subjectSplit = (selector: string): number | undefined => {
  let depth = 0;
  let split = 0;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (character === ">" || character === "+" || character === "~"))
      split = index + 1;
    else if (depth === 0 && character === " ") split = index + 1;
  }
  return selector.slice(split).trim() === "" ? undefined : split;
};

/** Single-colon names that still select a pseudo-element, not a pseudo-class. */
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/**
 * A pseudo-element is a different box. An important color on the element does
 * not override a color the pseudo-element sets for itself, so a lock guard must
 * not be copied onto `::before`.
 */
const targetsPseudoElement = (selector: string): boolean => {
  const split = subjectSplit(selector);
  if (split === undefined) return false;
  const subject = selector.slice(split);
  let depth = 0;
  for (let index = 0; index < subject.length; index++) {
    const character = subject[index];
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (depth !== 0 || character !== ":") continue;
    if (subject[index + 1] === ":") return true;
    const name = /^:([A-Za-z-]+)/.exec(subject.slice(index))?.[1]?.toLowerCase();
    if (name !== undefined && LEGACY_PSEUDO_ELEMENTS.has(name)) return true;
  }
  return false;
};

/** Insert `className` into the subject compound, before its first pseudo. */
const strengthenSelector = (selector: string, className: string): string | undefined => {
  const split = subjectSplit(selector);
  if (split === undefined) return undefined;
  const subject = selector.slice(split);
  const token = `.${className}`;
  let depth = 0;
  let pseudo = -1;
  for (let index = 0; index < subject.length; index++) {
    const character = subject[index];
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && character === ":") {
      pseudo = index;
      break;
    }
  }
  const strengthened =
    pseudo < 0
      ? `${subject}${token}`
      : `${subject.slice(0, pseudo)}${token}${subject.slice(pseudo)}`;
  return `${selector.slice(0, split)}${strengthened}`;
};

const retainedKey = (
  rule: CssRule,
  declaration: CssDeclaration,
  position: number,
): readonly number[] =>
  rank(declaration.important, false, rule.layer, rule.specificity, rule.order, position);

/** Whether `item` wins the real cascade over this rule's overlapping declaration. */
const threatens = (item: LockedDeclaration, rule: CssRule): boolean =>
  rule.declarations.some(
    (declaration, position) =>
      overlaps(declaration.property, item.property) &&
      compareRank(item.key, retainedKey(rule, declaration, position)) > 0,
  );

const nestConditions = (conditions: readonly string[], body: string): string =>
  conditions.reduceRight((inner, condition) => `${condition}{${inner}}`, body);

/**
 * Restate important colors that were inlined without `!important` on a copy of
 * each weaker retained selector. The copy carries one more class, so it beats
 * the retained rule, and the dark-scheme copy of it keeps the theme switch.
 * A rule that outranks the themed color is copied again afterwards, on that
 * same class, so the guard does not bury it. Pseudo-elements are left alone:
 * their color is not the element's.
 */
const renderLockGuards = (
  locks: ReadonlyMap<string, readonly LockedDeclaration[]>,
  rules: readonly CssRule[],
  variables: Readonly<Record<string, string>>,
  darkVariables: Readonly<Record<string, string>>,
): string => {
  const seen = new Set<string>();
  const blocks: string[] = [];
  const guarded = new Set<string>();
  const darkQuery = DARK_SCHEME_MEDIA.replace(": ", ":");
  const emit = (wrapping: readonly string[], selector: string, body: string) => {
    const block = nestConditions(wrapping, `${selector}{${body}}`);
    if (seen.has(block)) return;
    seen.add(block);
    blocks.push(block);
  };
  for (const rule of rules) {
    if (targetsPseudoElement(rule.selector)) continue;
    const conditions = rule.conditions.map(downlevelMediaQuery);
    for (const [className, declarations] of locks) {
      const beaten = declarations.filter((item) => threatens(item, rule));
      if (beaten.length === 0) continue;
      const selector = strengthenSelector(rule.selector, className);
      if (selector === undefined) continue;
      const inDark = withinDarkScheme(conditions);
      const lightBody = beaten.map((item) => `${item.property}:${item.light}!important`).join(";");
      const darkBody = beaten.map((item) => `${item.property}:${item.dark}!important`).join(";");
      if (!inDark) emit(conditions, selector, lightBody);
      emit(inDark ? conditions : [...conditions, darkQuery], selector, darkBody);
      guarded.add(className);
    }
  }
  // A stronger rule, such as an important hover beside a normal one, has to
  // stay ahead of the guard that the weaker rule produced.
  for (const [className, declarations] of locks) {
    if (!guarded.has(className)) continue;
    for (const rule of rules) {
      if (targetsPseudoElement(rule.selector)) continue;
      const winning = rule.declarations.filter((declaration, position) =>
        declarations.some(
          (item) =>
            overlaps(declaration.property, item.property) &&
            compareRank(retainedKey(rule, declaration, position), item.key) > 0,
        ),
      );
      if (winning.length === 0) continue;
      const selector = strengthenSelector(rule.selector, className);
      if (selector === undefined) continue;
      const conditions = rule.conditions.map(downlevelMediaQuery);
      const scope = withinDarkScheme(conditions) ? { ...variables, ...darkVariables } : variables;
      const body = winning
        .map(
          (declaration) =>
            `${declaration.property}:${finalizeValue(declaration.value, scope)}!important`,
        )
        .join(";");
      emit(conditions, selector, body);
    }
  }
  return blocks.join("");
};

/** The generated dark-mode classes as one `@media (prefers-color-scheme:dark)` block, written as the head CSS writes its media queries. */
export const renderDarkRules = (rules: ReadonlyMap<string, string>): string =>
  rules.size === 0
    ? ""
    : `${DARK_SCHEME_MEDIA.replace(": ", ":")}{${[...rules]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, body]) => `.${name}{${body}}`)
        .join("")}}`;

/**
 * Resolve every stylesheet against the tree: inline what a client will honor on
 * the element, and keep the rest for `<head>`. Where the sheet has a dark-mode
 * theme, an element whose inlined styles read a color it redefines also gets a
 * generated class whose dark-mode rule restates those styles at their dark
 * values.
 */
export const applyStylesheet = (
  root: EmailNode,
  sheet: Stylesheet,
  options: { readonly knownClasses?: ReadonlySet<string> } = {},
): AppliedStyles => {
  const diagnostics: EmailDiagnostic[] = [...sheet.diagnostics];
  const hasDarkTheme = Object.keys(sheet.darkVariables).length > 0;
  const darkRules = new Map<string, string>();
  const darkClassFor = (declarations: readonly (readonly [string, string])[]): string => {
    const body = declarations
      .map(([property, value]) => `${property}:${value}!important`)
      .join(";");
    const name = darkClassName(body);
    darkRules.set(name, body);
    return name;
  };
  const inlinable: CssRule[] = [];
  const retained: CssRule[] = [];
  const styledClasses = new Set<string>();
  for (const rule of sheet.rules) {
    (rule.inlinable ? inlinable : retained).push(rule);
    for (const name of rule.classes) styledClasses.add(name);
  }
  const locks = new Map<string, readonly LockedDeclaration[]>();
  const lockClassFor = (declarations: readonly LockedDeclaration[]): string | undefined => {
    if (
      !declarations.some((item) =>
        retained.some((rule) => !targetsPseudoElement(rule.selector) && threatens(item, rule)),
      )
    )
      return undefined;
    const body = declarations
      .map((item) => `${item.property}:${item.light}=${item.dark}@${item.key.join(".")}`)
      .join(";");
    const name = `${LOCK_CLASS_PREFIX}${classSuffix(body)}`;
    locks.set(name, declarations);
    return name;
  };
  // Only matching elements and their descendants inherit a conditional writing
  // context. An opaque selector cannot safely exclude any element.
  const conditionalWritingRules = retained.filter((rule) =>
    rule.declarations.some(
      (declaration) =>
        declaration.property === "direction" ||
        declaration.property === "writing-mode" ||
        declaration.property === "all",
    ),
  );
  const unmatched = new Map<string, JsxSourceLocation[]>();
  // A stack naming a project font must end in a generic; each distinct stack is
  // reported once, at the first element that uses it.
  const declaredFamilies = new Set(sheet.fontFaces.map((face) => face.family.toLowerCase()));
  const fallbackFindings = new Map<string, readonly JsxSourceLocation[]>();
  const checkFallback = (
    property: string,
    value: string,
    origins: readonly JsxSourceLocation[],
  ): void => {
    if (declaredFamilies.size === 0) return;
    const stack =
      property === "font-family"
        ? value
        : property === "font"
          ? fontShorthandFamilies(value)
          : undefined;
    if (stack === undefined || fallbackFindings.has(stack)) return;
    if (lacksGenericFallback(stack, declaredFamilies)) fallbackFindings.set(stack, origins);
  };
  /**
   * Children are visited with their own preceding-sibling list so `+`/`~` work.
   * A fragment is not an element in the serialized document, so its children
   * join that same list rather than starting a new one.
   */
  const visitChildren = (
    children: readonly EmailNode[],
    ancestry: Ancestry | undefined,
    variables: Readonly<Record<string, string>>,
    darkScope: Readonly<Record<string, string>>,
    writing: WritingContext,
  ): readonly EmailNode[] => {
    const previous: EmailElementNode[] = [];
    const visit = (nodes: readonly EmailNode[]): readonly EmailNode[] =>
      nodes.map((child) => {
        if (child.type === "Element") {
          const result = applyTo(
            child,
            { element: child, parent: ancestry, previous: [...previous] },
            variables,
            darkScope,
            writing,
          );
          previous.push(child);
          return result;
        }
        if (child.type === "Fragment")
          return EmailNode.Fragment({ ...child, children: visit(child.children) });
        if (child.type === "Raw" && child.html.includes("var("))
          return EmailNode.Raw({ ...child, html: resolveMarkupVariables(child.html, variables) });
        return child;
      });
    return visit(children);
  };

  /**
   * `inherited` is the custom-property scope this element sees from its
   * ancestors, rooted in the sheet's unconditional properties. Custom properties
   * cascade like any other declaration and then inherit, so a `--brand` declared
   * on `.card` has to reach `var(--brand)` on `.card` and everything under it.
   */
  const applyTo = (
    element: EmailElementNode,
    ancestry: Ancestry,
    inherited: Readonly<Record<string, string>>,
    inheritedDark: Readonly<Record<string, string>>,
    inheritedWriting: WritingContext,
  ): EmailNode => {
    const conditionalWriting = conditionalWritingRules.some((rule) => {
      if (
        rule.matcher === undefined ||
        rule.matcher.parts.length === 0 ||
        rule.matcher.parts.some((part) => part.compound.opaque)
      )
        return true;
      for (
        let context: Ancestry | undefined = ancestry;
        context !== undefined;
        context = context.parent
      )
        if (matchesSelector(rule.matcher, context)) return true;
      return false;
    });
    const winners = new Map<string, { value: string; key: readonly number[] }>();
    const claim = (declaration: CssDeclaration, key: readonly number[]) => {
      const current = winners.get(declaration.property);
      if (current === undefined || outranks(key, current.key))
        // The value stays as authored until the element's own custom-property
        // scope is known; resolving it here would only ever see the root's.
        winners.set(declaration.property, { value: declaration.value, key });
    };
    for (const rule of inlinable) {
      if (!matchesSelector(rule.matcher, ancestry)) continue;
      for (const [position, declaration] of rule.declarations.entries())
        claim(
          declaration,
          rank(declaration.important, false, rule.layer, rule.specificity, rule.order, position),
        );
    }
    for (const [position, declaration] of inlineDeclarations(element.props.style).entries())
      claim(declaration, rank(declaration.important, true, 0, [0, 0, 0], 0, position));
    for (const name of classListOf(element))
      if (!styledClasses.has(name) && options.knownClasses?.has(name) !== true)
        unmatched.set(name, [...(unmatched.get(name) ?? []), ...element.origins]);

    const declared: Record<string, string> = {};
    for (const [property, entry] of winners)
      if (property.startsWith("--")) declared[property] = entry.value;
    const variables =
      Object.keys(declared).length === 0 ? inherited : { ...inherited, ...declared };
    // A custom property declared on an element holds in both modes, as it would in a browser.
    const darkScope =
      Object.keys(declared).length === 0 ? inheritedDark : { ...inheritedDark, ...declared };
    const inheritedValue = (
      property: string,
      parent: string,
      initial: string,
      fallback = parent,
    ): string => {
      const value = winners.get(property)?.value;
      if (value === undefined) return fallback;
      const resolved = finalizeValue(value, variables);
      return resolved === "inherit" || resolved === "unset"
        ? parent
        : resolved === "initial"
          ? initial
          : resolved;
    };
    const writing: WritingContext = {
      direction: inheritedValue(
        "direction",
        inheritedWriting.direction,
        "ltr",
        typeof element.props.dir === "string"
          ? element.props.dir
          : element.tag === "bdi"
            ? "auto"
            : inheritedWriting.direction,
      ),
      writingMode: winners.has("all")
        ? "unknown"
        : inheritedValue("writing-mode", inheritedWriting.writingMode, "horizontal-tb"),
    };
    // Dark mode restates every inlined declaration whose color changes, plus
    // every winner that overlaps one, so the generated class can replay the
    // cascade. Computed before inlining: those properties must not carry
    // `!important` on the element, or the class cannot override them.
    const restated = new Set<string>();
    if (hasDarkTheme) {
      for (const [property, entry] of winners) {
        if (property.startsWith("--") || !entry.value.includes("var(")) continue;
        if (finalizeValue(entry.value, darkScope) !== finalizeValue(entry.value, variables))
          restated.add(property);
      }
      // Restating a declaration with `!important` lets it beat everything it overlaps, so each
      // restated declaration brings in the winners it overlaps, until none is added.
      for (let grew = restated.size > 0; grew;) {
        grew = false;
        for (const property of winners.keys())
          if (
            !property.startsWith("--") &&
            !restated.has(property) &&
            [...restated].some((candidate) => overlaps(candidate, property))
          ) {
            restated.add(property);
            grew = true;
          }
      }
    }
    // Declarations are emitted in cascade order, which is what settles a
    // shorthand against a longhand it covers: `margin` and `margin-top` are
    // separate properties, so both can win, and the order they appear in is
    // what decides which one the client applies last.
    const emitted = [...winners]
      .filter(([property]) => !property.startsWith("--"))
      .sort(([, left], [, right]) => compareRank(left.key, right.key))
      .map(([property, entry]): readonly [string, string, boolean] => {
        const value = finalizeValue(entry.value, variables);
        // Rank's first term is importance. The style attribute has to keep
        // `!important`: inlining the value alone lets a later important rule win.
        // The whole dark-mode set stays plain, not only the color that changed.
        // Stripping the flag from just that color would let an overlapping
        // important longhand beat the themed shorthand in light mode. A weaker
        // retained rule is copied onto the lock class so it does not take the
        // color back.
        const important = entry.key[0] === 1 && !restated.has(property);
        return [property, value, important];
      });

    for (const [property, value] of emitted)
      checkFallback(property, value, element.origins.slice(0, 1));

    const physical = new Map<string, string>();
    for (const [property, value, important] of emitted) {
      for (const [name, lowered] of conditionalWriting
        ? [[property, value] as const]
        : physicalPadding(property, value, writing)) {
        // A later logical declaration can reclaim a physical longhand after a
        // shorthand. Move its key as well as replacing its value. Importance
        // is applied after the split, so both sides of `3px 4px` keep it.
        physical.delete(name);
        physical.set(name, important ? `${lowered}!important` : lowered);
      }
    }
    const bgcolor = element.props.bgcolor;
    const lightProps =
      typeof bgcolor === "string" && bgcolor.includes("var(")
        ? { ...element.props, bgcolor: finalizeValue(bgcolor, variables) }
        : element.props;
    // Dark mode: every inlined declaration that reads a color the dark-mode block redefines, at
    // its dark value, and a themed `bgcolor` as the background it paints.
    // A changed declaration is restated with every winning declaration that can override it or
    // that it can override, in cascade order, so a longhand that wins over a shorthand (an inline
    // `background-color` after a class's `background`) still wins in dark mode, and nothing it
    // cannot touch (a `border-radius` beside a `border-color`) is pinned with `!important`.
    const dark: [string, string][] = [];
    const locked: LockedDeclaration[] = [];
    if (hasDarkTheme) {
      for (const [property, entry] of [...winners].sort(([, left], [, right]) =>
        compareRank(left.key, right.key),
      )) {
        if (!restated.has(property)) continue;
        const darkValue = finalizeValue(entry.value, darkScope);
        dark.push([property, darkValue]);
        if (entry.key[0] === 1)
          locked.push({
            property,
            light: finalizeValue(entry.value, variables),
            dark: darkValue,
            key: entry.key,
          });
      }
      if (
        typeof bgcolor === "string" &&
        bgcolor.includes("var(") &&
        !winners.has("background-color") &&
        !winners.has("background")
      ) {
        const value = finalizeValue(bgcolor, darkScope);
        if (value !== finalizeValue(bgcolor, variables)) dark.push(["background-color", value]);
      }
    }
    const darkClass = dark.length === 0 ? undefined : darkClassFor(dark);
    const lockClass = lockClassFor(locked);
    const themed = darkClass === undefined ? lightProps : withClass(lightProps, darkClass);
    const props = lockClass === undefined ? themed : withClass(themed, lockClass);
    return EmailNode.Element({
      ...element,
      props: emitted.length === 0 ? props : { ...props, style: Object.fromEntries(physical) },
      children: visitChildren(element.children, ancestry, variables, darkScope, writing),
    });
  };

  const rootDark = { ...sheet.variables, ...sheet.darkVariables };
  const tree =
    root.type === "Element"
      ? applyTo(
          root,
          { element: root, parent: undefined, previous: [] },
          sheet.variables,
          rootDark,
          horizontalWriting,
        )
      : root.type === "Fragment"
        ? EmailNode.Fragment({
            ...root,
            children: visitChildren(
              root.children,
              undefined,
              sheet.variables,
              rootDark,
              horizontalWriting,
            ),
          })
        : root;

  // Every retained rule ships in the head whether or not an element matches it,
  // resolved against the root variables the head CSS is written with.
  for (const rule of retained)
    for (const declaration of rule.declarations)
      checkFallback(declaration.property, finalizeValue(declaration.value, sheet.variables), []);
  for (const [value, origins] of fallbackFindings)
    diagnostics.push({ ...fontFallbackDiagnostic(value), origins });

  for (const [name, origins] of unmatched)
    diagnostics.push({
      code: "unmatched-class",
      severity: "warning",
      message: `Class ${JSON.stringify(name)} produced no styles. If it is composed at run time, the compiler cannot discover it; list it in the template's declared classes or write the style inline.`,
      origins: origins.slice(0, 1),
    });
  return {
    tree,
    headCss: `${renderHeadCss(retained, sheet.headAtRules, sheet.variables, sheet.darkVariables)}${renderLockGuards(locks, retained, sheet.variables, sheet.darkVariables)}`,
    darkRules,
    fontFaceCss: sheet.fontFaces.map((face) => face.css).join(""),
    diagnostics,
  };
};
