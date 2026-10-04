import type { EmailDiagnostic } from "./diagnostics";

// What a render needs to know about project fonts, over values the compiler
// already parsed: the faces a stylesheet declares, and whether a stack that
// names one ends in a generic family. It parses no CSS, so it stays in the
// render bundle without a CSS parser; `./fonts` owns parsing `@font-face`.

/** One `@font-face` rule, its `src` already resolved to served URLs. */
export interface FontFaceRule {
  /** The family the rule declares, unquoted. */
  readonly family: string;
  /** The rule as it goes into the email's `<head>`. */
  readonly css: string;
}

/** Generic families every email client understands as the last resort in a stack. */
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy"]);

/** One family name as written, without its quotes and with runs of spaces collapsed. */
export const unquote = (value: string): string => {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length >= 2
    ? trimmed.slice(1, -1)
    : trimmed.replace(/\s+/g, " ");
};

/** The families of a `font-family` value, unquoted, in stack order. */
export const fontStackFamilies = (value: string): readonly string[] => {
  const families: string[] = [];
  let start = 0;
  let quote: string | undefined;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === ",") {
      families.push(unquote(value.slice(start, index)));
      start = index + 1;
    }
  }
  families.push(unquote(value.slice(start)));
  return families.filter((family) => family !== "");
};

const FONT_SIZE =
  /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-z]+|%)|(?:calc|clamp|min|max|var)\(.*\))$/i;

/** Whitespace-separated tokens at the top level, keeping parentheses and quotes whole. */
const shorthandTokens = (value: string): readonly string[] => {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  for (const character of value.trim()) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (/\s/.test(character) && depth === 0) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") tokens.push(current);
  return tokens;
};

/**
 * The family list of a `font` shorthand: everything after the size (and its
 * optional line height), or `undefined` for a system-font keyword that names
 * no family.
 */
export const fontShorthandFamilies = (value: string): string | undefined => {
  const tokens = shorthandTokens(value);
  const size = tokens.findIndex((token) => FONT_SIZE.test(token.replace(/\/.*$/, "")));
  if (size < 0) return undefined;
  // The line height follows a slash, which may sit on either token or alone:
  // `16px/24px`, `16px/ 24px`, `16px /24px`, `16px / 24px`.
  let next = size + 1;
  const sizeToken = tokens[size]!;
  if (sizeToken.endsWith("/")) next += 1;
  else if (!sizeToken.includes("/") && tokens[next]?.startsWith("/"))
    next += tokens[next] === "/" ? 2 : 1;
  const family = tokens.slice(next).join(" ");
  return family === "" ? undefined : family;
};

/**
 * True when a stack names a declared project family without ending in a
 * generic. `declared` holds lowercased family names. A quoted `"sans-serif"`
 * names a font called sans-serif, not the generic, so it does not count.
 */
export const lacksGenericFallback = (value: string, declared: ReadonlySet<string>): boolean => {
  const stack = value.replace(/\s*!important\s*$/i, "");
  const families = fontStackFamilies(stack);
  if (!families.some((family) => declared.has(family.toLowerCase()))) return false;
  const last = stack.slice(stack.lastIndexOf(",") + 1).trim();
  return !GENERIC_FAMILIES.has(last.toLowerCase());
};

export const fontFallbackDiagnostic = (value: string): Omit<EmailDiagnostic, "origins"> => ({
  code: "email-font-fallback",
  severity: "error",
  message: `font-family ${JSON.stringify(value)} uses a project font without a generic fallback. Clients that drop webfonts (Gmail, classic Outlook) render this stack as written, so end it with sans-serif, serif or monospace.`,
});
