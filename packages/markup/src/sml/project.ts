import { isAssetPath } from "../email/assets";
import { parseBrandSpecifier, type BrandPlugin } from "../email/brand-plugin";
import { projectDirectory, resolveFromDirectory } from "../email/theme-imports";
import {
  child,
  children,
  parseSource,
  SourceSyntaxError,
  text,
  unwrap,
  type Node,
  type ParsedSource,
} from "./ast";
import type { Findings } from "./diagnostics";

// The project loader reads the entry and every project file it imports, without evaluating any of
// them. It answers structural questions: which names does this module import, and from where;
// which top-level declarations does it own; what does it export.

const MARKUP_SPECIFIER = "@samva/markup";
const MARKUP_PREFIX = "@samva/markup/";
/** Entries a template could import that moved; each is reported with its replacement. */
const MOVED_MARKUP_ENTRIES: Readonly<Record<string, string>> = {
  "@samva/markup/email/components": "@samva/markup/email",
};

/** Where an imported name comes from. */
export type ImportBinding =
  /** A name exported by another project script. `imported` is `default` for a default import. */
  | {
      readonly kind: "project";
      readonly path: string;
      readonly imported: string;
      readonly node: Node;
    }
  /** A name from `@samva/markup` or one of its subpaths. */
  | {
      readonly kind: "markup";
      readonly specifier: string;
      readonly imported: string;
      readonly node: Node;
    }
  /** A default import of a project file that becomes an asset. */
  | { readonly kind: "asset"; readonly path: string; readonly node: Node }
  /** A name from the brand plugin's brand import. */
  | {
      readonly kind: "brand";
      readonly specifier: string;
      readonly imported: string;
      readonly node: Node;
    };

interface TopLevel {
  /** The declared value: a `const` initializer, or the function itself. */
  readonly value: Node;
  readonly node: Node;
}

export interface ProjectModule {
  readonly path: string;
  readonly parsed: ParsedSource;
  readonly imports: ReadonlyMap<string, ImportBinding>;
  /** Project stylesheets and scripts this module imports for effect or by name, in source order. */
  readonly ordered: readonly { readonly kind: "css" | "script"; readonly path: string }[];
  readonly declarations: ReadonlyMap<string, TopLevel>;
  /** `export` names to the local declaration name they expose. */
  readonly exports: ReadonlyMap<string, string>;
  /** The expression `export default` exposes, when the module has one. */
  readonly defaultExport: Node | undefined;
}

export interface Project {
  readonly modules: ReadonlyMap<string, ProjectModule>;
  readonly entry: ProjectModule;
  /** Local names imported from project files that were absent (only in a lenient load). */
  readonly unresolved: ReadonlySet<string>;
}

export interface LoadOptions {
  /** Names the brand import a script may make. */
  readonly brandPlugin: BrandPlugin;
  /**
   * Treat a relative import of a file the project does not hold as a name to be found later,
   * not a finding: the caller holds only part of the project.
   */
  readonly lenient?: boolean | undefined;
}

const SCRIPT_EXTENSIONS = [".tsx", ".ts"];

/** Resolve a relative specifier to a project file, or `undefined`. */
const resolveSpecifier = (
  from: string,
  specifier: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): string | undefined => {
  const base = resolveFromDirectory(projectDirectory(from), specifier.replace(/[?#].*$/, ""));
  if (base === undefined) return undefined;
  if (Object.hasOwn(files, base)) return base;
  for (const extension of SCRIPT_EXTENSIONS)
    if (Object.hasOwn(files, `${base}${extension}`)) return `${base}${extension}`;
  for (const extension of SCRIPT_EXTENSIONS)
    if (Object.hasOwn(files, `${base}/index${extension}`)) return `${base}/index${extension}`;
  return undefined;
};

const isScriptPath = (path: string): boolean => /\.[cm]?[jt]sx?$/.test(path);

const declaredNames = (pattern: Node): readonly string[] =>
  pattern.type === "Identifier" ? [text(pattern, "name") ?? ""] : [];

/** Load the entry and everything it imports from the project. */
export const loadProject = (
  files: Readonly<Record<string, string | Uint8Array>>,
  entryPath: string,
  findings: Findings,
  loadOptions: LoadOptions,
): Project | undefined => {
  const modules = new Map<string, ProjectModule>();
  const unresolved = new Set<string>();
  const loading = new Set<string>();
  let failed = false;

  const load = (path: string): ProjectModule | undefined => {
    const existing = modules.get(path);
    if (existing !== undefined) return existing;
    if (loading.has(path)) return undefined;
    const raw = files[path];
    if (raw === undefined) return undefined;
    const source = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let parsed: ParsedSource;
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- A syntax error becomes a located diagnostic.
    try {
      parsed = parseSource(path, source);
    } catch (error) {
      if (!(error instanceof SourceSyntaxError)) throw error; // oxlint-disable-line samva/no-try-catch-or-throw -- Not a statement about the source.
      findings.items.push({
        code: "syntax-error",
        severity: "error",
        message: error.message,
        origins: [{ fileName: path, lineNumber: error.line, columnNumber: error.column }],
      });
      failed = true;
      return undefined;
    }
    loading.add(path);
    const imports = new Map<string, ImportBinding>();
    const ordered: { kind: "css" | "script"; path: string }[] = [];
    const declarations = new Map<string, TopLevel>();
    const exports = new Map<string, string>();
    let defaultExport: Node | undefined;

    const noteDeclaration = (node: Node): void => {
      if (node.type === "VariableDeclaration") {
        for (const declarator of children(node, "declarations")) {
          const id = child(declarator, "id");
          const init = child(declarator, "init");
          if (id === undefined || init === undefined) continue;
          for (const name of declaredNames(id))
            declarations.set(name, { value: unwrap(init), node });
        }
      } else if (node.type === "FunctionDeclaration") {
        const name = text(child(node, "id") ?? node, "name");
        if (name !== undefined) declarations.set(name, { value: node, node });
      }
    };

    for (const statement of children(parsed.program, "body")) {
      switch (statement.type) {
        case "ImportDeclaration": {
          const specifier = text(child(statement, "source") ?? statement, "value") ?? "";
          const typeOnly = text(statement, "importKind") === "type";
          const specifiers = children(statement, "specifiers");
          if (typeOnly) break;
          const local = (node: Node) => text(child(node, "local") ?? node, "name") ?? "";
          const importedName = (node: Node): string => {
            if (node.type === "ImportDefaultSpecifier") return "default";
            if (node.type === "ImportNamespaceSpecifier") return "*";
            const imported = child(node, "imported");
            return imported === undefined
              ? local(node)
              : (text(imported, "name") ?? text(imported, "value") ?? local(node));
          };
          const moved = MOVED_MARKUP_ENTRIES[specifier];
          if (moved !== undefined) {
            findings.add(
              parsed,
              child(statement, "source") ?? statement,
              "moved-import",
              `\`${specifier}\` moved to \`${moved}\`; the imported names are unchanged.`,
              `Import from "${moved}".`,
            );
            failed = true;
            break;
          }
          if (specifier === MARKUP_SPECIFIER || specifier.startsWith(MARKUP_PREFIX)) {
            for (const item of specifiers) {
              if (text(item, "importKind") === "type") continue;
              imports.set(local(item), {
                kind: "markup",
                specifier,
                imported: importedName(item),
                node: item,
              });
            }
            break;
          }
          if (parseBrandSpecifier(specifier, loadOptions.brandPlugin) !== undefined) {
            for (const item of specifiers)
              if (text(item, "importKind") !== "type")
                imports.set(local(item), {
                  kind: "brand",
                  specifier,
                  imported: importedName(item),
                  node: item,
                });
            break;
          }
          if (!/^\.{0,2}\//.test(specifier)) {
            findings.add(
              parsed,
              statement,
              "non-project-import",
              `\`${specifier}\` is not part of the project; templates import only @samva/markup and files inside the project.`,
              "Remove the import, or copy the code you need into a project file.",
            );
            failed = true;
            break;
          }
          const resolved = resolveSpecifier(path, specifier, files);
          if (resolved === undefined && loadOptions.lenient === true) {
            const missing = resolveFromDirectory(
              projectDirectory(path),
              specifier.replace(/[?#].*$/, ""),
            );
            const asset = missing !== undefined && isAssetPath(missing);
            const script =
              missing !== undefined && (isScriptPath(missing) || !/\.[a-z0-9]+$/i.test(missing));
            if (missing !== undefined && (missing.endsWith(".css") || asset || script)) {
              if (!missing.endsWith(".css"))
                for (const item of specifiers) {
                  if (asset) imports.set(local(item), { kind: "asset", path: missing, node: item });
                  else {
                    unresolved.add(local(item));
                    imports.set(local(item), {
                      kind: "project",
                      path: missing,
                      imported: importedName(item),
                      node: item,
                    });
                  }
                }
              break;
            }
          }
          if (resolved === undefined) {
            findings.add(
              parsed,
              statement,
              "unresolved-import",
              `\`${specifier}\` names no file in the project.`,
              "Check the path and the file extension.",
            );
            failed = true;
            break;
          }
          if (resolved.endsWith(".css")) {
            ordered.push({ kind: "css", path: resolved });
            break;
          }
          if (isAssetPath(resolved)) {
            for (const item of specifiers)
              imports.set(local(item), { kind: "asset", path: resolved, node: item });
            break;
          }
          if (isScriptPath(resolved)) {
            ordered.push({ kind: "script", path: resolved });
            for (const item of specifiers)
              imports.set(local(item), {
                kind: "project",
                path: resolved,
                imported: importedName(item),
                node: item,
              });
            break;
          }
          findings.add(
            parsed,
            statement,
            "unresolved-import",
            `\`${specifier}\` is a file type templates cannot import.`,
            "Import a script, a stylesheet or an asset such as .png or .woff2.",
          );
          failed = true;
          break;
        }
        case "ExportNamedDeclaration": {
          const declaration = child(statement, "declaration");
          if (declaration !== undefined) {
            noteDeclaration(declaration);
            if (declaration.type === "VariableDeclaration")
              for (const declarator of children(declaration, "declarations"))
                for (const name of declaredNames(child(declarator, "id") ?? declarator))
                  exports.set(name, name);
            else if (declaration.type === "FunctionDeclaration") {
              const name = text(child(declaration, "id") ?? declaration, "name");
              if (name !== undefined) exports.set(name, name);
            }
          } else {
            for (const item of children(statement, "specifiers")) {
              const exported = child(item, "exported");
              const localNode = child(item, "local");
              const exportedName =
                exported === undefined
                  ? undefined
                  : (text(exported, "name") ?? text(exported, "value"));
              const localName = localNode === undefined ? undefined : text(localNode, "name");
              if (exportedName !== undefined && localName !== undefined)
                exports.set(exportedName, localName);
            }
          }
          break;
        }
        case "ExportDefaultDeclaration": {
          const declaration = child(statement, "declaration");
          if (declaration !== undefined) defaultExport = unwrap(declaration);
          break;
        }
        case "VariableDeclaration":
        case "FunctionDeclaration":
          noteDeclaration(statement);
          break;
        default:
          break;
      }
    }
    const module: ProjectModule = {
      path,
      parsed,
      imports,
      ordered,
      declarations,
      exports,
      defaultExport,
    };
    modules.set(path, module);
    loading.delete(path);
    for (const item of ordered) if (item.kind === "script") load(item.path);
    return module;
  };

  const entry = load(entryPath);
  if (entry === undefined || failed) return undefined;
  return { modules, entry, unresolved };
};
