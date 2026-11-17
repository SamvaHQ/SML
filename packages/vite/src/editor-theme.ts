import { readFile, realpath } from "node:fs/promises";
import { posix, resolve } from "node:path";

import type { BrandResolution } from "./brand";
import { isWithin, projectPath } from "./layout";
import { PROJECT_THEME_FILE, projectThemePath, resolveThemePath } from "./theme";

/** The stylesheets the open project's theme resolves through, as `@samva/editor` reads them. */
export interface EditorThemeStylesheets {
  /** The theme stylesheet, project-relative. */
  readonly themePath: string;
  /** The theme and every project stylesheet it reaches by relative `@import`, by project-relative path. */
  readonly files: Readonly<Record<string, string>>;
  /** The resolved brand the brand import names; absent when the project has none. */
  readonly brand?: { readonly name: string; readonly css: string } | undefined;
  /** The specifier the project imports its brand from; `samva:brand` when absent. */
  readonly brandSpecifier?: string | undefined;
}

/** `@import "x"`, `@import 'x'`, `@import url(x)` and `@import url("x")`, as the compiler reads them. */
const IMPORT_TARGET =
  /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)|"([^"]*)"|'([^']*)')/g;

/** Relative `.css` targets an `@import` names; package and URL imports are not project files. */
const relativeImports = (css: string): readonly string[] =>
  [...css.matchAll(IMPORT_TARGET)]
    .map((match) =>
      (match.slice(1).find((target) => target !== undefined) ?? "").replace(/[?#].*$/, ""),
    )
    .filter((target) => /^\.{1,2}\//.test(target) && target.endsWith(".css"));

/**
 * Reads the theme and its relative `@import` closure from disk beneath `root`. A stylesheet that
 * is missing, or whose real path (links followed) lies outside the root, is skipped, so the route
 * never reads beyond the project.
 */
export const readThemeStylesheets = async (input: {
  readonly root: string;
  readonly theme: string | false | undefined;
  readonly brand: BrandResolution | undefined;
  readonly brandSpecifier?: string | undefined;
}): Promise<EditorThemeStylesheets> => {
  const { root } = input;
  const themeFile = resolveThemePath(root, input.theme);
  const themePath =
    themeFile !== undefined && isWithin(themeFile, root)
      ? projectThemePath(root, themeFile)
      : PROJECT_THEME_FILE;
  const brand =
    input.brand?.ok === true && input.brand.brand !== undefined
      ? { name: input.brand.brand.slug, css: input.brand.brand.css }
      : undefined;
  const files: Record<string, string> = {};
  const answer = (): EditorThemeStylesheets => ({
    themePath,
    files,
    brand,
    ...(input.brandSpecifier === undefined ? {} : { brandSpecifier: input.brandSpecifier }),
  });
  if (themeFile === undefined || !isWithin(themeFile, root)) return answer();
  const realRoot = await realpath(root).catch(() => resolve(root));

  const pending = [themePath];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || path in files) continue;
    const absolute = resolve(root, path);
    if (!isWithin(absolute, root)) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- the import closure is discovered one stylesheet at a time.
    const real = await realpath(absolute).catch(() => undefined);
    if (real === undefined || !isWithin(real, realRoot)) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- the import closure is discovered one stylesheet at a time.
    const css = await readFile(real, "utf8").catch(() => undefined);
    if (css === undefined) continue;
    files[projectPath(root, absolute)] = css;
    for (const target of relativeImports(css))
      pending.push(posix.join(posix.dirname(path), target));
  }
  return answer();
};
