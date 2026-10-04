import { Result } from "better-result";
import {
  generate as generateCss,
  parse as parseCss,
  walk as walkCss,
  type CssNode,
} from "css-tree";

import type { Diagnostic, Span } from "./diagnostic-model";
import { parseColor } from "./email/css-color";

// A brand theme is the CSS a brand contributes to every project that imports
// the brand. It is variables and fonts only, and the grammar is closed:
//
//   file       = { theme | dark | font-face }
//   theme      = "@theme" "{" { custom-property } "}"
//   dark       = "@media (prefers-color-scheme: dark)" "{" theme { theme } "}"   (--color-* only)
//   font-face  = "@font-face" "{" descriptors "}"   (src: https WOFF2 url() only)
//
// Anything else — a selector rule, another at-rule, a relative or non-WOFF2
// font, a value that could smuggle a block or a URL — is a diagnostic with a
// span. Diagnostics are collected exhaustively so an editor fixes a list.

/** One `@font-face` a brand declares. `src` is the declaration value as authored. */
export interface BrandFontFace {
  readonly family: string;
  readonly src: string;
  readonly weight?: string | undefined;
  readonly style?: string | undefined;
  readonly display?: string | undefined;
  readonly unicodeRange?: string | undefined;
}

/** A brand theme, parsed. Property names keep their leading `--`. */
export interface BrandCss {
  /** Light `@theme` variables. */
  readonly variables: Readonly<Record<string, string>>;
  /** Dark-mode `@theme` colors, keyed by the light name they replace in dark mode. */
  readonly dark: Readonly<Record<string, string>>;
  readonly fontFaces: readonly BrandFontFace[];
}

/** Theme-variable namespaces a brand may set: Tailwind's, minus anything that is not a look. */
const BRAND_NAMESPACES = [
  "--color-",
  "--font-",
  "--text-",
  "--leading-",
  "--tracking-",
  "--radius-",
  "--spacing",
  "--container-",
  "--shadow-",
] as const;

const BRAND_PROPERTY = /^--[a-z][a-z0-9-]*$/;
const BRAND_UNSAFE_VALUE = /[{};<>\\@]|url\s*\(|expression\s*\(|\/\*/i;
const BRAND_DARK_MEDIA = /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i;
const BRAND_FONT_DESCRIPTORS = new Set([
  "font-family",
  "src",
  "font-weight",
  "font-style",
  "font-display",
  "unicode-range",
]);

/** The theme variable a dark-mode color lowers to: `--color-brand` → `--color-brand-dark`. */
export const darkVariableName = (property: string): string => `${property}-dark`;

const spanOfNode = (node: CssNode): Span => ({
  start: node.loc?.start.offset ?? 0,
  end: node.loc?.end.offset ?? 0,
});

const unquoteFamily = (value: string): string => {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/s.exec(trimmed);
  return quoted === null ? trimmed : quoted[2]!.replace(/\\(.)/g, "$1");
};

const quoteFamily = (family: string): string => `"${family.replace(/["\\]/g, "\\$&")}"`;

/** Parse brand theme CSS against the closed grammar above. */
export const parseBrandCss = (css: string): Result<BrandCss, ReadonlyArray<Diagnostic>> => {
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string, span: Span): void => {
    diagnostics.push({ code, message, span });
  };
  const variables: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const fontFaces: BrandFontFace[] = [];
  const ast = parseCss(css, {
    positions: true,
    parseCustomProperty: false,
    onParseError: (error: { readonly message: string; readonly offset?: number }) => {
      const offset = error.offset ?? 0;
      report("brand-css-syntax", `CSS syntax error: ${error.message}`, {
        start: offset,
        end: offset,
      });
    },
  });

  // Values keep their authored text; css-tree's printer drops the space
  // between `url(…)` and `format(…)`, which some email clients misread.
  const sourceOf = (node: CssNode): string =>
    node.loc === undefined || node.loc === null
      ? generateCss(node).trim()
      : css.slice(node.loc.start.offset, node.loc.end.offset).trim();

  const readTheme = (node: CssNode, into: Record<string, string>, scope: "light" | "dark") => {
    if (node.type !== "Atrule" || node.block === null) return;
    if (node.prelude !== null && generateCss(node.prelude).trim() !== "")
      report(
        "brand-css-theme-prelude",
        "@theme takes no options in a brand theme.",
        spanOfNode(node),
      );
    for (const child of node.block.children) {
      if (child.type !== "Declaration") {
        report(
          "brand-css-unsupported",
          "@theme may contain only theme variables (--name: value;).",
          spanOfNode(child),
        );
        continue;
      }
      const property = child.property;
      const value = sourceOf(child.value);
      const span = spanOfNode(child);
      if (!BRAND_PROPERTY.test(property)) {
        report(
          "brand-css-property",
          `${property} is not a theme variable; name theme variables --namespace-name.`,
          span,
        );
        continue;
      }
      if (!BRAND_NAMESPACES.some((namespace) => property.startsWith(namespace))) {
        report(
          "brand-css-namespace",
          `${property} is outside the brand namespaces (${BRAND_NAMESPACES.map((namespace) => (namespace.endsWith("-") ? `${namespace}*` : namespace)).join(", ")}).`,
          span,
        );
        continue;
      }
      if (scope === "dark" && !property.startsWith("--color-")) {
        report(
          "brand-css-dark-namespace",
          `${property}: the dark-mode @theme sets colors (--color-*) only.`,
          span,
        );
        continue;
      }
      if (value === "" || BRAND_UNSAFE_VALUE.test(value) || child.important !== false) {
        report(
          "brand-css-value",
          `${property} has a value a theme variable cannot take; write a plain value without braces, semicolons, url() or !important.`,
          span,
        );
        continue;
      }
      if (property in into) {
        report("brand-css-duplicate", `${property} is declared twice.`, span);
        continue;
      }
      into[property] = value;
    }
  };

  const readFontFace = (node: CssNode) => {
    if (node.type !== "Atrule" || node.block === null) return;
    const face: {
      family?: string;
      src?: string;
      weight?: string;
      style?: string;
      display?: string;
      unicodeRange?: string;
    } = {};
    for (const child of node.block.children) {
      if (child.type !== "Declaration") {
        report(
          "brand-css-unsupported",
          "@font-face may contain only descriptors.",
          spanOfNode(child),
        );
        continue;
      }
      const property = child.property.toLowerCase();
      const value = sourceOf(child.value);
      const span = spanOfNode(child);
      if (!BRAND_FONT_DESCRIPTORS.has(property)) {
        report(
          "brand-css-font-descriptor",
          `@font-face ${property} is not supported; use ${[...BRAND_FONT_DESCRIPTORS].join(", ")}.`,
          span,
        );
        continue;
      }
      if (property === "src") {
        let urls = 0;
        let invalid = false;
        walkCss(child.value, (part: CssNode) => {
          if (part.type === "Url") {
            urls++;
            const path = part.value.replace(/[?#].*$/, "");
            if (!/^https:\/\/[^\s]+$/i.test(part.value)) invalid = true;
            else if (!/\.woff2$/i.test(path) && !/format\(\s*['"]?woff2/i.test(value))
              invalid = true;
          } else if (part.type === "Function" && part.name.toLowerCase() === "local")
            invalid = true;
        });
        if (urls === 0 || invalid) {
          report(
            "brand-css-font-src",
            "A brand @font-face src must be one or more https url()s to WOFF2 files.",
            span,
          );
          continue;
        }
        face.src = value;
        continue;
      }
      if (BRAND_UNSAFE_VALUE.test(value)) {
        report("brand-css-value", `@font-face ${property} has an unsupported value.`, span);
        continue;
      }
      if (property === "font-family") face.family = unquoteFamily(value);
      if (property === "font-weight") face.weight = value;
      if (property === "font-style") face.style = value;
      if (property === "font-display") face.display = value;
      if (property === "unicode-range") face.unicodeRange = value;
    }
    if (face.family === undefined || face.family === "" || face.src === undefined) {
      report(
        "brand-css-font-incomplete",
        "A brand @font-face needs a font-family and an https WOFF2 src.",
        spanOfNode(node),
      );
      return;
    }
    fontFaces.push({
      family: face.family,
      src: face.src,
      ...(face.weight === undefined ? {} : { weight: face.weight }),
      ...(face.style === undefined ? {} : { style: face.style }),
      ...(face.display === undefined ? {} : { display: face.display }),
      ...(face.unicodeRange === undefined ? {} : { unicodeRange: face.unicodeRange }),
    });
  };

  if (ast.type === "StyleSheet")
    for (const node of ast.children) {
      if (node.type === "Atrule" && node.block !== null) {
        const name = node.name.toLowerCase();
        if (name === "theme") {
          readTheme(node, variables, "light");
          continue;
        }
        if (name === "font-face") {
          readFontFace(node);
          continue;
        }
        if (
          name === "media" &&
          node.prelude !== null &&
          BRAND_DARK_MEDIA.test(generateCss(node.prelude).trim())
        ) {
          for (const child of node.block.children) {
            if (child.type === "Atrule" && child.name.toLowerCase() === "theme")
              readTheme(child, dark, "dark");
            else
              report(
                "brand-css-unsupported",
                "The dark-mode block may contain only @theme.",
                spanOfNode(child),
              );
          }
          continue;
        }
      }
      report(
        "brand-css-unsupported",
        "A brand theme contains only @theme, a dark-mode @theme (@media (prefers-color-scheme: dark)), and @font-face.",
        spanOfNode(node),
      );
    }

  for (const property of Object.keys(dark))
    if (darkVariableName(property) in variables)
      report(
        "brand-css-dark-conflict",
        `${darkVariableName(property)} and the dark-mode ${property} name the same theme variable; keep one.`,
        { start: 0, end: 0 },
      );

  return diagnostics.length > 0
    ? Result.err(diagnostics)
    : Result.ok({ variables, dark, fontFaces });
};

const printDeclarations = (entries: Readonly<Record<string, string>>, indent: string): string =>
  Object.entries(entries)
    .map(([property, value]) => `${indent}${property}: ${value};`)
    .join("\n");

const printFontFace = (face: BrandFontFace): string =>
  [
    "@font-face {",
    `  font-family: ${quoteFamily(face.family)};`,
    `  src: ${face.src};`,
    ...(face.weight === undefined ? [] : [`  font-weight: ${face.weight};`]),
    ...(face.style === undefined ? [] : [`  font-style: ${face.style};`]),
    ...(face.display === undefined ? [] : [`  font-display: ${face.display};`]),
    ...(face.unicodeRange === undefined ? [] : [`  unicode-range: ${face.unicodeRange};`]),
    "}",
  ].join("\n");

/**
 * Serialize a brand theme in canonical form: font faces, then the light
 * `@theme`, then the dark-mode `@theme`. Empty sections are omitted, and the
 * output always parses back to the same value.
 */
export const printBrandCss = (brand: BrandCss): string => {
  const blocks = [
    ...brand.fontFaces.map(printFontFace),
    ...(Object.keys(brand.variables).length === 0
      ? []
      : [`@theme {\n${printDeclarations(brand.variables, "  ")}\n}`]),
    ...(Object.keys(brand.dark).length === 0
      ? []
      : [
          `@media (prefers-color-scheme: dark) {\n  @theme {\n${printDeclarations(brand.dark, "    ")}\n  }\n}`,
        ]),
  ];
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
};

// ── Text on brand ───────────────────────────────────────────────────────────

/** The brand color, and the text color that sits on it. */
export const BRAND_COLOR_VARIABLE = "--color-brand";
export const BRAND_FOREGROUND_VARIABLE = "--color-brand-foreground";

/** WCAG relative luminance of an sRGB channel triple in 0–1. */
const relativeLuminance = (r: number, g: number, b: number): number => {
  const linear = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel));
    return clamped <= 0.04045 ? clamped / 12.92 : ((clamped + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/**
 * Black or white, whichever has the higher WCAG contrast ratio against
 * `color`. A translucent color is judged over white, the page an email sits on.
 * `undefined` when the color is not one `parseColor` evaluates (a `var()`,
 * `currentColor`, `lab()`, a named color outside its table): nothing is
 * guessed for it.
 */
export const contrastForeground = (color: string): "#000000" | "#ffffff" | undefined => {
  const parsed = parseColor(color);
  if (parsed === undefined) return undefined;
  const alpha = Math.min(1, Math.max(0, parsed.a));
  const over = (channel: number) => channel * alpha + (1 - alpha);
  const luminance = relativeLuminance(over(parsed.r), over(parsed.g), over(parsed.b));
  const againstWhite = 1.05 / (luminance + 0.05);
  const againstBlack = (luminance + 0.05) / 0.05;
  return againstWhite > againstBlack ? "#ffffff" : "#000000";
};

/**
 * The text-on-brand colors a brand gets when it leaves them out: for the light
 * theme and, when the brand sets a dark-mode brand color, for dark mode. Each
 * is the `contrastForeground` of the brand color it sits on. A brand that sets
 * the foreground, or whose brand color does not evaluate, gets no default.
 */
export const brandForegroundDefaults = (
  brand: BrandCss,
): { readonly light?: string | undefined; readonly dark?: string | undefined } => {
  const light =
    brand.variables[BRAND_FOREGROUND_VARIABLE] === undefined &&
    brand.variables[BRAND_COLOR_VARIABLE] !== undefined
      ? contrastForeground(brand.variables[BRAND_COLOR_VARIABLE])
      : undefined;
  const darkBrand = brand.dark[BRAND_COLOR_VARIABLE];
  const dark =
    darkBrand !== undefined &&
    brand.dark[BRAND_FOREGROUND_VARIABLE] === undefined &&
    brand.variables[darkVariableName(BRAND_FOREGROUND_VARIABLE)] === undefined
      ? contrastForeground(darkBrand)
      : undefined;
  return { light, dark };
};

/**
 * A brand theme as flat theme variables, the way a build compiles it. Email
 * inlining resolves `var()` once, so a dark-mode `@theme` cannot switch a
 * value at run time; each dark color lowers to its `-dark` theme variable,
 * which `dark:` utilities read (`dark:bg-brand-dark`). A text-on-brand color
 * the brand leaves out is filled in by `brandForegroundDefaults`, so every
 * build compiles the same default and the stored CSS never carries it.
 */
export const brandThemeVariables = (brand: BrandCss): Readonly<Record<string, string>> => {
  const defaults = brandForegroundDefaults(brand);
  return {
    ...brand.variables,
    ...(defaults.light === undefined ? {} : { [BRAND_FOREGROUND_VARIABLE]: defaults.light }),
    ...Object.fromEntries(
      Object.entries(brand.dark).map(([property, value]) => [darkVariableName(property), value]),
    ),
    ...(defaults.dark === undefined
      ? {}
      : { [darkVariableName(BRAND_FOREGROUND_VARIABLE)]: defaults.dark }),
  };
};

/** The stylesheet Tailwind compiles for the theme's brand import: `brandThemeVariables` and the font faces. */
export const brandTailwindCss = (brand: BrandCss): string =>
  printBrandCss({ fontFaces: brand.fontFaces, variables: brandThemeVariables(brand), dark: {} });
