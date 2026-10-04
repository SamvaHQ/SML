import { parse } from "@babel/parser";
import { parse as parseCss, walk as walkCss, type CssNode } from "css-tree";
import { compile } from "tailwindcss";

import { buildLineMap, lineColumn } from "../diagnostic-model";
import { isObject } from "../internal/guards";
import type { JsxSourceLocation } from "../source-locations";
import { parseBrandSpecifier, type BrandPlugin } from "./brand-plugin";
import type { EmailDiagnostic } from "./diagnostics";
import {
  TAILWIND_PREFLIGHT_CSS,
  TAILWIND_THEME_CSS,
  TAILWIND_UTILITIES_CSS,
  TAILWIND_VERSION,
} from "./tailwind-stylesheets.gen";
import { projectDirectory, resolveFromDirectory } from "./theme-imports";

// Tailwind runs its own compiler, at build time, from Samva's exactly pinned
// release — never the project's copy, because a build must not execute code
// downloaded from the project's locked graph.
//
// The compiler needs the complete class set up front. A send-time render cannot
// contribute candidates, so classes are discovered from authored source: string
// literals in `class`/`className` position. A class assembled at run time cannot
// be discovered, and that is a diagnostic rather than silently unstyled output.

export { TAILWIND_VERSION };

export interface TailwindOptions {
  /**
   * Project CSS appended to the compiled entry: `@theme` overrides, `@utility`
   * definitions and ordinary rules. This is the project's pinned configuration.
   */
  readonly css?: string | undefined;
  /**
   * The project path `css` was read from (`theme.css` by default). Its
   * relative `@import`s resolve from this file's directory.
   */
  readonly cssPath?: string | undefined;
  /** Classes the compiler cannot discover, declared by the project on purpose. */
  readonly safelist?: readonly string[] | undefined;
  /** Tailwind's browser reset is off by default; email clients do not want it. */
  readonly preflight?: boolean | undefined;
  /**
   * Bounds on what the compiler may generate. Class discovery reads authored
   * source, so a project can hand it an unbounded candidate set and get an
   * unbounded stylesheet back — inside a build that has a wall clock and a
   * bundle a Worker then has to load. A host that publishes supplies these.
   */
  readonly limits?: TailwindLimits | undefined;
}

export interface TailwindLimits {
  /** Distinct classes handed to the compiler. */
  readonly candidates: number;
  /** Bytes of generated CSS. */
  readonly cssBytes: number;
}

export interface TailwindOutput {
  readonly css: string;
  readonly version: string;
  /** Every candidate handed to the compiler, sorted, for the build manifest. */
  readonly candidates: readonly string[];
}

const STYLESHEETS: Readonly<Record<string, string>> = {
  tailwindcss: `@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);`,
  "tailwindcss/theme.css": TAILWIND_THEME_CSS,
  "tailwindcss/utilities.css": TAILWIND_UTILITIES_CSS,
  "tailwindcss/preflight.css": TAILWIND_PREFLIGHT_CSS,
};

/**
 * What the project theme's `@import`s resolve to, already checked by
 * `resolveThemeImports`: project stylesheets by path, and the brand theme the
 * brand plugin's specifier stands for.
 */
export interface TailwindImports {
  readonly stylesheets: ReadonlyMap<string, string>;
  readonly brandCss?: string | undefined;
  /** Names the brand import; `samvaBrandPlugin` when omitted. */
  readonly brandPlugin?: BrandPlugin | undefined;
}

/**
 * Mark every `@theme` in project and brand CSS `static`. Tailwind emits a
 * theme variable only when a utility it generated reads it, but a project's
 * own stylesheets read theme variables too (`color: var(--color-brand)`), and
 * Tailwind never sees those rules. A later layer that redefines a variable
 * replaces its options, so every layer has to carry `static` for the value
 * the cascade settles on to reach the inliner.
 */
const staticTheme = (css: string): string => {
  const ast = parseCss(css, {
    positions: true,
    parseValue: false,
    parseRulePrelude: false,
    parseCustomProperty: false,
  });
  const insertions: number[] = [];
  walkCss(ast, (node: CssNode) => {
    if (node.type !== "Atrule" || node.name.toLowerCase() !== "theme" || node.loc == null) return;
    const prelude =
      node.prelude === null
        ? ""
        : css.slice(node.prelude.loc?.start.offset ?? 0, node.prelude.loc?.end.offset ?? 0);
    if (/(?:^|\s)static(?:\s|$)/i.test(prelude)) return;
    insertions.push(node.loc.start.offset + "@theme".length);
  });
  let output = css;
  for (const offset of insertions.reverse())
    output = `${output.slice(0, offset)} static${output.slice(offset)}`;
  return output;
};

/** Compile the discovered class set into CSS with the pinned Tailwind release. */
export const compileTailwind = async (
  candidates: Iterable<string>,
  options: TailwindOptions = {},
  imports: TailwindImports = { stylesheets: new Map() },
): Promise<TailwindOutput> => {
  const entry = [
    "@layer theme, base, components, utilities;",
    '@import "tailwindcss/theme.css" layer(theme);',
    ...(options.preflight === true ? ['@import "tailwindcss/preflight.css" layer(base);'] : []),
    '@import "tailwindcss/utilities.css" layer(utilities);',
    staticTheme(options.css ?? ""),
  ].join("\n");
  // `base` is the importing stylesheet's project directory; the entry sits in
  // the theme's own directory, so the theme's relative imports resolve from it.
  const compiler = await compile(entry, {
    base: projectDirectory(options.cssPath ?? "theme.css"),
    loadStylesheet: (id: string, base: string) => {
      const builtIn = STYLESHEETS[id];
      if (builtIn !== undefined) return Promise.resolve({ path: id, base, content: builtIn });
      if (parseBrandSpecifier(id, imports.brandPlugin) !== undefined) {
        if (imports.brandCss === undefined)
          // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Unreachable after resolveThemeImports; a brand import without a brand is refused before Tailwind runs.
          throw new TypeError(`${id} has no brand in this build`);
        return Promise.resolve({ path: id, base, content: staticTheme(imports.brandCss) });
      }
      const path = resolveFromDirectory(base, id.replace(/[?#].*$/, ""));
      const content = path === undefined ? undefined : imports.stylesheets.get(path);
      if (path === undefined || content === undefined)
        // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Unreachable after resolveThemeImports; an unresolved import is refused before Tailwind runs.
        throw new TypeError(`@import ${JSON.stringify(id)} names no project stylesheet`);
      return Promise.resolve({ path, base: projectDirectory(path), content: staticTheme(content) });
    },
  });
  const all = [...new Set([...candidates, ...(options.safelist ?? [])])].sort();
  const limits = options.limits;
  if (limits !== undefined && all.length > limits.candidates)
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Synchronous build boundary: an over-budget candidate set is refused before Tailwind runs.
    throw new TypeError(
      `Tailwind candidate limit exceeded: ${all.length} classes, limit ${limits.candidates}. Reduce the utility classes this project uses, or its declared safelist.`,
    );
  const css = compiler.build(all);
  const bytes = new TextEncoder().encode(css).length;
  if (limits !== undefined && bytes > limits.cssBytes)
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Synchronous build boundary: an over-budget stylesheet is refused before it reaches a bundle.
    throw new TypeError(
      `Generated CSS limit exceeded: ${bytes} bytes, limit ${limits.cssBytes}. Reduce the utility classes this project uses, or its declared safelist.`,
    );
  return { css, version: TAILWIND_VERSION, candidates: all };
};

// ── Static class discovery ───────────────────────────────────────────────────

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && !Array.isArray(value);

const isAstNode = (value: unknown): value is AstNode =>
  isRecord(value) &&
  typeof value.type === "string" &&
  typeof value.start === "number" &&
  typeof value.end === "number";

const walk = (value: unknown, visit: (node: AstNode) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isRecord(value)) return;
  if (isAstNode(value)) visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === "loc" || key === "extra" || key === "comments" || key === "tokens") continue;
    walk(child, visit);
  }
};

const CLASS_KEYS = new Set(["class", "className"]);

const nameOf = (node: unknown): string | undefined => {
  if (!isAstNode(node)) return undefined;
  if (node.type === "JSXIdentifier" || node.type === "Identifier")
    return typeof node.name === "string" ? node.name : undefined;
  if (node.type === "StringLiteral") return typeof node.value === "string" ? node.value : undefined;
  return undefined;
};

export interface ClassDiscovery {
  readonly candidates: readonly string[];
  readonly diagnostics: readonly EmailDiagnostic[];
}

/**
 * Collect the class names one module states literally, and report the positions
 * where a class is assembled from values the compiler cannot see.
 */
export const discoverClassCandidates = (source: string, fileName: string): ClassDiscovery => {
  let parsed;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Babel throws on unparseable source; the module transform reports that separately.
  try {
    parsed = parse(source, { plugins: ["typescript", "jsx"], sourceType: "module" });
  } catch {
    return { candidates: [], diagnostics: [] };
  }
  const lineMap = buildLineMap(source);
  const candidates = new Set<string>();
  const diagnostics: EmailDiagnostic[] = [];
  const at = (offset: number): JsxSourceLocation => {
    const position = lineColumn(lineMap, offset);
    return { fileName, lineNumber: position.line, columnNumber: position.column };
  };

  /** Returns true when every class in the expression is statically known. */
  const readValue = (node: unknown): boolean => {
    if (!isAstNode(node)) return false;
    switch (node.type) {
      case "StringLiteral": {
        if (typeof node.value !== "string") return false;
        for (const name of node.value.split(/\s+/)) if (name !== "") candidates.add(name);
        return true;
      }
      case "TemplateLiteral": {
        const quasis = Array.isArray(node.quasis) ? node.quasis : [];
        for (const quasi of quasis) {
          const cooked = isAstNode(quasi) && isRecord(quasi.value) ? quasi.value.cooked : undefined;
          if (typeof cooked !== "string") continue;
          for (const name of cooked.split(/\s+/)) if (name !== "") candidates.add(name);
        }
        return Array.isArray(node.expressions) && node.expressions.length === 0;
      }
      case "JSXExpressionContainer":
        return readValue(node.expression);
      case "ConditionalExpression":
        // Both branches are reachable across renders, so both are candidates.
        return [node.consequent, node.alternate].every((branch) => readValue(branch));
      case "LogicalExpression":
        return readValue(node.right);
      case "BinaryExpression":
        return node.operator === "+" && [node.left, node.right].every((side) => readValue(side));
      case "ArrayExpression":
        return Array.isArray(node.elements) && node.elements.every((element) => readValue(element));
      default:
        return false;
    }
  };

  walk(parsed.program, (node) => {
    const isJsxAttribute = node.type === "JSXAttribute";
    const isObjectProperty = node.type === "ObjectProperty";
    if (!isJsxAttribute && !isObjectProperty) return;
    const key = nameOf(isJsxAttribute ? node.name : node.key);
    if (key === undefined || !CLASS_KEYS.has(key)) return;
    const value = isJsxAttribute ? node.value : node.value;
    if (value === null || value === undefined) return;
    if (readValue(value)) return;
    diagnostics.push({
      code: "tailwind-dynamic-class",
      severity: "warning",
      message: `This ${key} is assembled at run time, so the compiler cannot discover the classes it produces and they will have no styles. Write the classes literally, or declare them in the project's Tailwind safelist.`,
      origins: [at(node.start)],
    });
  });

  return { candidates: [...candidates].sort(), diagnostics };
};
