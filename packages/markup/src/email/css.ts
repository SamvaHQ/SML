import { generate, ident, parse, walk, type CssNode } from "css-tree";

import { downlevelColors } from "./css-color";
import type { EmailDiagnostic } from "./diagnostics";
import { compileFontFace, type FontFaceRule, type FontFileResolver } from "./fonts";
import type { AttributeTest, Combinator, CompiledSelector, Compound } from "./selectors";

// One declaration representation for every source of style: imported CSS files,
// the Tailwind compiler's output and authored style objects. Rules keep the
// layer, specificity and source order the cascade needs, plus the enclosing
// at-rule conditions that decide whether a declaration can be inlined at all.

export interface CssDeclaration {
  /** Kebab-case property name, as authored. */
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

/** Specificity as the CSS triple (id, class/attribute/pseudo-class, type). */
export type Specificity = readonly [number, number, number];

export interface CssRule {
  /** Exactly one selector; a selector list is split into one rule each. */
  readonly selector: string;
  /** Decoded class identifiers mentioned by this selector, including nested pseudo selectors. */
  readonly classes: readonly string[];
  readonly specificity: Specificity;
  readonly declarations: readonly CssDeclaration[];
  /** Position across every stylesheet, in the order they were imported. */
  readonly order: number;
  /** Declared `@layer` index; unlayered declarations sort above every layer. */
  readonly layer: number;
  /** Enclosing conditional at-rule preludes, outermost first. */
  readonly conditions: readonly string[];
  /** Unconditional and pseudo-free rules are the only ones that can become an inline style. */
  readonly inlinable: boolean;
  /** Compiled at build time so the render lane needs no CSS parser. */
  readonly matcher: CompiledSelector | undefined;
}

export interface Stylesheet {
  readonly rules: readonly CssRule[];
  /** `@page`, `@keyframes` and other at-rules kept verbatim in `<head>`. */
  readonly headAtRules: readonly string[];
  /** Validated `@font-face` rules, `src` resolved; the render hides them from classic Outlook. */
  readonly fontFaces: readonly FontFaceRule[];
  /** Unconditional custom properties, for resolving `var()` before inlining. */
  readonly variables: Readonly<Record<string, string>>;
  readonly diagnostics: readonly EmailDiagnostic[];
}

const UNLAYERED = Number.MAX_SAFE_INTEGER;
const CONDITIONAL_AT_RULES = new Set(["media", "supports", "container"]);
const HEAD_AT_RULES = new Set(["page", "counter-style", "keyframes"]);
const ROOT_SELECTORS = new Set([":root", ":host", "html", "*", ":where(:root)"]);

const text = (node: CssNode | null | undefined): string =>
  node === null || node === undefined ? "" : generate(node);

/** The CSS specificity triple for one selector, ignoring the parts email clients drop. */
const specificityOf = (selector: CssNode): Specificity => {
  let id = 0;
  let cls = 0;
  let type = 0;
  const visit = (node: CssNode): void => {
    switch (node.type) {
      case "IdSelector":
        id += 1;
        break;
      case "ClassSelector":
      case "AttributeSelector":
        cls += 1;
        break;
      case "PseudoClassSelector":
        // `:is()`/`:where()`/`:not()` take their argument's specificity in real
        // CSS; those selectors are never inlined here, so the approximation
        // only orders head rules against each other.
        if (node.name !== "where") cls += 1;
        break;
      case "TypeSelector":
        if (node.name !== "*") type += 1;
        break;
      case "PseudoElementSelector":
        type += 1;
        break;
      default:
        break;
    }
    if ("children" in node && node.children !== null && node.children !== undefined)
      for (const child of node.children) visit(child);
  };
  visit(selector);
  return [id, cls, type];
};

const hasPseudo = (selector: CssNode): boolean => {
  let found = false;
  const visit = (node: CssNode): void => {
    if (node.type === "PseudoClassSelector" || node.type === "PseudoElementSelector") found = true;
    if ("children" in node && node.children !== null && node.children !== undefined)
      for (const child of node.children) visit(child);
  };
  visit(selector);
  return found;
};

const COMBINATORS: Readonly<Record<string, Combinator>> = {
  " ": "descendant",
  ">": "child",
  "+": "adjacent",
  "~": "sibling",
};

/** Compile a selector into the plain-data matcher the render lane uses. */
export const compileSelector = (selector: string): CompiledSelector | undefined => {
  let ast: CssNode;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- css-tree throws on a selector it cannot parse; an unparseable selector simply never matches.
  try {
    ast = parse(selector, { context: "selector", positions: false });
  } catch {
    return undefined;
  }
  if (ast.type !== "Selector" || ast.children === null) return undefined;
  const parts: { compound: Compound; after?: Combinator }[] = [];
  let tag: string | undefined;
  let id: string | undefined;
  let classes: string[] = [];
  let attributes: AttributeTest[] = [];
  let opaque = false;
  const flush = (after?: Combinator) => {
    parts.push({
      compound: { tag, id, classes, attributes, opaque },
      ...(after === undefined ? {} : { after }),
    });
    tag = undefined;
    id = undefined;
    classes = [];
    attributes = [];
    opaque = false;
  };
  for (const node of ast.children) {
    switch (node.type) {
      case "TypeSelector":
        if (node.name !== "*") tag = node.name.toLowerCase();
        break;
      case "IdSelector":
        id = node.name;
        break;
      case "ClassSelector":
        classes.push(ident.decode(node.name));
        break;
      case "AttributeSelector":
        attributes.push({
          name: node.name.name,
          operator: node.matcher ?? undefined,
          value:
            node.value === null || node.value === undefined
              ? undefined
              : node.value.type === "String"
                ? node.value.value
                : node.value.name,
        });
        break;
      case "Combinator":
        flush(COMBINATORS[node.name.trim() === "" ? " " : node.name] ?? "descendant");
        break;
      default:
        // A pseudo-class, nesting marker or anything else this matcher cannot
        // evaluate makes the compound unmatchable; such rules are retained in
        // <head> rather than inlined.
        opaque = true;
        break;
    }
  }
  flush();
  return { parts };
};

/** Substitute a nested rule's `&` against its parent selector. */
const nestSelector = (parent: string, child: string): string =>
  child.includes("&") ? child.replaceAll("&", parent) : `${parent} ${child}`;

interface ParseContext {
  readonly conditions: readonly string[];
  readonly layer: number;
  /** The enclosing rule's selector, for CSS nesting and for at-rules nested inside a rule. */
  readonly selector?: string | undefined;
}

interface SelectorFacts {
  readonly classes: readonly string[];
  readonly specificity: Specificity;
  readonly pseudo: boolean;
  readonly matcher: CompiledSelector | undefined;
}

/** Parse one stylesheet into rules, keeping layer, order and conditions. */
export const parseStylesheet = (
  source: string,
  options: {
    readonly origin?: string;
    readonly startOrder?: number;
    /** Resolves a relative `@font-face` src to the URL its project file is served from. */
    readonly resolveFontFile?: FontFileResolver | undefined;
    /**
     * The sheet belongs to the project theme, whose `@import`s the Tailwind
     * compile resolves; they are layering, not something to report here.
     */
    readonly themeImports?: boolean | undefined;
  } = {},
): Stylesheet => {
  const rules: CssRule[] = [];
  const headAtRules: string[] = [];
  const fontFaces: FontFaceRule[] = [];
  const variables: Record<string, string> = {};
  const conditionalVariables = new Set<string>();
  const diagnostics: EmailDiagnostic[] = [];
  const layers = new Map<string, number>();
  const selectorFacts = new Map<string, SelectorFacts>();
  let order = options.startOrder ?? 0;

  /** Everything a rule needs from its selector, computed once per distinct string. */
  const factsFor = (selector: string): SelectorFacts => {
    const cached = selectorFacts.get(selector);
    if (cached !== undefined) return cached;
    let facts: SelectorFacts;
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- an unparseable selector is treated as unmatchable rather than failing the build.
    try {
      const node = parse(selector, { context: "selector", positions: false });
      const classes = new Set<string>();
      walk(node, {
        visit: "ClassSelector",
        enter: (part) => {
          classes.add(ident.decode(part.name));
        },
      });
      facts = {
        classes: [...classes],
        specificity: specificityOf(node),
        pseudo: hasPseudo(node),
        matcher: compileSelector(selector),
      };
    } catch {
      facts = { classes: [], specificity: [0, 0, 0], pseudo: true, matcher: undefined };
    }
    selectorFacts.set(selector, facts);
    return facts;
  };

  let ast: CssNode;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- css-tree throws on malformed CSS; the authoring caller gets a diagnostic instead.
  try {
    ast = parse(source, { parseValue: false, parseCustomProperty: false, positions: false });
  } catch (cause) {
    return {
      rules: [],
      headAtRules: [],
      fontFaces: [],
      variables: {},
      diagnostics: [
        {
          code: "css-parse-error",
          severity: "error",
          message: `${options.origin ?? "stylesheet"} could not be parsed: ${String(cause)}`,
          origins: [],
        },
      ],
    };
  }

  const declarationsOf = (block: CssNode | null): CssDeclaration[] => {
    const output: CssDeclaration[] = [];
    if (block === null || block.type !== "Block" || block.children === null) return output;
    for (const child of block.children) {
      if (child.type !== "Declaration") continue;
      output.push({
        property: child.property,
        // Stylesheets use these characters as whitespace; HTML style values reject controls.
        // Keep raw value spacing otherwise: color lowering still reads CSS function arguments.
        value: downlevelColors(
          text(child.value)
            .trim()
            .replace(/[\t\n\r\f]/g, " "),
        ),
        important: child.important === true,
      });
    }
    return output;
  };

  const emit = (
    selector: string,
    context: ParseContext,
    declarations: readonly CssDeclaration[],
  ): void => {
    if (declarations.length === 0) return;
    const facts = factsFor(selector);
    if (ROOT_SELECTORS.has(selector.trim())) {
      for (const declaration of declarations) {
        if (!declaration.property.startsWith("--")) continue;
        if (context.conditions.length === 0) variables[declaration.property] = declaration.value;
        else conditionalVariables.add(declaration.property);
      }
    }
    rules.push({
      selector,
      classes: facts.classes,
      specificity: facts.specificity,
      declarations,
      order: order++,
      layer: context.layer,
      conditions: context.conditions,
      inlinable: context.conditions.length === 0 && !facts.pseudo,
      matcher: facts.matcher,
    });
  };

  /**
   * Declarations directly in a block belong to the enclosing selector, whether
   * that block is the rule's own or a `@media` nested inside it — which is
   * exactly the shape Tailwind v4 emits for a responsive utility.
   */
  const walkBlock = (block: CssNode | null, context: ParseContext): void => {
    if (block === null || block.type !== "Block" || block.children === null) return;
    const declarations = declarationsOf(block);
    if (declarations.length > 0 && context.selector !== undefined)
      emit(context.selector, context, declarations);
    for (const child of block.children) if (child.type !== "Declaration") visitNode(child, context);
  };

  const visitNode = (node: CssNode, context: ParseContext): void => {
    if (node.type === "Rule") {
      const prelude = node.prelude;
      const selectors =
        prelude.type === "SelectorList" && prelude.children !== null
          ? [...prelude.children]
          : [prelude];
      for (const selector of selectors) {
        const own = text(selector).trim();
        if (own === "") continue;
        walkBlock(node.block, {
          ...context,
          selector: context.selector === undefined ? own : nestSelector(context.selector, own),
        });
      }
      return;
    }
    if (node.type !== "Atrule") return;
    const name = node.name.toLowerCase();
    if (name === "layer") {
      const prelude = text(node.prelude).trim();
      if (node.block === null) {
        for (const declared of prelude.split(",").map((part) => part.trim()))
          if (declared !== "" && !layers.has(declared)) layers.set(declared, layers.size);
        return;
      }
      const named = prelude.split(",")[0]?.trim() ?? "";
      if (named !== "" && !layers.has(named)) layers.set(named, layers.size);
      walkBlock(node.block, { ...context, layer: layers.get(named) ?? context.layer });
      return;
    }
    if (name === "theme" || name === "scope") {
      // `@theme` is Tailwind's custom-property block; it behaves as `:root`.
      for (const declaration of declarationsOf(node.block))
        if (declaration.property.startsWith("--"))
          variables[declaration.property] = declaration.value;
      for (const child of node.block?.children ?? [])
        if (child.type !== "Declaration") visitNode(child, context);
      return;
    }
    if (name === "property") {
      const initial = declarationsOf(node.block).find(
        (declaration) => declaration.property === "initial-value",
      );
      const property = text(node.prelude).trim();
      if (initial !== undefined && property.startsWith("--") && !(property in variables))
        variables[property] = initial.value;
      return;
    }
    if (CONDITIONAL_AT_RULES.has(name)) {
      walkBlock(node.block, {
        ...context,
        conditions: [...context.conditions, `@${name} ${text(node.prelude).trim()}`],
      });
      return;
    }
    if (name === "font-face") {
      const face = compileFontFace(node, options.origin ?? "stylesheet", options.resolveFontFile);
      if (face.rule !== undefined) fontFaces.push(face.rule);
      diagnostics.push(...face.diagnostics);
      return;
    }
    if (HEAD_AT_RULES.has(name)) {
      headAtRules.push(generate(node));
      return;
    }
    if (name === "import") {
      if (options.themeImports === true) return;
      diagnostics.push({
        code: "css-import-unresolved",
        severity: "error",
        message: `${options.origin ?? "stylesheet"} uses @import ${text(node.prelude).trim()}; import the stylesheet from the template module instead so the compiler can resolve it.`,
        origins: [],
      });
      return;
    }
    if (name === "charset" || name === "namespace") return;
    diagnostics.push({
      code: "css-unsupported-at-rule",
      severity: "warning",
      message: `@${name} is not applied to email output; remove it or move the declarations into a class rule.`,
      origins: [],
    });
  };

  if (ast.type === "StyleSheet" && ast.children !== null)
    for (const child of ast.children) visitNode(child, { conditions: [], layer: UNLAYERED });

  for (const property of conditionalVariables)
    if (property in variables)
      diagnostics.push({
        code: "css-conditional-variable",
        severity: "warning",
        message: `${property} is redefined inside a conditional at-rule. Inlined declarations take the unconditional value; keep the override on a class rule so the retained head rule can apply it.`,
        origins: [],
      });

  return { rules, headAtRules, fontFaces, variables, diagnostics };
};
