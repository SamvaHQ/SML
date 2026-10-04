import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Default project CSS file consumed by the executable email compiler. */
export const PROJECT_THEME_FILE = "theme.css";

/**
 * Resolves the `theme` plugin option to an absolute path, or `undefined` when
 * theming is explicitly disabled (`theme: false`). A string is taken relative to
 * `root` (absolute strings pass through); the default is `<root>/theme.css`.
 */
export const resolveThemePath = (
  root: string,
  option: string | false | undefined,
): string | undefined => {
  if (option === false) return undefined;
  const file = option ?? PROJECT_THEME_FILE;
  return isAbsolute(file) ? file : resolve(root, file);
};

/** Read authored Tailwind CSS verbatim; the email compiler validates its syntax. */
export const readProjectThemeCss = async (path: string | undefined): Promise<string | undefined> =>
  path === undefined
    ? undefined
    : readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return undefined;
        // oxlint-disable-next-line samva/no-try-catch-or-throw -- A filesystem failure must not silently disable the authored theme.
        throw cause;
      });

/** The theme's project-relative path, from which its relative `@import`s resolve. */
export const projectThemePath = (root: string, themePath: string): string =>
  relative(root, themePath).split(sep).join("/");
