import { buildLineMap, lineColumn } from "../diagnostic-model";
import { brandTailwindCss, parseBrandCss } from "../theme-css";
import { assetEntry, assetUrl, checkAssetBase, isAssetPath, type AssetEntry } from "./assets";
import { BRAND_COMPONENT_CLASSES, type EmailBrand } from "./brand";
import { brandSpecifierPattern, parseBrandSpecifier, type BrandPlugin } from "./brand-plugin";
import { parseStylesheet, type Stylesheet } from "./css";
import { EmailCompileError, type EmailDiagnostic } from "./diagnostics";
import { samvaBrandPlugin } from "./samva-brand-plugin";
import { compileTailwind, discoverClassCandidates, type TailwindOptions } from "./tailwind";
import { projectDirectory, resolveFromDirectory, resolveThemeImports } from "./theme-imports";

// The project transform: the parts of a template project that are not its TSX. Every host — the
// Vite plugin, the hosted build, a standalone export — passes its files through it before the
// static compiler lowers the entry, so the theme, the brand, the addressed assets and the
// Tailwind sheet are the same wherever a template is compiled.

/** Where this build serves assets from, and how Tailwind is configured. */
export interface TransformOptions {
  readonly assetBase: string;
  /** `false` compiles no Tailwind at all. */
  readonly tailwind?: TailwindOptions | false | undefined;
  /**
   * The brand the brand import resolves to, supplied by the host. A project
   * that imports a brand with no brand here fails to compile.
   */
  readonly brand?: EmailBrand | undefined;
  /** Names the brand import and marks the footer `BrandFooter` renders; `samvaBrandPlugin` when omitted. */
  readonly brandPlugin?: BrandPlugin | undefined;
}

/** What reading one project file contributes. */
interface FileReading {
  readonly asset?: AssetEntry | undefined;
  /** Class names this file states literally, for the Tailwind candidate set. */
  readonly classes?: readonly string[] | undefined;
  /** The parsed rules, for a stylesheet. */
  readonly sheet?: Stylesheet | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
}

const SCRIPT = /\.[cm]?[jt]sx?$/;

/**
 * The project path a stylesheet URL names, resolved from the stylesheet's own
 * directory (a leading `/` means the project root), or `undefined` when it
 * climbs out of the project.
 */
export const resolveProjectPath = (from: string, reference: string): string | undefined =>
  resolveFromDirectory(projectDirectory(from), reference.replace(/[?#].*$/, ""));

const readStylesheet = (
  id: string,
  source: string,
  options: TransformOptions,
  assets: ReadonlyMap<string, AssetEntry> = new Map(),
  themeImports = false,
): FileReading => {
  const sheet = parseStylesheet(source, {
    origin: id,
    themeImports,
    resolveFontFile: (reference) => {
      const path = resolveProjectPath(id, reference);
      const entry = path === undefined ? undefined : assets.get(path);
      return entry === undefined ? undefined : assetUrl(entry, options.assetBase);
    },
  });
  const registered: Stylesheet = {
    rules: sheet.rules,
    headAtRules: sheet.headAtRules,
    fontFaces: sheet.fontFaces,
    variables: sheet.variables,
    diagnostics: [],
  };
  return { sheet: registered, diagnostics: sheet.diagnostics };
};

/**
 * Read one project file. A stylesheet is parsed, with its `@font-face` sources resolved against
 * `assets`, the project's addressed files by path. An imported binary is content-addressed. A
 * script contributes the utility classes it states literally.
 */
const readFile = async (
  id: string,
  source: string | Uint8Array,
  options: TransformOptions,
  assets?: ReadonlyMap<string, AssetEntry>,
): Promise<FileReading> => {
  if (isAssetPath(id)) {
    const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
    return { asset: await assetEntry(id, bytes), diagnostics: checkAssetBase(options.assetBase) };
  }
  const text = typeof source === "string" ? source : new TextDecoder().decode(source);
  if (id.endsWith(".css")) return readStylesheet(id, text, options, assets);
  if (!SCRIPT.test(id)) return { diagnostics: [] };
  const discovered = options.tailwind === false ? undefined : discoverClassCandidates(text, id);
  return { classes: discovered?.candidates, diagnostics: discovered?.diagnostics ?? [] };
};

export interface ProjectTransform {
  readonly assets: readonly AssetEntry[];
  /** The compiled Tailwind sheet, when the project used any utility class. */
  readonly tailwindSheet: Stylesheet | undefined;
  /** Every project stylesheet, parsed, by path. */
  readonly stylesheets: ReadonlyMap<string, Stylesheet>;
  readonly diagnostics: readonly EmailDiagnostic[];
}

/** The Tailwind sheet's stylesheet origin. */
const TAILWIND_ORIGIN = ".samva-tailwind.css";

/** The brand specifier, bare or with a slug, as a module specifier in an import or export. */
const brandModuleSpecifier = (plugin: BrandPlugin): RegExp =>
  new RegExp(`(\\b(?:from|import)\\s*\\(?\\s*)(["'])(${brandSpecifierPattern(plugin)})\\2`, "g");

/** The brand specifiers a script imports, with where it asks for each. */
const scriptBrandImports = (
  path: string,
  source: string,
  plugin: BrandPlugin,
): readonly BrandRequest[] => {
  const lines = buildLineMap(source);
  return [...source.matchAll(brandModuleSpecifier(plugin))].map((match) => {
    const at = lineColumn(lines, match.index + match[1]!.length);
    return {
      specifier: match[3]!,
      origin: { fileName: path, lineNumber: at.line, columnNumber: at.column },
    };
  });
};

interface BrandRequest {
  readonly specifier: string;
  readonly origin: {
    readonly fileName: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
}

interface ResolvedTheme {
  readonly stylesheets: ReadonlyMap<string, string>;
  readonly brandCss: string | undefined;
  readonly brandPlugin: BrandPlugin;
  /** The brand the project's TSX imports components from, when it does. */
  readonly brandModule: EmailBrand | undefined;
}

/**
 * The brand specifier a project imports — from its theme's `@import`s or its
 * TSX — so a host can fetch that brand before it compiles. `undefined` when
 * the project imports no brand. A project that names two brands gets the
 * first here and a refusal from the compile.
 */
export const projectBrandSpecifier = (
  files: Readonly<Record<string, string | Uint8Array>>,
  themePath = "theme.css",
  brandPlugin: BrandPlugin = samvaBrandPlugin,
): string | undefined => {
  const theme = files[themePath];
  const fromTheme =
    typeof theme === "string"
      ? resolveThemeImports(themePath, theme, files, brandPlugin).brandSpecifiers
      : [];
  const fromScripts = Object.keys(files)
    .sort()
    .filter((path) => SCRIPT.test(path) && typeof files[path] === "string")
    .flatMap((path) => scriptBrandImports(path, files[path] as string, brandPlugin))
    .map((request) => request.specifier);
  return [...fromTheme, ...fromScripts][0];
};

/**
 * The theme stylesheet's `@import` graph and the brand the project reaches,
 * resolved before anything compiles. An import the compiler cannot resolve, a
 * brand the build was not given, two different brands, or a brand theme
 * outside its grammar refuses the whole compile: a theme that silently lost a
 * layer would ship the wrong look.
 */
const resolveTheme = (
  files: Readonly<Record<string, string | Uint8Array>>,
  tailwind: TailwindOptions | undefined,
  brand: EmailBrand | undefined,
  brandPlugin: BrandPlugin,
): ResolvedTheme => {
  const refusals: EmailDiagnostic[] = [];
  const css = tailwind?.css;
  const themePath = tailwind?.cssPath ?? "theme.css";
  const imports =
    css === undefined ? undefined : resolveThemeImports(themePath, css, files, brandPlugin);
  refusals.push(...(imports?.diagnostics ?? []));
  const themeOrigin = { fileName: themePath, lineNumber: 1, columnNumber: 1 };
  const cssRequests = (imports?.brandSpecifiers ?? []).map((specifier) => ({
    specifier,
    origin: themeOrigin,
  }));
  const scriptRequests = Object.keys(files)
    .sort()
    .filter((path) => SCRIPT.test(path) && typeof files[path] === "string")
    .flatMap((path) => scriptBrandImports(path, files[path] as string, brandPlugin));
  const requests = [...cssRequests, ...scriptRequests];
  const specifiers = [...new Set(requests.map((request) => request.specifier))];
  if (specifiers.length > 1)
    refusals.push({
      code: "brand-import-conflict",
      severity: "error",
      message: `The project imports ${specifiers.join(" and ")}; a project compiles against one brand.`,
      origins: requests.map((request) => request.origin),
    });
  else if (specifiers.length === 1) {
    const specifier = specifiers[0]!;
    const named = parseBrandSpecifier(specifier, brandPlugin)?.slug;
    const origins = [requests[0]!.origin];
    if (brand === undefined)
      refusals.push({
        code: "brand-unavailable",
        severity: "error",
        message: `${origins[0]!.fileName} imports ${specifier}, but this build has no brand to resolve it.`,
        origins,
      });
    else if (named !== undefined && named !== brand.slug)
      refusals.push({
        code: "brand-unavailable",
        severity: "error",
        message: `${origins[0]!.fileName} imports ${specifier}, but this build resolved brand ${brand.slug}.`,
        origins,
      });
  }
  let brandCss: string | undefined;
  if (refusals.length === 0 && brand !== undefined && cssRequests.length > 0) {
    const parsed = parseBrandCss(brand.css);
    if (parsed.isOk()) brandCss = brandTailwindCss(parsed.value);
    else {
      const lines = buildLineMap(brand.css);
      const specifier = cssRequests[0]!.specifier;
      for (const finding of parsed.error) {
        const at = lineColumn(lines, finding.span.start);
        refusals.push({
          code: finding.code,
          severity: "error",
          message: `${specifier}: ${finding.message}`,
          origins: [{ fileName: specifier, lineNumber: at.line, columnNumber: at.column }],
        });
      }
    }
  }
  if (refusals.length > 0)
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- A compile refusal is thrown as EmailCompileError, as every other compile refusal is.
    throw new EmailCompileError({ diagnostics: refusals });
  return {
    stylesheets: imports?.stylesheets ?? new Map(),
    brandCss,
    brandPlugin,
    brandModule: scriptRequests.length > 0 ? brand : undefined,
  };
};

/** Read a whole project, then compile the classes its scripts used. */
export const transformProject = async (
  files: Readonly<Record<string, string | Uint8Array>>,
  options: TransformOptions,
): Promise<ProjectTransform> => {
  const assets: AssetEntry[] = [];
  const diagnostics: EmailDiagnostic[] = [];
  const stylesheets = new Map<string, Stylesheet>();
  const classes = new Set<string>();
  const wanted = options.tailwind === false ? undefined : (options.tailwind ?? {});
  const theme = resolveTheme(files, wanted, options.brand, options.brandPlugin ?? samvaBrandPlugin);
  if (theme.brandModule !== undefined)
    for (const name of BRAND_COMPONENT_CLASSES) classes.add(name);
  // Sorted paths make the walk deterministic. Binaries are addressed first, because a
  // stylesheet's `@font-face` resolves to their URLs; within each phase the reads are independent,
  // so they run together.
  const paths = Object.keys(files).sort();
  const binaries = new Map(
    await Promise.all(
      paths
        .filter(isAssetPath)
        .map(async (path) => [path, await readFile(path, files[path]!, options)] as const),
    ),
  );
  const addressed = new Map(
    [...binaries].flatMap(([path, reading]) =>
      reading.asset === undefined ? [] : [[path, reading.asset] as const],
    ),
  );
  const readings = await Promise.all(
    paths.map(
      (path) =>
        binaries.get(path) ??
        (theme.stylesheets.has(path)
          ? readStylesheet(path, theme.stylesheets.get(path)!, options, addressed, true)
          : readFile(path, files[path]!, options, addressed)),
    ),
  );
  for (const [index, path] of paths.entries()) {
    const reading = readings[index]!;
    if (reading.asset !== undefined) assets.push(reading.asset);
    if (reading.sheet !== undefined) stylesheets.set(path, reading.sheet);
    for (const name of reading.classes ?? []) classes.add(name);
    diagnostics.push(...reading.diagnostics);
  }
  // A theme with no utility in use still carries `@font-face` rules and variables the project's
  // own stylesheets read, so it compiles regardless.
  if (
    wanted === undefined ||
    (classes.size === 0 && (wanted.safelist?.length ?? 0) === 0 && wanted.css === undefined)
  )
    return { assets, tailwindSheet: undefined, stylesheets, diagnostics };
  const compiled = await compileTailwind(classes, wanted, theme);
  const generated = readStylesheet(TAILWIND_ORIGIN, compiled.css, options, addressed);
  // The project CSS Tailwind compiled is usually also a project file, already reported under its
  // own name; a font finding only it carries still surfaces.
  const findingKey = (diagnostic: EmailDiagnostic) =>
    `${diagnostic.code}\0${diagnostic.message.slice(diagnostic.message.indexOf(": ") + 2)}`;
  const reported = new Set(diagnostics.map(findingKey));
  for (const diagnostic of generated.diagnostics)
    if (diagnostic.code.startsWith("email-font-") && !reported.has(findingKey(diagnostic)))
      diagnostics.push(diagnostic);
  return { assets, tailwindSheet: generated.sheet, stylesheets, diagnostics };
};
