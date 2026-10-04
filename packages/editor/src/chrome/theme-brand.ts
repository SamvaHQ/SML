// A project reaches its organization's brand through its theme stylesheet,
// layered as the starter stylesheet import (`STARTER_IMPORT`), then
// `@import "samva:brand";` (or `"samva:brand/<slug>"`), then the project's own
// `@theme`. The compiler's
// import walk (`resolveThemeImports` in `@samva/markup`) is the authority; this
// module reads the same top-level `@import` statements without a CSS parser so
// the editor chrome can name the brand, and writes the layered shape when a
// project has none. The slug is the host's to judge: the chip names a brand
// only when the host's brand list holds that slug, so a malformed one reads
// as a brand the organization does not have.

/** The project stylesheet Tailwind compiles, at the project root. */
export const THEME_PATH = "theme.css";
/** The stylesheet a starter project layers under its brand. */
export const STARTER_PATH = "starter.css";

const BRAND_SPECIFIER = "samva:brand";
const STARTER_IMPORT = `@import "./${STARTER_PATH}";`;
const BRAND_IMPORT = `@import "${BRAND_SPECIFIER}";`;

/** A brand in the organization, as the host resolves it for the chip. */
export interface EditorBrand {
  readonly slug: string;
  readonly name: string;
  /** Whether bare `samva:brand` resolves to this brand. */
  readonly isDefault: boolean;
}

/** The project stylesheets the brand chip reads, from the open draft. */
export interface EditorProjectTheme {
  /** `theme.css`, or null when the project has none. */
  readonly theme: string | null;
  /** Whether the project holds a `starter.css` to layer under the brand. */
  readonly starter: boolean;
}

/** The brand `theme.css` imports: `slug: null` is bare `samva:brand`, the default brand. */
export interface ThemeBrandImport {
  readonly slug: string | null;
}

interface CssImport {
  /** The quoted or `url(...)` target, when the prelude is exactly one target. */
  readonly target: string | undefined;
  /** Offset just past the statement's `;`. */
  readonly end: number;
}

const IMPORT_KEYWORD = /@import(?![\w-])/iy;

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

/** Offset just past the comment that opens at `start`. */
const skipComment = (css: string, start: number): number => {
  const close = css.indexOf("*/", start + 2);
  return close === -1 ? css.length : close + 2;
};

const stripComments = (css: string): string => {
  let out = "";
  let index = 0;
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      index = skipComment(css, index);
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

const unquote = (token: string): string | undefined => {
  const quote = token[0];
  if ((quote !== '"' && quote !== "'") || token.length < 2 || token.at(-1) !== quote) {
    return undefined;
  }
  return token.slice(1, -1);
};

/**
 * The single target of an `@import` prelude: `"x"`, `'x'`, `url(x)`, or
 * `url("x")`. A prelude with anything after the target (a layer, supports, or
 * media condition) has none, because the compiler refuses it.
 */
const importTarget = (prelude: string): string | undefined => {
  const text = stripComments(prelude).trim();
  const url = /^url\(\s*(.*?)\s*\)$/is.exec(text);
  if (url !== null) {
    const inner = url[1] ?? "";
    return unquote(inner) ?? (/^[^\s"'()]+$/.test(inner) ? inner : undefined);
  }
  return unquote(text);
};

/** Every top-level `@import` statement, in source order; comments and strings are skipped. */
const topLevelImports = (css: string): ReadonlyArray<CssImport> => {
  const imports: CssImport[] = [];
  let depth = 0;
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === "/" && css[index + 1] === "*") {
      index = skipComment(css, index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipString(css, index);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === "@" && depth === 0) {
      IMPORT_KEYWORD.lastIndex = index;
      if (IMPORT_KEYWORD.test(css)) {
        const preludeStart = IMPORT_KEYWORD.lastIndex;
        let cursor = preludeStart;
        while (cursor < css.length && css[cursor] !== ";") {
          if (css.startsWith("/*", cursor)) cursor = skipComment(css, cursor);
          else if (css[cursor] === '"' || css[cursor] === "'") cursor = skipString(css, cursor);
          else cursor += 1;
        }
        const end = Math.min(cursor + 1, css.length);
        imports.push({ target: importTarget(css.slice(preludeStart, cursor)), end });
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return imports;
};

const brandOfTarget = (target: string | undefined): ThemeBrandImport | undefined => {
  if (target === BRAND_SPECIFIER) return { slug: null };
  const prefix = `${BRAND_SPECIFIER}/`;
  if (target === undefined || !target.startsWith(prefix)) return undefined;
  const slug = target.slice(prefix.length);
  return slug.length === 0 ? undefined : { slug };
};

const importsStarter = (target: string | undefined): boolean => {
  const path = target?.replace(/[?#].*$/, "");
  return path === `./${STARTER_PATH}` || path === `/${STARTER_PATH}`;
};

/**
 * The brand a theme stylesheet imports, or null when it imports none. A theme
 * that names two brands fails to compile; this reports the first.
 */
export const themeBrandImport = (css: string): ThemeBrandImport | null => {
  for (const { target } of topLevelImports(css)) {
    const brand = brandOfTarget(target);
    if (brand !== undefined) return brand;
  }
  return null;
};

/**
 * `theme.css` layered onto the organization's default brand: the starter
 * import first when the project has a starter stylesheet, then
 * `@import "samva:brand";`, then the file's existing content unchanged. A theme
 * that already imports the starter gets the brand import right after it; a
 * theme that already imports a brand is returned as it is.
 */
export const withDefaultBrandImport = (theme: EditorProjectTheme): string => {
  const css = theme.theme ?? "";
  if (themeBrandImport(css) !== null) return css;
  const starterImport = topLevelImports(css).find(({ target }) => importsStarter(target));
  if (starterImport !== undefined) {
    return `${css.slice(0, starterImport.end)}\n${BRAND_IMPORT}${css.slice(starterImport.end)}`;
  }
  const head = [...(theme.starter ? [STARTER_IMPORT] : []), BRAND_IMPORT].join("\n");
  if (css.length === 0) return `${head}\n`;
  return `${head}\n${css.startsWith("\n") ? "" : "\n"}${css}`;
};

/** What the topbar brand chip shows. */
export type BrandChipView =
  /** The theme or the brand list has not been read yet. */
  | { readonly kind: "pending" }
  | { readonly kind: "brand"; readonly brand: EditorBrand }
  /** The theme names a brand the organization does not have; `slug: null` is a missing default. */
  | { readonly kind: "missing"; readonly slug: string | null }
  /** No brand import; `defaultBrand` is what one click would add, null while brands load. */
  | { readonly kind: "none"; readonly defaultBrand: EditorBrand | null };

/**
 * Decide the chip from the theme's import and the organization's brands.
 * `imported` is undefined until the theme has been read; `brands` is null
 * while the host is still loading them.
 */
export const brandChipView = (
  imported: ThemeBrandImport | null | undefined,
  brands: ReadonlyArray<EditorBrand> | null,
): BrandChipView => {
  if (imported === undefined) return { kind: "pending" };
  const defaultBrand = brands?.find(({ isDefault }) => isDefault) ?? null;
  if (imported === null) return { kind: "none", defaultBrand };
  if (brands === null) return { kind: "pending" };
  const brand =
    imported.slug === null ? defaultBrand : brands.find(({ slug }) => slug === imported.slug);
  return brand === null || brand === undefined
    ? { kind: "missing", slug: imported.slug }
    : { kind: "brand", brand };
};
