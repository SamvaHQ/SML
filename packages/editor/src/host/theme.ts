import type { ThemeColorToken, ThemeFontToken, ThemeTokenSource, ThemeTokens } from "./types";

// A template's theme is layered: `theme.css` imports the starter stylesheet, then the brand
// (`samva:brand`), then sets its own `@theme`. Each layer's dark-mode block,
// `@media (prefers-color-scheme: dark) { @theme { … } }`, sets the colors that change in dark
// mode. A layer that sets a color in its light `@theme` owns that color in both modes, so a dark
// value from a layer beneath it stops applying. This resolver reads the same shapes without a CSS
// parser so a host (or the editor, from the project files) can name and paint the theme.

/** The stylesheets a theme resolves through. */
export interface ThemeStylesheets {
  /** The project's theme stylesheet, `theme.css`. */
  readonly themePath: string;
  /** Project stylesheets by path: the theme and every stylesheet it imports. */
  readonly files: Readonly<Record<string, string>>;
  /** The brand `samva:brand` (or `samva:brand/<slug>`) resolves to; without one it is skipped. */
  readonly brand?: { readonly name: string; readonly css: string } | undefined;
}

const BRAND_SPECIFIER = /^samva:brand(?:\/[a-z0-9-]+)?$/;
const DARK_QUERY = /^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i;
const MAX_VAR_DEPTH = 8;
const AT_KEYWORD = /@([\w-]+)/y;

type Item =
  | { readonly kind: "import"; readonly target: string | undefined }
  | {
      readonly kind: "block";
      readonly name: string;
      readonly prelude: string;
      readonly body: string;
    }
  | { readonly kind: "rule" };

/** Offset just past the string literal that opens at `start`. */
const skipString = (css: string, start: number): number => {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === quote || char === "\n") return index + 1;
    else index += 1;
  }
  return css.length;
};

const stripComments = (css: string): string => {
  let out = "";
  let index = 0;
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      const close = css.indexOf("*/", index + 2);
      index = close === -1 ? css.length : close + 2;
      out += " ";
    } else if (css[index] === '"' || css[index] === "'") {
      const end = skipString(css, index);
      out += css.slice(index, end);
      index = end;
    } else {
      out += css[index];
      index += 1;
    }
  }
  return out;
};

/** Offset of the first `stop` character at nesting depth 0, skipping strings and brackets. */
const scanTo = (css: string, start: number, stop: string): number => {
  let depth = 0;
  let index = start;
  while (index < css.length) {
    const char = css[index]!;
    if (char === '"' || char === "'") {
      index = skipString(css, index);
      continue;
    }
    if (depth === 0 && stop.includes(char)) return index;
    if (char === "(" || char === "[") depth += 1;
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    index += 1;
  }
  return css.length;
};

/** Offset just past the `}` that closes the block whose `{` is at `open`. */
const closeBrace = (css: string, open: number): number => {
  let depth = 0;
  let index = open;
  while (index < css.length) {
    const char = css[index];
    if (char === '"' || char === "'") {
      index = skipString(css, index);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return css.length;
};

const unquote = (token: string): string | undefined => {
  const quote = token[0];
  if ((quote !== '"' && quote !== "'") || token.length < 2 || token.at(-1) !== quote)
    return undefined;
  return token.slice(1, -1);
};

/** The single target of an `@import` prelude: `"x"`, `'x'`, `url(x)` or `url("x")`. */
const importTarget = (prelude: string): string | undefined => {
  const text = prelude.trim();
  const url = /^url\(\s*(.*?)\s*\)$/is.exec(text);
  if (url !== null) {
    const inner = url[1] ?? "";
    return unquote(inner) ?? (/^[^\s"'()]+$/.test(inner) ? inner : undefined);
  }
  return unquote(text);
};

/** The statements and blocks of one level of a stylesheet, in order. */
const items = (css: string): ReadonlyArray<Item> => {
  const found: Item[] = [];
  let index = 0;
  while (index < css.length) {
    const char = css[index]!;
    if (/\s|;/.test(char)) {
      index += 1;
      continue;
    }
    AT_KEYWORD.lastIndex = index;
    const at = char === "@" ? AT_KEYWORD.exec(css) : null;
    const preludeStart = at === null ? index : index + at[0].length;
    const stop = scanTo(css, preludeStart, ";{}");
    const prelude = css.slice(preludeStart, stop);
    if (css[stop] === "{") {
      const end = closeBrace(css, stop);
      found.push(
        at === null
          ? { kind: "rule" }
          : {
              kind: "block",
              name: at[1]!.toLowerCase(),
              prelude: prelude.trim(),
              body: css.slice(stop + 1, end - 1),
            },
      );
      index = end;
    } else {
      if (at?.[1]?.toLowerCase() === "import")
        found.push({ kind: "import", target: importTarget(prelude) });
      index = stop + 1;
    }
  }
  return found;
};

/** The custom properties a `@theme` block declares, in order. */
const declarations = (body: string): ReadonlyArray<readonly [string, string]> => {
  const found: Array<readonly [string, string]> = [];
  let index = 0;
  while (index < body.length) {
    const end = scanTo(body, index, ";");
    const statement = body.slice(index, end);
    const match = /^\s*(--[\w-]+)\s*:([\s\S]*)$/.exec(statement);
    const value = match?.[2]?.trim();
    if (match !== null && value !== undefined && value !== "") found.push([match[1]!, value]);
    index = end + 1;
  }
  return found;
};

/** One stylesheet's own theme: its light variables and its dark-mode colors. */
interface Layer {
  readonly light: Map<string, string>;
  readonly dark: Map<string, string>;
}

const readLayer = (css: string): { readonly layer: Layer; readonly imports: string[] } => {
  const layer: Layer = { light: new Map(), dark: new Map() };
  const imports: string[] = [];
  const visit = (level: ReadonlyArray<Item>, dark: boolean) => {
    for (const item of level) {
      if (item.kind === "import" && !dark) {
        if (item.target !== undefined) imports.push(item.target);
      } else if (item.kind === "block" && item.name === "theme") {
        for (const [property, value] of declarations(item.body))
          (dark ? layer.dark : layer.light).set(property, value);
      } else if (item.kind === "block" && item.name === "media" && DARK_QUERY.test(item.prelude)) {
        visit(items(item.body), true);
      }
    }
  };
  visit(items(stripComments(css)), false);
  return { layer, imports };
};

/** `./starter.css` from `theme.css`, `../x.css` from `styles/a.css`, `/x.css` from the root. */
const resolvePath = (from: string, target: string): string => {
  const path = target.replace(/[?#].*$/, "");
  const base = path.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
};

interface Entry {
  readonly value: string;
  readonly dark: string | undefined;
  readonly source: ThemeTokenSource;
}

/** `var(--x)` and `var(--x, fallback)` replaced from `lookup`, as deep as the references go. */
const resolveVars = (
  value: string,
  lookup: (property: string) => string | undefined,
  depth = 0,
): string =>
  depth > MAX_VAR_DEPTH
    ? value
    : value.replace(
        /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
        (whole, property: string, fallback: string | undefined) => {
          const found = lookup(property) ?? fallback?.trim();
          return found === undefined ? whole : resolveVars(found, lookup, depth + 1);
        },
      );

/**
 * The colors and font roles a theme resolves to, through its imports and the brand, in the order
 * the stylesheets first declare them. A later layer's value replaces an earlier one's, and
 * `var()` references between tokens are resolved.
 */
export const themeTokensFromStylesheets = (input: ThemeStylesheets): ThemeTokens => {
  const entries = new Map<string, Entry>();
  const visited = new Set<string>();

  const apply = (layer: Layer, source: ThemeTokenSource) => {
    for (const [property, value] of layer.light)
      entries.set(property, { value, dark: layer.dark.get(property), source });
    for (const [property, dark] of layer.dark) {
      if (layer.light.has(property)) continue;
      const existing = entries.get(property);
      if (existing !== undefined) entries.set(property, { ...existing, dark });
    }
  };

  const walk = (key: string, css: string, source: ThemeTokenSource, path: string | null) => {
    if (visited.has(key)) return;
    visited.add(key);
    const { layer, imports } = readLayer(css);
    for (const target of imports) {
      if (BRAND_SPECIFIER.test(target)) {
        if (input.brand !== undefined)
          walk("samva:brand", input.brand.css, { kind: "brand", name: input.brand.name }, null);
        continue;
      }
      if (path === null || !/\.css(?:[?#].*)?$/.test(target) || /^[a-z]+:/i.test(target)) continue;
      const resolved = resolvePath(path, target);
      const imported = input.files[resolved];
      if (imported !== undefined)
        walk(resolved, imported, { kind: "stylesheet", path: resolved }, resolved);
    }
    apply(layer, source);
  };

  const theme = input.files[input.themePath];
  if (theme !== undefined) walk(input.themePath, theme, { kind: "project" }, input.themePath);

  const light = (property: string) => entries.get(property)?.value;
  const dark = (property: string) => {
    const entry = entries.get(property);
    return entry?.dark ?? entry?.value;
  };
  const colors: ThemeColorToken[] = [];
  const fonts: ThemeFontToken[] = [];
  for (const [property, entry] of entries) {
    const color = /^--color-([a-z0-9][\w-]*)$/i.exec(property)?.[1];
    if (color !== undefined && !color.includes("--")) {
      const value = resolveVars(entry.value, light);
      if (value === "initial") continue;
      // A token that reads another token follows that token into dark mode.
      const darkValue = resolveVars(entry.dark ?? entry.value, dark);
      colors.push({
        name: color,
        value,
        ...(darkValue !== value ? { dark: darkValue } : {}),
        source: entry.source,
      });
      continue;
    }
    const font = /^--font-([a-z0-9][\w-]*)$/i.exec(property)?.[1];
    if (font !== undefined && !font.includes("--") && !font.startsWith("weight-")) {
      const family = resolveVars(entry.value, light).replace(/\s+/g, " ");
      if (family !== "initial") fonts.push({ name: font, family, source: entry.source });
    }
  }
  return { colors, fonts };
};
