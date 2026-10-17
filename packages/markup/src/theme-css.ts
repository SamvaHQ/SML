import { Result } from "better-result";
import {
  generate as generateCss,
  parse as parseCss,
  walk as walkCss,
  type CssNode,
} from "css-tree";

import type { Diagnostic, Span } from "./diagnostic-model";
import { parseColor } from "./email/css-color";
import { isDarkSchemeQuery } from "./email/dark-scheme";

// A theme sets the semantic tokens below in light mode and, in its dark-mode
// block, the colors that change in dark mode. A brand theme is the CSS a brand contributes to every project that imports
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
  "--radius",
  "--spacing",
  "--container-",
  "--shadow-",
] as const;

/** `--color-` names a prefix; `--radius` is the variable itself or a `--radius-*` prefix. */
const inNamespace = (property: string, namespace: string): boolean =>
  namespace.endsWith("-")
    ? property.startsWith(namespace)
    : property === namespace || property.startsWith(`${namespace}-`);

const BRAND_PROPERTY = /^--[a-z][a-z0-9-]*$/;
const BRAND_UNSAFE_VALUE = /[{};<>\\@]|url\s*\(|expression\s*\(|\/\*/i;
const BRAND_FONT_DESCRIPTORS = new Set([
  "font-family",
  "src",
  "font-weight",
  "font-style",
  "font-display",
  "unicode-range",
]);

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
      if (!BRAND_NAMESPACES.some((namespace) => inNamespace(property, namespace))) {
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
          isDarkSchemeQuery(generateCss(node.prelude))
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

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * The semantic color tokens, as Tailwind color names (`bg-card`,
 * `text-primary-foreground`, `border-border`), each with the role a block uses
 * it for. A block reads only these, so swapping the theme reskins it.
 */
export const THEME_COLOR_ROLES = {
  background: "The page, behind everything.",
  foreground: "Text on the page.",
  card: "A surface that groups the message's content.",
  "card-foreground": "Text on a card.",
  primary: "The main action's fill (a button), and links.",
  "primary-foreground": "Text on a primary fill.",
  secondary: "A quieter action's fill.",
  "secondary-foreground": "Text on a secondary fill.",
  muted: "A subdued surface: a code block, a table header.",
  "muted-foreground":
    "Secondary text on the page, a card or a muted surface: labels, captions, the footer.",
  accent: "A highlighted surface: a callout, a selected row.",
  "accent-foreground": "Text on an accent surface.",
  border: "Rules, dividers and outlines.",
} as const;

export const THEME_COLORS = Object.keys(
  THEME_COLOR_ROLES,
) as readonly (keyof typeof THEME_COLOR_ROLES)[];

export type ThemeColor = (typeof THEME_COLORS)[number];

/**
 * The non-color tokens: the corner radius (`rounded`; `rounded-sm` to `rounded-xl` follow it) and
 * the body and heading families (`font-sans`, `font-heading`).
 */
export const THEME_TOKENS = ["--radius", "--font-sans", "--font-heading"] as const;

const colorVariables = (colors: Readonly<Record<ThemeColor, string>>): Record<string, string> =>
  Object.fromEntries(THEME_COLORS.map((name) => [`--color-${name}`, colors[name]]));

/**
 * The theme every project compiles with, beneath its own: a neutral light and
 * dark palette, an 8px radius and the system sans-serif stack. A project's
 * `theme.css`, its imported stylesheets and its brand layer over it.
 */
export const DEFAULT_THEME: BrandCss = {
  variables: {
    ...colorVariables({
      background: "#ffffff",
      foreground: "#0a0a0a",
      card: "#ffffff",
      "card-foreground": "#0a0a0a",
      primary: "#171717",
      "primary-foreground": "#fafafa",
      secondary: "#f5f5f5",
      "secondary-foreground": "#171717",
      muted: "#f5f5f5",
      "muted-foreground": "#737373",
      accent: "#f5f5f5",
      "accent-foreground": "#171717",
      border: "#e5e5e5",
    }),
    "--radius": "8px",
    // The corner scale follows `--radius`, so a theme sets one value: `rounded-sm` for small
    // marks, `rounded-md` for controls, `rounded-lg` (`rounded`) for blocks, `rounded-xl` for
    // the outermost card.
    "--radius-sm": "calc(var(--radius) - 4px)",
    "--radius-md": "calc(var(--radius) - 2px)",
    "--radius-lg": "var(--radius)",
    "--radius-xl": "calc(var(--radius) + 4px)",
    "--font-sans":
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    "--font-heading": "var(--font-sans)",
  },
  dark: colorVariables({
    background: "#0a0a0a",
    foreground: "#fafafa",
    card: "#171717",
    "card-foreground": "#fafafa",
    primary: "#fafafa",
    "primary-foreground": "#171717",
    secondary: "#262626",
    "secondary-foreground": "#fafafa",
    muted: "#262626",
    "muted-foreground": "#a3a3a3",
    accent: "#262626",
    "accent-foreground": "#fafafa",
    border: "#2e2e2e",
  }),
  fontFaces: [],
};

/** `DEFAULT_THEME` as theme CSS. */
export const DEFAULT_THEME_CSS = printBrandCss(DEFAULT_THEME);

// ── Text on fills ───────────────────────────────────────────────────────────

/** The fills whose text color a brand may leave out: `--color-primary` and `--color-primary-foreground`, and so on. */
export const FILL_COLORS = [
  "primary",
  "secondary",
  "accent",
] as const satisfies readonly ThemeColor[];

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
 * The text colors a theme layer gets for the fills it sets without one: for
 * each of `FILL_COLORS`, the `contrastForeground` of the fill, in light mode
 * and, where the layer's dark-mode block sets the fill, in dark mode. A layer
 * that sets the foreground, or whose fill does not evaluate, gets no default.
 * Every build lowers each theme layer with these, so stored theme CSS never
 * carries them.
 */
export const foregroundDefaults = (
  light: Readonly<Record<string, string>>,
  dark: Readonly<Record<string, string>>,
): {
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
} => {
  const defaults = (colors: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(
      FILL_COLORS.flatMap((fill) => {
        const color = colors[`--color-${fill}`];
        const foreground = `--color-${fill}-foreground`;
        const picked =
          color === undefined || colors[foreground] !== undefined
            ? undefined
            : contrastForeground(color);
        return picked === undefined ? [] : [[foreground, picked]];
      }),
    );
  return { light: defaults(light), dark: defaults(dark) };
};
