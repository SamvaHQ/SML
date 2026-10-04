import { watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { assetUrl } from "@samva/markup/brand";
import type { BrandPlugin, AssetEntry } from "@samva/markup/brand";
import { TEMPLATE_NAME_PATTERN } from "@samva/markup/compiler";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";

import { brandDiagnostics, resolveBrand, type BrandResolution, type BrandResolver } from "./brand";
import {
  compileProject,
  finding,
  renderChannelFixture,
  renderEmailFixtures,
  type CompiledProject,
} from "./compile";
import {
  discoverEntries,
  readProjectFiles,
  SAMVA_DIR,
  templateDirectories,
  toPosix,
  type ProjectFiles,
} from "./layout";
import { compileBase, restoreBase } from "./local-assets";
import { projectThemePath, readProjectThemeCss, resolveThemePath } from "./theme";

// A project is a folder of templates. Every `.tsx` under its templates directory
// is a candidate entry, and the compiler decides which are templates: an entry
// it reports `no-template` for is an ordinary module that other templates
// import. Nothing is evaluated. Identity is what the definition declares, never
// its path, so moving a file does not repoint a publication, and two
// definitions declaring one id is a reported error.

export * from "./compile";
export type { BrandResolution, BrandResolver, BrandWarning, ResolvedBrand } from "./brand";
export {
  DEFAULT_TEMPLATE_DIRS,
  discoverEntries,
  readProjectFiles,
  SAMVA_DIR,
  templateDirectories,
  type ProjectFiles,
} from "./layout";

export interface ProjectOptions {
  /** The project root: `theme.css`, shared imports and `.samva/` live here. Default: the working directory. */
  readonly root?: string | undefined;
  /**
   * The templates directory, relative to `root` (or absolute, inside it). When set, only it is
   * scanned; otherwise `templates/` and `emails/` are, whichever exist.
   */
  readonly dir?: string | undefined;
  /** Host-owned brand resolution. Brand imports fail when no resolver is supplied. */
  readonly brandResolver?: BrandResolver | undefined;
  /** Brand import specifier and footer markers passed to the compiler. */
  readonly brandPlugin?: BrandPlugin | undefined;
  /** Theme stylesheet relative to `root`; `false` compiles with no project theme. Default `theme.css`. */
  readonly theme?: string | false | undefined;
  /**
   * Where imported assets are served from. A template that imports none needs none; an import
   * with no base is a finding.
   */
  readonly assetBase?: string | undefined;
}

/** A project compiled: its catalog, and the findings about the project as a whole. */
export interface LoadedProject {
  readonly root: string;
  readonly files: ProjectFiles;
  readonly catalog: CompiledProject;
  /** The theme path, project-relative; `undefined` when theming is off or the file is absent. */
  readonly themePath: string | undefined;
  readonly brand: BrandResolution;
  /** Brand findings and project-level findings (a duplicate id). */
  readonly diagnostics: readonly EmailDiagnostic[];
}

/** Resolve the root a set of options names. */
export const projectRoot = (options: Pick<ProjectOptions, "root">): string =>
  resolve(options.root ?? process.cwd());

/**
 * Read, resolve the brand of, and compile every template in a project. `only`
 * limits compilation to the named project-relative entries.
 */
export const loadProject = async (
  options: ProjectOptions = {},
  only?: readonly string[] | undefined,
): Promise<LoadedProject> => {
  const root = projectRoot(options);
  const dirs = await templateDirectories(root, options.dir);
  const [discovered, files] = await Promise.all([
    discoverEntries(root, dirs),
    readProjectFiles(root),
  ]);
  const entries =
    only === undefined ? discovered : discovered.filter((path) => only.includes(path));
  const themeFile = resolveThemePath(root, options.theme);
  const themeCss = await readProjectThemeCss(themeFile);
  const themePath =
    themeFile === undefined || themeCss === undefined
      ? undefined
      : projectThemePath(root, themeFile);
  const brand = await resolveBrand(files, themePath, options.brandResolver, options.brandPlugin);
  const catalog = await compileProject({
    files,
    entries,
    assetBase: options.assetBase ?? "",
    brandPlugin: options.brandPlugin,
    ...(themeCss === undefined || themePath === undefined
      ? {}
      : { theme: { css: themeCss, path: themePath } }),
    ...(brand.ok && brand.brand !== undefined ? { brand: brand.brand } : {}),
  });
  return {
    root,
    files,
    catalog,
    themePath,
    brand,
    diagnostics: [...brandDiagnostics(brand), ...catalog.diagnostics],
  };
};

/** Paths under these are the tool's own output, not project source. */
const IGNORED_WATCH = [SAMVA_DIR, ".git", "node_modules"];

/** A live project over a directory, reloaded when its source changes. */
export interface ProjectSession {
  readonly load: () => Promise<LoadedProject>;
  readonly current: () => LoadedProject | undefined;
  /** Called with the project-relative path of each changed file; `.samva/` and `node_modules` are ignored. */
  readonly subscribe: (listener: (path: string) => void) => () => void;
  readonly close: () => Promise<void>;
}

/**
 * The authoring loop: one watcher, one brand resolver, a catalog reloaded on
 * demand. Each `load` re-reads the project and recompiles every template, so a
 * partial that changed reaches every template that imports it.
 */
export const createProjectSession = (options: ProjectOptions = {}): ProjectSession => {
  const root = projectRoot(options);
  let latest: LoadedProject | undefined;
  const listeners = new Set<(path: string) => void>();
  const observer = watch(root, { recursive: true }, (_event, name) => {
    const changed = name === null ? "" : toPosix(name.toString());
    if (IGNORED_WATCH.some((ignored) => changed === ignored || changed.startsWith(`${ignored}/`)))
      return;
    if (changed.split("/").includes("node_modules")) return;
    for (const listener of listeners) listener(changed);
  });
  return {
    load: async () => {
      latest = await loadProject(options);
      return latest;
    },
    current: () => latest,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: async () => {
      observer.close();
      listeners.clear();
    },
  };
};

export interface ExportedFixture {
  readonly fixture: string;
  readonly html?: string | undefined;
  readonly text?: string | undefined;
  readonly sms?: string | undefined;
  readonly whatsapp?: string | undefined;
}

export interface ProjectExportReceipt {
  readonly templates: readonly {
    readonly id: string;
    readonly entryPath: string;
    readonly fixtures: readonly ExportedFixture[];
  }[];
  readonly assets: { readonly base: string; readonly assets: readonly AssetEntry[] };
  readonly diagnostics: readonly EmailDiagnostic[];
}

/**
 * Where an export serves its assets from when the caller names no origin.
 *
 * An export writes one page at `templates/<id>/<fixture>.html` and every asset
 * once at `assets/<content address>`, so the base a page resolves against is
 * the path from its own directory back to that one. A template id is one path
 * segment, so every page sits at the same depth and one base serves them all.
 */
export const DEFAULT_EXPORT_ASSET_BASE = "../../assets";

/**
 * The path an export writes, or `undefined` when a name would leave the root.
 * The compiler already refuses an id or a fixture key that is not one path
 * segment, so this is the guard rather than the contract: the same pattern,
 * plus a containment check, so a name that reaches `join` can never address a
 * file the export does not own.
 */
const exportPath = (out: string, ...segments: readonly string[]): string | undefined => {
  if (!segments.every((segment) => TEMPLATE_NAME_PATTERN.test(segment))) return undefined;
  const path = join(out, ...segments);
  const inside = relative(out, path);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
    ? undefined
    : path;
};

const unsafeExportName = (kind: string, value: string): EmailDiagnostic =>
  finding(
    "unsafe-export-name",
    "error",
    `${kind} ${JSON.stringify(value)} is not one path segment, so an export cannot write a file for it. Use letters, digits, ".", "_" and "-", starting with a letter, digit or "_".`,
  );

/**
 * Render every template's fixtures to files beside the bytes of every asset they
 * reference, with the manifest that maps each address to its file. Email
 * fixtures write `<fixture>.html` and `<fixture>.txt`; a template's SMS and
 * WhatsApp channels write `<fixture>.sms.txt` and `<fixture>.whatsapp.json`.
 *
 * A relative `assetBase` is accepted, and the written page resolves its images
 * from the directory it sits in. Delivery keeps refusing relative references,
 * because an inbox has no directory to resolve one against, so an export
 * destined for sending names the https origin it will be served from instead.
 */
export const exportProject = async (
  input: ProjectOptions & { readonly out: string },
): Promise<ProjectExportReceipt> => {
  const out = resolve(input.out);
  const base = input.assetBase ?? DEFAULT_EXPORT_ASSET_BASE;
  const project = await loadProject({ ...input, assetBase: compileBase(base) });
  const { catalog } = project;
  const diagnostics: EmailDiagnostic[] = [
    ...project.diagnostics,
    ...catalog.failures.flatMap((failure) => failure.diagnostics),
    ...catalog.templates.flatMap((entry) => entry.diagnostics),
  ];
  const templates: ProjectExportReceipt["templates"][number][] = [];
  // oxlint-disable no-await-in-loop -- A few small writes per template; sequential keeps the receipt in catalog order.
  for (const entry of catalog.templates) {
    const directory = exportPath(out, "templates", entry.id);
    if (directory === undefined) {
      diagnostics.push(unsafeExportName("Template id", entry.id));
      continue;
    }
    await mkdir(directory, { recursive: true });
    const rendered = entry.channels.includes("email") ? renderEmailFixtures(entry) : [];
    const exported: ExportedFixture[] = [];
    for (const fixture of Object.keys(entry.fixtures)) {
      const write = async (name: string, content: string): Promise<string | undefined> => {
        const path = exportPath(out, "templates", entry.id, name);
        if (path === undefined) {
          diagnostics.push(unsafeExportName("Fixture name", fixture));
          return undefined;
        }
        await writeFile(path, content, "utf8");
        return toPosix(relative(out, path));
      };
      const email = rendered.find((result) => result.fixture === fixture);
      diagnostics.push(...(email?.diagnostics ?? []));
      const sms = entry.channels.includes("sms")
        ? renderChannelFixture(entry, "sms", fixture)
        : undefined;
      const whatsapp = entry.channels.includes("whatsapp")
        ? renderChannelFixture(entry, "whatsapp", fixture)
        : undefined;
      for (const result of [sms, whatsapp])
        if (result?.ok === false) diagnostics.push(...result.diagnostics);
      exported.push({
        fixture,
        ...(email?.rendered === undefined
          ? {}
          : {
              html: await write(`${fixture}.html`, restoreBase(email.rendered.html, base)),
              text: await write(`${fixture}.txt`, email.rendered.text),
            }),
        ...(sms?.ok === true && sms.channel === "sms"
          ? { sms: await write(`${fixture}.sms.txt`, sms.text) }
          : {}),
        ...(whatsapp?.ok === true && whatsapp.channel === "whatsapp"
          ? {
              whatsapp: await write(
                `${fixture}.whatsapp.json`,
                restoreBase(JSON.stringify(whatsapp.message, null, 2), base),
              ),
            }
          : {}),
      });
    }
    templates.push({ id: entry.id, entryPath: entry.entryPath, fixtures: exported });
  }
  // oxlint-enable no-await-in-loop

  // The address is the file name, so the manifest is the whole mapping an
  // exported page needs: `<base>/<fileName>` is the URL the compiler wrote.
  const assetDirectory = join(out, "assets");
  if (catalog.assets.length > 0) await mkdir(assetDirectory, { recursive: true });
  await Promise.all(
    catalog.assets.map((asset) => {
      const bytes = project.files[asset.path];
      return bytes === undefined || typeof bytes === "string"
        ? Promise.resolve()
        : writeFile(join(assetDirectory, asset.fileName), bytes);
    }),
  );
  const receipt: ProjectExportReceipt = {
    templates,
    assets: { base, assets: catalog.assets },
    diagnostics,
  };
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "catalog.json"),
    `${JSON.stringify(
      {
        ...receipt,
        assets: {
          base,
          assets: catalog.assets.map((asset) => ({ ...asset, url: assetUrl(asset, base) })),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return receipt;
};
