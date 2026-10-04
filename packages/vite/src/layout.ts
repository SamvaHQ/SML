import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { isAssetPath } from "@samva/markup/brand";

// Where a template project keeps its files. A project has one root: the folder
// holding `theme.css`, shared imports and the generated `.samva/` folder. Its
// templates live in `templates/`, and `emails/` is recognized beside it. The
// compiler reads files, never a module graph, so everything here is reading
// the tree and naming its paths.

/** Directories scanned for templates when no `dir` is configured, in scan order. */
export const DEFAULT_TEMPLATE_DIRS = ["templates", "emails"] as const;

/** The folder for files this package generates, relative to the project root. Gitignore it. */
export const SAMVA_DIR = ".samva";

/** A project's files by root-relative POSIX path: text as strings, imported assets as bytes. */
export type ProjectFiles = Readonly<Record<string, string | Uint8Array>>;

export const toPosix = (value: string): string =>
  sep === "/" ? value : value.split(sep).join("/");

const SCRIPT = /\.[cm]?[jt]sx?$/;
const isProjectText = (name: string): boolean =>
  SCRIPT.test(name) || name.endsWith(".css") || name.endsWith(".json");

/** True for a file a compile can read: scripts, stylesheets, JSON and importable assets. */
export const isProjectFile = (path: string): boolean => isProjectText(path) || isAssetPath(path);

const skipped = (name: string): boolean => name.startsWith(".") || name === "node_modules";

/** True when `path` is `parent` or lies beneath it. */
export const isWithin = (path: string, parent: string): boolean => {
  const inside = relative(parent, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};

const isDirectory = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => undefined))?.isDirectory() === true;

/**
 * The absolute directories a project's templates live in. A configured `dir`
 * is the only one scanned; otherwise every default directory that exists. A
 * directory outside the root cannot be compiled, because a project's files are
 * addressed relative to its root, so it is refused rather than half-read.
 */
export const templateDirectories = async (
  root: string,
  dir?: string | undefined,
): Promise<readonly string[]> => {
  if (dir !== undefined) {
    const configured = resolve(root, dir);
    if (!isWithin(configured, root)) {
      // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Plain library boundary: configuration the project cannot compile.
      throw new Error(
        `The templates directory ${configured} is outside the project root ${root}. Set the project root to a folder that contains both.`,
      );
    }
    return (await isDirectory(configured)) ? [configured] : [];
  }
  const found = await Promise.all(
    DEFAULT_TEMPLATE_DIRS.map(async (name) => {
      const path = join(root, name);
      return (await isDirectory(path)) ? path : undefined;
    }),
  );
  return found.filter((path) => path !== undefined);
};

/** Root-relative POSIX path of an absolute one. */
export const projectPath = (root: string, path: string): string => toPosix(relative(root, path));

/** Every `.tsx` file beneath the given directories, as root-relative paths, sorted. */
export const discoverEntries = async (
  root: string,
  dirs: readonly string[],
): Promise<readonly string[]> => {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => !skipped(entry.name))
        .map(async (entry) => {
          const full = join(current, entry.name);
          if (entry.isDirectory()) return walk(full);
          if (entry.isFile() && entry.name.endsWith(".tsx")) found.push(projectPath(root, full));
        }),
    );
  };
  await Promise.all(dirs.map(walk));
  return [...new Set(found)].sort();
};

/**
 * Read the project into the map the compiler consumes: scripts, stylesheets
 * and JSON as text, imported assets as bytes. Hidden folders (`.samva`, `.git`)
 * and `node_modules` are not part of a project.
 */
export const readProjectFiles = async (root: string): Promise<ProjectFiles> => {
  const files: Record<string, string | Uint8Array> = {};
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => !skipped(entry.name))
        .map(async (entry) => {
          const full = join(current, entry.name);
          if (entry.isDirectory()) return walk(full);
          if (!entry.isFile()) return;
          const path = projectPath(root, full);
          if (isAssetPath(path)) {
            files[path] = new Uint8Array(await readFile(full));
          } else if (isProjectText(entry.name)) {
            files[path] = await readFile(full, "utf8");
          }
        }),
    );
  };
  await walk(root);
  return files;
};
