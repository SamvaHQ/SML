import { generate, parse, walk, type CssNode } from "css-tree";

import type { EmailDiagnostic } from "./diagnostics";
import { unquote, type FontFaceRule } from "./font-stacks";

export type { FontFaceRule } from "./font-stacks";

// A project font is an ordinary `@font-face` in the project's CSS whose `src`
// names a `.woff2` file in the project. The compiler turns that path into the
// file's content-addressed asset URL, exactly as it does for an imported image,
// so the same bytes reach the local preview, an export and a publication.
//
// Webfonts are an enhancement in email: Gmail and others drop `@font-face`, and
// classic Outlook renders a declared-but-unloadable family in Times New Roman.
// So every stack that names a project font has to end in a generic family —
// that stack is what most recipients see.

/**
 * Maps a relative `src` URL, as authored, to the URL its project file is served
 * from, or `undefined` when the project has no such file. The stylesheet's host
 * owns this: it knows which file the stylesheet came from and the asset base.
 */
export type FontFileResolver = (reference: string) => string | undefined;

const FONT_FILE = /\.woff2$/i;
const WOFF2_FORMAT = /^woff2(?:-variations)?$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const declarationValue = (declaration: CssNode): string =>
  declaration.type === "Declaration" ? generate(declaration.value).trim() : "";

/**
 * Validate one `@font-face` and rewrite its project-relative `src` URLs.
 * Accepts only WOFF2: a relative URL must name a `.woff2` file the project has,
 * and an `https:` URL stays an external reference. `local()` entries pass.
 */
export const compileFontFace = (
  node: CssNode,
  origin: string,
  resolve: FontFileResolver | undefined,
): {
  readonly rule: FontFaceRule | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
} => {
  const diagnostics: EmailDiagnostic[] = [];
  const fail = (code: string, message: string) =>
    diagnostics.push({ code, severity: "error", message: `${origin}: ${message}`, origins: [] });
  if (node.type !== "Atrule" || node.block === null || node.block.children === null)
    return { rule: undefined, diagnostics };
  let family: string | undefined;
  let sources = 0;
  for (const declaration of node.block.children) {
    if (declaration.type !== "Declaration") continue;
    const property = declaration.property.toLowerCase();
    if (property === "font-family") family = unquote(declarationValue(declaration));
    if (property !== "src") continue;
    const authored = declarationValue(declaration);
    let value: CssNode;
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- css-tree throws on a malformed value; the author gets a diagnostic instead.
    try {
      value = parse(authored, { context: "value" });
    } catch {
      fail("email-font-src", "@font-face src could not be parsed.");
      continue;
    }
    walk(value, {
      enter: (part: CssNode) => {
        if (part.type === "Function" && part.name.toLowerCase() === "format") {
          const format = unquote(generate(part).slice("format(".length, -1));
          if (!WOFF2_FORMAT.test(format))
            fail(
              "email-font-format",
              `@font-face format(${format}) is not supported. Email fonts are WOFF2 only; convert the file to .woff2.`,
            );
          return;
        }
        if (part.type !== "Url") return;
        sources++;
        const reference = part.value;
        const path = reference.replace(/[?#].*$/, "");
        if (/^https:\/\//i.test(reference)) {
          if (!FONT_FILE.test(path) && !/format\(\s*['"]?woff2/i.test(generate(value)))
            fail(
              "email-font-format",
              `@font-face src ${JSON.stringify(reference)} is not a WOFF2 file. Email fonts are WOFF2 only.`,
            );
          return;
        }
        if (SCHEME.test(reference) || reference.startsWith("//")) {
          fail(
            "email-font-src",
            `@font-face src ${JSON.stringify(reference)} must be a project .woff2 file or an https URL.`,
          );
          return;
        }
        if (!FONT_FILE.test(path)) {
          fail(
            "email-font-format",
            `@font-face src ${JSON.stringify(reference)} is not a .woff2 file. Email fonts are WOFF2 only; convert the file to .woff2.`,
          );
          return;
        }
        const url = resolve?.(reference);
        if (url === undefined) {
          fail(
            "email-font-missing",
            `@font-face src ${JSON.stringify(reference)} names no file in the project. Paths resolve from the stylesheet's own directory.`,
          );
          return;
        }
        part.value = url;
      },
    });
    // css-tree writes `url(…)format(…)` with no space between the two, which
    // some email clients' CSS parsers read as one token; keep the space.
    const rewritten = generate(value).replace(/\)(?=(?:format|tech)\()/gi, ") ");
    declaration.value = { type: "Raw", value: rewritten };
  }
  if (family === undefined || family === "")
    fail("email-font-family", "@font-face declares no font-family.");
  if (sources === 0) fail("email-font-src", "@font-face declares no url() src.");
  if (diagnostics.length > 0 || family === undefined) return { rule: undefined, diagnostics };
  return { rule: { family, css: generate(node) }, diagnostics };
};
