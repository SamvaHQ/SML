import { isObject } from "../internal/guards";
import type { JsxSourceLocation } from "../source-locations";
import type { CssDeclaration, CssRule, Specificity, Stylesheet } from "./css";
import { finalizeValue, renderHeadCss } from "./css-values";
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
  /** Rules that could not be inlined, ready for a `<style>` element in `<head>`. */
  readonly headCss: string;
  /** Project `@font-face` rules, for a `<head>` style classic Outlook cannot see. */
  readonly fontFaceCss: string;
  readonly diagnostics: readonly EmailDiagnostic[];
}

/**
 * Resolve every stylesheet against the tree: inline what a client will honor on
 * the element, and keep the rest for `<head>`.
 */
export const applyStylesheet = (
  root: EmailNode,
  sheet: Stylesheet,
  options: { readonly knownClasses?: ReadonlySet<string> } = {},
): AppliedStyles => {
  const diagnostics: EmailDiagnostic[] = [...sheet.diagnostics];
  const inlinable: CssRule[] = [];
  const retained: CssRule[] = [];
  const styledClasses = new Set<string>();
  for (const rule of sheet.rules) {
    (rule.inlinable ? inlinable : retained).push(rule);
    for (const name of rule.classes) styledClasses.add(name);
  }
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
            writing,
          );
          previous.push(child);
          return result;
        }
        if (child.type === "Fragment")
          return EmailNode.Fragment({ children: visit(child.children) });
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
    // Declarations are emitted in cascade order, which is what settles a
    // shorthand against a longhand it covers: `margin` and `margin-top` are
    // separate properties, so both can win, and the order they appear in is
    // what decides which one the client applies last.
    const emitted = [...winners]
      .filter(([property]) => !property.startsWith("--"))
      .sort(([, left], [, right]) => compareRank(left.key, right.key))
      .map(([property, entry]): [string, string] => [
        property,
        finalizeValue(entry.value, variables),
      ]);

    for (const [property, value] of emitted)
      checkFallback(property, value, element.origins.slice(0, 1));

    const physical = new Map<string, string>();
    for (const [property, value] of emitted) {
      for (const [name, lowered] of conditionalWriting
        ? [[property, value] as const]
        : physicalPadding(property, value, writing)) {
        // A later logical declaration can reclaim a physical longhand after a
        // shorthand. Move its key as well as replacing its value.
        physical.delete(name);
        physical.set(name, lowered);
      }
    }
    const bgcolor = element.props.bgcolor;
    const props =
      typeof bgcolor === "string" && bgcolor.includes("var(")
        ? { ...element.props, bgcolor: finalizeValue(bgcolor, variables) }
        : element.props;
    return EmailNode.Element({
      ...element,
      props: emitted.length === 0 ? props : { ...props, style: Object.fromEntries(physical) },
      children: visitChildren(element.children, ancestry, variables, writing),
    });
  };

  const tree =
    root.type === "Element"
      ? applyTo(
          root,
          { element: root, parent: undefined, previous: [] },
          sheet.variables,
          horizontalWriting,
        )
      : root.type === "Fragment"
        ? EmailNode.Fragment({
            children: visitChildren(root.children, undefined, sheet.variables, horizontalWriting),
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
    headCss: renderHeadCss(retained, sheet.headAtRules, sheet.variables),
    fontFaceCss: sheet.fontFaces.map((face) => face.css).join(""),
    diagnostics,
  };
};
