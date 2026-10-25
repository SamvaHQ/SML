import type {
  CompiledElement,
  CompiledNode,
  CompiledRaw,
  CompiledRawPart,
  CompiledSource,
  CompiledStyle,
  CompiledValue,
} from "../compiled-template";
import type { EmailNode } from "../email/jsx-runtime";
import { isObject } from "../internal/guards";
import { BRAND_FOOTER_MARKER } from "../internal/unsubscribe-link";
import { isStaticScalar } from "./nodes";

// The email primitives are ordinary functions from props to a tree, and they know things (the
// table markup every client accepts, the classic-Outlook fallbacks) that must not be written
// twice. Target lowering runs the real primitives, handing them a token where a
// prop or a child is read at render time, and turns the tree they return back into IR, putting
// each token's value or nodes back where it stands. A primitive that only passes a prop through
// is exact; one that computes from a prop (a button sizing its box from its label) is told so and
// asked for a literal.

const OPEN = "";
const CLOSE = "";
const TOKEN = /(\d+)/g;

type Entry = { readonly value: CompiledValue } | { readonly nodes: readonly CompiledNode[] };

/** Values and node lists a component call reads at render time, addressable from inside a string. */
export class Tokens {
  private readonly entries: Entry[] = [];

  value(value: CompiledValue): string {
    if (typeof value === "string") return value;
    this.entries.push({ value });
    return `${OPEN}${this.entries.length - 1}${CLOSE}`;
  }

  nodes(nodes: readonly CompiledNode[]): string {
    this.entries.push({ nodes });
    return `${OPEN}${this.entries.length - 1}${CLOSE}`;
  }

  /** A string with tokens in it, as static text and the entries it names. */
  parse(input: string): readonly (string | Entry)[] {
    const parts: (string | Entry)[] = [];
    let last = 0;
    for (const match of input.matchAll(TOKEN)) {
      if (match.index > last) parts.push(input.slice(last, match.index));
      const entry = this.entries[Number(match[1])];
      if (entry !== undefined) parts.push(entry);
      last = match.index + match[0].length;
    }
    if (last < input.length) parts.push(input.slice(last));
    return parts;
  }

  /** The value a string with tokens stands for: itself, one entry's value, or their concatenation. */
  toValue(input: string): CompiledValue | undefined {
    const parts = this.parse(input);
    if (parts.length === 0) return "";
    const values: CompiledValue[] = [];
    for (const part of parts) {
      if (typeof part === "string") values.push(part);
      else if ("value" in part) values.push(part.value);
      else return undefined;
    }
    return values.length === 1 ? values[0]! : { concat: values };
  }
}

/** A prop value for a primitive: a literal stays itself and anything else becomes a token. */
export const propFor = (tokens: Tokens, value: CompiledValue): unknown =>
  isStaticScalar(value) ? value : tokens.value(value);

const SOURCE = (source: CompiledSource | undefined) =>
  source === undefined ? {} : { src: source };

/** Split compatibility markup into parts, deciding by position whether a token is in a tag. */
export const rawParts = (tokens: Tokens, html: string): readonly CompiledRawPart[] => {
  const parts: CompiledRawPart[] = [];
  let inTag = false;
  let quote: string | undefined;
  let buffer = "";
  const flush = () => {
    if (buffer !== "") parts.push(buffer);
    buffer = "";
  };
  for (let index = 0; index < html.length; index++) {
    const character = html[index]!;
    if (character === OPEN) {
      const end = html.indexOf(CLOSE, index);
      const entry = tokens.parse(html.slice(index, end + 1))[0];
      if (end > index && entry !== undefined && typeof entry !== "string" && "value" in entry) {
        flush();
        parts.push(inTag ? { attr: entry.value } : { text: entry.value });
        index = end;
        continue;
      }
    }
    if (!inTag && character === "<") inTag = true;
    else if (inTag && quote === undefined && (character === '"' || character === "'"))
      quote = character;
    else if (inTag && quote === character) quote = undefined;
    else if (inTag && quote === undefined && character === ">") inTag = false;
    buffer += character;
  }
  flush();
  return parts;
};

const styleList = (tokens: Tokens, style: unknown): CompiledStyle | undefined => {
  if (!isObject(style)) return undefined;
  const entries: (readonly [string, CompiledValue])[] = [];
  for (const [property, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "number") entries.push([property, value]);
    else if (typeof value === "string") {
      const resolved = tokens.toValue(value);
      if (resolved !== undefined) entries.push([property, resolved]);
    }
  }
  return entries;
};

/** Turn the tree a primitive returned back into IR, restoring each token to what it stood for. */
export const emailNodeToIr = (
  node: EmailNode | null,
  tokens: Tokens,
  source: CompiledSource | undefined,
): readonly CompiledNode[] => {
  if (node === null) return [];
  switch (node.type) {
    case "Text": {
      const output: CompiledNode[] = [];
      for (const part of tokens.parse(node.value)) {
        if (typeof part === "string") output.push(part);
        else if ("value" in part) output.push(part.value);
        else output.push(...part.nodes);
      }
      return output;
    }
    case "Fragment":
      return node.children.flatMap((childNode) => emailNodeToIr(childNode, tokens, source));
    case "Raw":
      return [
        {
          raw: rawParts(tokens, node.html),
          ...(node.text === "" ? {} : { text: node.text }),
          ...SOURCE(source),
        } satisfies CompiledRaw,
      ];
    case "Element": {
      const attrs: Record<string, CompiledValue> = {};
      let style: CompiledStyle | undefined;
      for (const [key, value] of Object.entries(node.props)) {
        if (key === "key" || value === undefined || value === null || value === false) continue;
        if (key === "style") {
          style = styleList(tokens, value);
          continue;
        }
        const name = key === "className" ? "class" : key;
        if (typeof value === "string") attrs[name] = tokens.toValue(value) ?? value;
        else if (typeof value === "number" || value === true) attrs[name] = value;
      }
      const reserved =
        (node.props as Readonly<Record<PropertyKey, unknown>>)[BRAND_FOOTER_MARKER] === true;
      const element: CompiledElement = {
        el: node.tag,
        ...(Object.keys(attrs).length === 0 ? {} : { attrs }),
        ...(style === undefined || (Array.isArray(style) && style.length === 0) ? {} : { style }),
        ...(node.children.length === 0
          ? {}
          : {
              children: node.children.flatMap((childNode) =>
                emailNodeToIr(childNode, tokens, source),
              ),
            }),
        ...(reserved ? { reserved: true as const } : {}),
        ...SOURCE(source),
      };
      return [element];
    }
  }
};
