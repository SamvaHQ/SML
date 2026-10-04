import { parse, type CssNode } from "css-tree";

import { buildLineMap, lineColumn } from "../diagnostic-model";
import { parseBrandSpecifier, type BrandPlugin } from "./brand-plugin";
import type { EmailDiagnostic } from "./diagnostics";

// The project theme is the one stylesheet Tailwind compiles, and `@import` is
// how it layers: the starter stylesheet first, then the brand import, then the
// project's own `@theme`. The compiler resolves exactly two kinds of import —
// another project `.css` file and the brand plugin's specifier — and refuses
// every other one before Tailwind runs, with the file and line that asked for
// it.

export interface ThemeImports {
  /** Every project stylesheet the theme reaches, by path, including the theme itself. */
  readonly stylesheets: ReadonlyMap<string, string>;
  /** The brand specifiers the theme imports. */
  readonly brandSpecifiers: readonly string[];
  readonly diagnostics: readonly EmailDiagnostic[];
}

/** The directory part of a project path, with no trailing slash (`""` at the root). */
export const projectDirectory = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** A relative or root-absolute stylesheet reference, resolved from a project directory. */
export const resolveFromDirectory = (directory: string, reference: string): string | undefined => {
  const segments = reference.startsWith("/") || directory === "" ? [] : directory.split("/");
  for (const segment of reference.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length === 0 ? undefined : segments.join("/");
};

const importTarget = (node: CssNode): { readonly target?: string; readonly extra: boolean } => {
  if (node.type !== "Atrule" || node.prelude === null || node.prelude.type !== "AtrulePrelude")
    return { extra: true };
  const parts = [...node.prelude.children].filter((part) => part.type !== "WhiteSpace");
  const first = parts[0];
  const target =
    first?.type === "String" ? first.value : first?.type === "Url" ? first.value : undefined;
  return target === undefined ? { extra: true } : { target, extra: parts.length > 1 };
};

/**
 * Walk the theme's `@import` graph. Project `.css` files resolve from the
 * importing file's directory; the plugin's brand specifier, bare or with a
 * slug, is recorded for the brand the build supplies. Anything else is an
 * error.
 */
export const resolveThemeImports = (
  themePath: string,
  themeCss: string,
  files: Readonly<Record<string, string | Uint8Array>>,
  brandPlugin: BrandPlugin,
): ThemeImports => {
  const brand = JSON.stringify(brandPlugin.specifier);
  const stylesheets = new Map<string, string>([[themePath, themeCss]]);
  const brandSpecifiers = new Set<string>();
  const diagnostics: EmailDiagnostic[] = [];
  const visit = (path: string, source: string, chain: readonly string[]): void => {
    const lineMap = buildLineMap(source);
    const ast = parse(source, { positions: true, parseValue: false, parseRulePrelude: false });
    if (ast.type !== "StyleSheet") return;
    for (const node of ast.children) {
      if (node.type !== "Atrule" || node.name.toLowerCase() !== "import") continue;
      const position = lineColumn(lineMap, node.loc?.start.offset ?? 0);
      const origins = [
        { fileName: path, lineNumber: position.line, columnNumber: position.column },
      ];
      const refuse = (message: string) =>
        diagnostics.push({ code: "css-import-unresolved", severity: "error", message, origins });
      const { target, extra } = importTarget(node);
      if (target === undefined) {
        refuse(`${path}: @import needs a quoted stylesheet path or ${brand}.`);
        continue;
      }
      if (extra) {
        refuse(
          `${path}: @import ${JSON.stringify(target)} takes no layer, supports or media conditions; the import order is the layering.`,
        );
        continue;
      }
      if (parseBrandSpecifier(target, brandPlugin) !== undefined) {
        brandSpecifiers.add(target);
        continue;
      }
      if (!/^\.{0,2}\//.test(target) || !/\.css$/i.test(target.replace(/[?#].*$/, ""))) {
        refuse(
          `${path}: @import ${JSON.stringify(target)} is not a project stylesheet or ${brand}. The compiler supplies Tailwind itself; import project .css files by relative path.`,
        );
        continue;
      }
      const resolved = resolveFromDirectory(projectDirectory(path), target.replace(/[?#].*$/, ""));
      const content = resolved === undefined ? undefined : files[resolved];
      if (resolved === undefined || typeof content !== "string") {
        refuse(`${path}: @import ${JSON.stringify(target)} names no stylesheet in the project.`);
        continue;
      }
      if (chain.includes(resolved)) {
        refuse(
          `${path}: @import ${JSON.stringify(target)} imports itself through ${chain.join(" → ")}.`,
        );
        continue;
      }
      if (stylesheets.has(resolved)) continue;
      stylesheets.set(resolved, content);
      visit(resolved, content, [...chain, resolved]);
    }
  };
  visit(themePath, themeCss, [themePath]);
  return { stylesheets, brandSpecifiers: [...brandSpecifiers].sort(), diagnostics };
};
