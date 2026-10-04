// Structured reads and exact source edits for the SMS and WhatsApp channel bodies of a template
// entry. A form model is read from the entry's TSX, and each form change comes back as source
// replacements, so the text outside the edited span keeps its formatting. Text between the
// expressions of a body is editable; an expression, conditional or element stays where it is,
// untouched, as a locked segment.
import { parse } from "@babel/parser";

import {
  SMS_CATEGORIES,
  WHATSAPP_CATEGORIES,
  WHATSAPP_HEADER_TYPES,
  type SmsCategory,
  type WhatsAppHeaderType,
} from "./channel-specs";
import { isObject } from "./internal/guards";
import type { SourceReplacement } from "./source-edit";

export type { SmsCategory, WhatsAppCategory, WhatsAppHeaderType } from "./channel-specs";

/** A run of body text between two locked segments. It is empty when nothing sits between them. */
export interface TextSegment {
  readonly kind: "text";
  readonly text: string;
  /** The source range the text is written back over. */
  readonly start: number;
  readonly end: number;
}

/** An expression, conditional or element the form does not edit, kept as authored. */
export interface LockedSegment {
  readonly kind: "locked";
  /** The authored source, shortened for display. */
  readonly summary: string;
  readonly start: number;
  readonly end: number;
}

export type ChannelSegment = TextSegment | LockedSegment;

/** How an attribute appears on an element. Only a literal is editable. */
export type AttributeState =
  | { readonly kind: "absent" }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "expression"; readonly source: string };

export interface SmsChannelForm {
  readonly category: AttributeState;
  readonly segments: readonly ChannelSegment[];
  /** The input fields the body reads, as dotted paths. */
  readonly variables: readonly string[];
}

export type WhatsAppButtonKind = "quick-reply" | "url" | "phone" | "copy-code";

export type WhatsAppButtonRow =
  | {
      readonly kind: "editable";
      readonly type: WhatsAppButtonKind;
      /** The label, or the copied code for a copy-code button. */
      readonly text: string;
      readonly url: AttributeState;
      readonly phone: AttributeState;
    }
  | {
      /** A conditional, or a button whose label reads the input. */
      readonly kind: "locked";
      readonly summary: string;
    };

export interface WhatsAppChannelForm {
  readonly name: AttributeState;
  readonly language: AttributeState;
  readonly category: AttributeState;
  /** Null when the template has no header. */
  readonly header: readonly ChannelSegment[] | null;
  readonly headerType: AttributeState;
  readonly body: readonly ChannelSegment[];
  /** Null when the template has no footer. */
  readonly footer: readonly ChannelSegment[] | null;
  readonly buttons: readonly WhatsAppButtonRow[];
  readonly variables: readonly string[];
}

export type ChannelEditResult =
  | { readonly ok: true; readonly edits: readonly SourceReplacement[] }
  | { readonly ok: false; readonly reason: string };

export type SmsEdit =
  | { readonly kind: "category"; readonly value: SmsCategory | undefined }
  | { readonly kind: "text"; readonly segment: number; readonly text: string };

export type WhatsAppPart = "header" | "body" | "footer";

export type WhatsAppEdit =
  | {
      readonly kind: "attribute";
      readonly name: "name" | "language" | "category";
      readonly value: string | undefined;
    }
  | { readonly kind: "headerType"; readonly value: WhatsAppHeaderType }
  | {
      readonly kind: "text";
      readonly part: WhatsAppPart;
      readonly segment: number;
      readonly text: string;
    }
  | { readonly kind: "buttonText"; readonly button: number; readonly text: string }
  | {
      readonly kind: "buttonAttribute";
      readonly button: number;
      readonly name: "url" | "phone";
      readonly value: string;
    }
  | { readonly kind: "buttonType"; readonly button: number; readonly type: WhatsAppButtonKind }
  | { readonly kind: "buttonAdd"; readonly type: WhatsAppButtonKind }
  | { readonly kind: "buttonRemove"; readonly button: number };

// ── Syntax tree access ───────────────────────────────────────────────────────

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  isObject(value) &&
  typeof value.type === "string" &&
  typeof value.start === "number" &&
  typeof value.end === "number";

const nodeList = (value: unknown): readonly Node[] =>
  Array.isArray(value) ? value.filter(isNode) : [];

const nodeOf = (parent: Node, key: string): Node | null => {
  const value = parent[key];
  return isNode(value) ? value : null;
};

const parseSource = (source: string): Node | null => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Babel parser boundary: incomplete source has no form.
  try {
    const result = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    return isNode(result) ? result : null;
  } catch {
    return null;
  }
};

const walk = (value: unknown, visit: (node: Node) => boolean | void): void => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isNode(value)) return;
  if (visit(value) === false) return;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "loc" && key !== "extra" && key !== "comments") walk(child, visit);
  }
};

const jsxName = (name: Node | null): string => {
  if (name === null) return "";
  if (name.type === "JSXIdentifier") return typeof name.name === "string" ? name.name : "";
  if (name.type === "JSXMemberExpression")
    return `${jsxName(nodeOf(name, "object"))}.${jsxName(nodeOf(name, "property"))}`;
  return "";
};

interface Element {
  readonly node: Node;
  readonly opening: Node;
  readonly closing: Node | null;
  readonly tag: string;
  readonly children: readonly Node[];
  readonly attributes: readonly Node[];
  readonly selfClosing: boolean;
  /** The range between the opening and closing tags. Empty at the opening's end when self-closing. */
  readonly contentStart: number;
  readonly contentEnd: number;
}

const elementOf = (node: Node): Element | null => {
  if (node.type !== "JSXElement") return null;
  const opening = nodeOf(node, "openingElement");
  if (opening === null) return null;
  const closing = nodeOf(node, "closingElement");
  return {
    node,
    opening,
    closing,
    tag: jsxName(nodeOf(opening, "name")),
    children: nodeList(node.children),
    attributes: nodeList(opening.attributes),
    selfClosing: opening.selfClosing === true,
    contentStart: opening.end,
    contentEnd: closing === null ? opening.end : closing.start,
  };
};

/** The single element a channel function returns, and the parameter it reads the input from. */
interface ChannelFunction {
  readonly root: Element;
  readonly parameter: Node | null;
}

const returnedElement = (fn: Node): Node | null => {
  const body = nodeOf(fn, "body");
  if (body === null) return null;
  if (body.type === "JSXElement") return body;
  if (body.type !== "BlockStatement") return null;
  const statements = nodeList(body.body).filter((statement) => statement.type !== "EmptyStatement");
  const only = statements.length === 1 ? statements[0] : undefined;
  const argument =
    only?.type === "ReturnStatement" && only !== undefined ? nodeOf(only, "argument") : null;
  return argument !== null && argument.type === "JSXElement" ? argument : null;
};

const propertyName = (property: Node): string | null => {
  if (property.computed === true) return null;
  const key = nodeOf(property, "key");
  if (key === null) return null;
  if (key.type === "Identifier") return typeof key.name === "string" ? key.name : null;
  return key.type === "StringLiteral" && typeof key.value === "string" ? key.value : null;
};

/** The function behind `defineTemplate({ [channel]: … })`, when it is written in place. */
const channelFunction = (tree: Node, channel: "sms" | "whatsapp"): ChannelFunction | null => {
  let found: ChannelFunction | null = null;
  walk(tree, (call) => {
    if (found !== null) return false;
    if (call.type !== "CallExpression") return;
    const callee = nodeOf(call, "callee");
    if (callee?.type !== "Identifier" || callee.name !== "defineTemplate") return;
    const definition = nodeList(call.arguments)[0];
    if (definition?.type !== "ObjectExpression") return false;
    for (const property of nodeList(definition.properties)) {
      if (propertyName(property) !== channel) continue;
      const fn =
        property.type === "ObjectMethod"
          ? property
          : property.type === "ObjectProperty"
            ? nodeOf(property, "value")
            : null;
      if (
        fn === null ||
        (fn.type !== "ArrowFunctionExpression" &&
          fn.type !== "FunctionExpression" &&
          fn.type !== "ObjectMethod")
      )
        return false;
      const returned = returnedElement(fn);
      const root = returned === null ? null : elementOf(returned);
      if (root !== null) found = { root, parameter: nodeList(fn.params)[0] ?? null };
      return false;
    }
    return false;
  });
  return found;
};

/** The name an import binds a component to, or the component's own name when nothing is imported. */
const importedAs = (tree: Node, specifier: string, imported: string): string => {
  let local = imported;
  walk(tree, (node) => {
    if (node.type !== "ImportDeclaration") return;
    const from = nodeOf(node, "source");
    if (from?.value !== specifier) return false;
    for (const item of nodeList(node.specifiers)) {
      const name = nodeOf(item, "imported");
      const alias = nodeOf(item, "local");
      if (item.type === "ImportSpecifier" && (name?.name === imported || name?.value === imported))
        local = typeof alias?.name === "string" ? alias.name : imported;
    }
    return false;
  });
  return local;
};

// ── Body text ────────────────────────────────────────────────────────────────

/** JSX text as the compiler reads it: lines are trimmed and joined, blank lines dropped. */
const jsxTextValue = (value: string): string => {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = index;
  });
  let result = "";
  lines.forEach((line, index) => {
    let trimmed = line.replace(/\t/g, " ");
    if (index !== 0) trimmed = trimmed.replace(/^ +/, "");
    if (index !== lines.length - 1) trimmed = trimmed.replace(/ +$/, "");
    if (trimmed === "") return;
    result += index === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return result;
};

/** The value of a container that holds only a string, or null for any other expression. */
const stringContainerValue = (container: Node): string | null => {
  const expression = nodeOf(container, "expression");
  if (expression === null) return null;
  if (expression.type === "StringLiteral" && typeof expression.value === "string")
    return expression.value;
  if (expression.type === "TemplateLiteral" && nodeList(expression.expressions).length === 0) {
    const cooked = nodeList(expression.quasis)[0]?.value;
    return isObject(cooked) && typeof cooked.cooked === "string" ? cooked.cooked : null;
  }
  return null;
};

const summarize = (source: string, node: Node): string => {
  const text = source.slice(node.start, node.end).replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

/**
 * The editable text and locked expressions of an element's children, in order. Text is a segment
 * between locked children, so a text segment exists (possibly empty) before, between and after
 * them.
 */
const segmentsOf = (source: string, element: Element): readonly ChannelSegment[] => {
  const segments: ChannelSegment[] = [];
  let start = element.contentStart;
  let text = "";
  const flush = (end: number): void => {
    segments.push({ kind: "text", text, start, end });
    text = "";
  };
  for (const child of element.children) {
    if (child.type === "JSXText") {
      text += jsxTextValue(typeof child.value === "string" ? child.value : "");
      continue;
    }
    if (child.type === "JSXExpressionContainer") {
      const value = stringContainerValue(child);
      if (value !== null) {
        text += value;
        continue;
      }
    }
    flush(child.start);
    segments.push({
      kind: "locked",
      summary: summarize(source, child),
      start: child.start,
      end: child.end,
    });
    start = child.end;
  }
  flush(element.contentEnd);
  return segments;
};

const isSafeRun = (char: string): boolean => !/[{}<>&\r\n\t]/.test(char);

/**
 * JSX for the given text. Characters JSX text cannot carry, and whitespace at an edge the
 * compiler would trim, are written as string expressions; the rest stays plain text.
 */
const encodeText = (text: string, trimStart: boolean, trimEnd: boolean): string => {
  const chars = [...text];
  const unsafe = chars.map((char) => !isSafeRun(char));
  if (trimStart) for (let i = 0; i < chars.length && /\s/.test(chars[i]!); i++) unsafe[i] = true;
  if (trimEnd) for (let i = chars.length - 1; i >= 0 && /\s/.test(chars[i]!); i--) unsafe[i] = true;
  let result = "";
  let run = "";
  let runUnsafe = false;
  const flush = (): void => {
    if (run === "") return;
    result += runUnsafe ? `{${JSON.stringify(run)}}` : run;
    run = "";
  };
  chars.forEach((char, index) => {
    if (run !== "" && unsafe[index] !== runUnsafe) flush();
    runUnsafe = unsafe[index]!;
    run += char;
  });
  flush();
  return result;
};

/** Write `text` over the gap at `segment`, keeping the newlines and indentation around it. */
const writeText = (
  source: string,
  element: Element,
  segments: readonly ChannelSegment[],
  index: number,
  text: string,
): ChannelEditResult => {
  const segment = segments[index];
  if (segment?.kind !== "text") return { ok: false, reason: "That part of the body is locked." };
  if (segment.text === text) return { ok: true, edits: [] };
  if (element.selfClosing) {
    const opening = element.opening;
    let start = opening.end - 2;
    while (start > opening.start && /\s/.test(source[start - 1]!)) start--;
    return {
      ok: true,
      edits: [
        {
          start,
          end: opening.end,
          before: source.slice(start, opening.end),
          after: `>${encodeText(text, false, false)}</${element.tag}>`,
        },
      ],
    };
  }
  const raw = source.slice(segment.start, segment.end);
  const leading = /^\s*/.exec(raw)?.[0] ?? "";
  const prefix = /[\r\n]/.test(leading) ? leading : "";
  const rest = raw.slice(prefix.length);
  const trailing = /\s*$/.exec(rest)?.[0] ?? "";
  const suffix = /[\r\n]/.test(trailing) ? trailing : "";
  const start = segment.start + prefix.length;
  const end = segment.end - suffix.length;
  return {
    ok: true,
    edits: [
      {
        start,
        end,
        before: source.slice(start, end),
        after: encodeText(text, prefix !== "", suffix !== ""),
      },
    ],
  };
};

// ── Attributes ───────────────────────────────────────────────────────────────

const attributeNamed = (element: Element, name: string): Node | null =>
  element.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && jsxName(nodeOf(attribute, "name")) === name,
  ) ?? null;

const attributeState = (source: string, element: Element, name: string): AttributeState => {
  const attribute = attributeNamed(element, name);
  if (attribute === null) return { kind: "absent" };
  const value = nodeOf(attribute, "value");
  if (value?.type === "StringLiteral" && typeof value.value === "string")
    return { kind: "literal", value: value.value };
  if (value?.type === "JSXExpressionContainer") {
    const literal = stringContainerValue(value);
    if (literal !== null) return { kind: "literal", value: literal };
  }
  return { kind: "expression", source: summarize(source, value ?? attribute) };
};

const encodeAttribute = (value: string): string =>
  /["&\\\r\n]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;

const replacement = (
  source: string,
  start: number,
  end: number,
  after: string,
): SourceReplacement => ({ start, end, before: source.slice(start, end), after });

/** Set, add or remove one string attribute of an element. */
const setAttribute = (
  source: string,
  element: Element,
  name: string,
  value: string | undefined,
): ChannelEditResult => {
  const attribute = attributeNamed(element, name);
  if (attribute === null) {
    if (value === undefined) return { ok: true, edits: [] };
    const anchor =
      element.attributes.at(-1)?.end ?? nodeOf(element.opening, "name")?.end ?? element.opening.end;
    return {
      ok: true,
      edits: [replacement(source, anchor, anchor, ` ${name}=${encodeAttribute(value)}`)],
    };
  }
  const current = attributeState(source, element, name);
  if (current.kind === "expression")
    return { ok: false, reason: `\`${name}\` reads the input. Edit it in Source.` };
  if (value === undefined) {
    let start = attribute.start;
    while (start > element.opening.start && /\s/.test(source[start - 1]!)) start--;
    return { ok: true, edits: [replacement(source, start, attribute.end, "")] };
  }
  const literal = nodeOf(attribute, "value");
  return {
    ok: true,
    edits:
      literal === null
        ? [replacement(source, attribute.end, attribute.end, `=${encodeAttribute(value)}`)]
        : [replacement(source, literal.start, literal.end, encodeAttribute(value))],
  };
};

// ── Layout ───────────────────────────────────────────────────────────────────

const INDENT = "  ";

/** The indentation of the line `position` is on, when only whitespace precedes it there. */
const ownLineIndent = (source: string, position: number): string | null => {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  const lead = source.slice(lineStart, position);
  return /^[ \t]*$/.test(lead) ? lead : null;
};

/** Remove a child, and its line when it is alone on one. */
const removeChild = (source: string, node: Node): SourceReplacement => {
  const indent = ownLineIndent(source, node.start);
  const after = /^[ \t]*(\r?\n)/.exec(source.slice(node.end));
  if (indent === null || after === null) return replacement(source, node.start, node.end, "");
  const start = node.start - indent.length;
  return replacement(source, start, node.end + after[0].length, "");
};

/** Insert markup on its own line before or after a sibling, or inline when the sibling is not alone. */
const insertBeside = (
  source: string,
  sibling: Node,
  side: "before" | "after",
  text: string,
): SourceReplacement => {
  const indent = ownLineIndent(source, sibling.start);
  if (side === "before")
    return replacement(
      source,
      sibling.start,
      sibling.start,
      indent === null ? text : `${text}\n${indent}`,
    );
  return replacement(
    source,
    sibling.end,
    sibling.end,
    indent === null ? text : `\n${indent}${text}`,
  );
};

// ── Variables ────────────────────────────────────────────────────────────────

/** The input fields read by the expressions inside `root`, as dotted paths. */
const variablesOf = (source: string, root: Element, parameter: Node | null): readonly string[] => {
  const names = new Set<string>();
  const scan = (text: string): void => {
    if (parameter?.type === "Identifier" && typeof parameter.name === "string") {
      const pattern = new RegExp(`\\b${parameter.name}((?:\\??\\.[A-Za-z_$][\\w$]*)+)`, "g");
      for (const match of text.matchAll(pattern)) names.add(match[1]!.replace(/\?/g, "").slice(1));
    } else if (parameter?.type === "ObjectPattern") {
      for (const property of nodeList(parameter.properties)) {
        const key = nodeOf(property, "key");
        if (key?.type === "Identifier" && typeof key.name === "string") {
          if (new RegExp(`\\b${key.name}\\b`).test(text)) names.add(key.name);
        }
      }
    }
  };
  walk(root.node, (node) => {
    if (node.type === "JSXExpressionContainer" && stringContainerValue(node) === null)
      scan(source.slice(node.start, node.end));
  });
  return [...names].sort();
};

// ── SMS ──────────────────────────────────────────────────────────────────────

interface SmsChannel extends ChannelFunction {
  readonly tree: Node;
}

const smsChannel = (source: string): SmsChannel | null => {
  const tree = parseSource(source);
  if (tree === null) return null;
  const channel = channelFunction(tree, "sms");
  if (channel === null || channel.root.tag !== importedAs(tree, "@samva/markup/sms", "Sms"))
    return null;
  return { ...channel, tree };
};

/** The form model of the template's SMS body, or null when it is not a `<Sms>` written in place. */
export const readSmsChannel = (source: string): SmsChannelForm | null => {
  const channel = smsChannel(source);
  if (channel === null) return null;
  return {
    category: attributeState(source, channel.root, "category"),
    segments: segmentsOf(source, channel.root),
    variables: variablesOf(source, channel.root, channel.parameter),
  };
};

/** The source replacements that apply one form change to the SMS body. */
export const editSmsChannel = (source: string, edit: SmsEdit): ChannelEditResult => {
  const channel = smsChannel(source);
  if (channel === null) return { ok: false, reason: "The SMS body is not editable here." };
  if (edit.kind === "category") {
    if (edit.value !== undefined && !SMS_CATEGORIES.includes(edit.value))
      return { ok: false, reason: `\`${edit.value}\` is not an SMS category.` };
    return setAttribute(source, channel.root, "category", edit.value);
  }
  return writeText(source, channel.root, segmentsOf(source, channel.root), edit.segment, edit.text);
};

// ── WhatsApp ─────────────────────────────────────────────────────────────────

const BUTTON_TAGS: Readonly<Record<WhatsAppButtonKind, string>> = {
  "quick-reply": "QuickReplyButton",
  url: "UrlButton",
  phone: "PhoneButton",
  "copy-code": "CopyCodeButton",
};

const BUTTON_DEFAULTS: Readonly<Record<WhatsAppButtonKind, string>> = {
  "quick-reply": "Reply",
  url: "Visit site",
  phone: "Call us",
  "copy-code": "CODE",
};

const kindOfTag = (tag: string, local: string): WhatsAppButtonKind | null => {
  if (!tag.startsWith(`${local}.`)) return null;
  const part = tag.slice(local.length + 1);
  return (
    (Object.keys(BUTTON_TAGS) as WhatsAppButtonKind[]).find((kind) => BUTTON_TAGS[kind] === part) ??
    null
  );
};

interface WhatsAppChannel extends ChannelFunction {
  readonly local: string;
  readonly header: Element | null;
  readonly body: Element | null;
  readonly footer: Element | null;
  readonly buttons: Element | null;
}

const whatsappChannel = (source: string): WhatsAppChannel | null => {
  const tree = parseSource(source);
  if (tree === null) return null;
  const channel = channelFunction(tree, "whatsapp");
  const local = importedAs(tree, "@samva/markup/whatsapp", "WhatsApp");
  if (channel === null || channel.root.tag !== local) return null;
  const part = (name: string): Element | null => {
    for (const child of channel.root.children) {
      const element = elementOf(child);
      if (element?.tag === `${local}.${name}`) return element;
    }
    return null;
  };
  return {
    ...channel,
    local,
    header: part("Header"),
    body: part("Body"),
    footer: part("Footer"),
    buttons: part("Buttons"),
  };
};

const buttonRows = (
  source: string,
  channel: WhatsAppChannel,
): readonly { readonly row: WhatsAppButtonRow; readonly node: Node }[] => {
  if (channel.buttons === null) return [];
  const rows: { row: WhatsAppButtonRow; node: Node }[] = [];
  for (const child of channel.buttons.children) {
    if (child.type === "JSXText" && jsxTextValue(String(child.value ?? "")) === "") continue;
    const element = elementOf(child);
    const kind = element === null ? null : kindOfTag(element.tag, channel.local);
    if (element === null || kind === null) {
      rows.push({ row: { kind: "locked", summary: summarize(source, child) }, node: child });
      continue;
    }
    const segments = segmentsOf(source, element);
    const label = segments[0];
    rows.push({
      node: child,
      row:
        segments.length === 1 && label?.kind === "text"
          ? {
              kind: "editable",
              type: kind,
              text: label.text,
              url: attributeState(source, element, "url"),
              phone: attributeState(source, element, "phone"),
            }
          : { kind: "locked", summary: summarize(source, child) },
    });
  }
  return rows;
};

/** The form model of the template's WhatsApp body, or null when it is not a `<WhatsApp>` written in place. */
export const readWhatsAppChannel = (source: string): WhatsAppChannelForm | null => {
  const channel = whatsappChannel(source);
  if (channel === null || channel.body === null) return null;
  const { root } = channel;
  return {
    name: attributeState(source, root, "name"),
    language: attributeState(source, root, "language"),
    category: attributeState(source, root, "category"),
    header: channel.header === null ? null : segmentsOf(source, channel.header),
    headerType:
      channel.header === null ? { kind: "absent" } : attributeState(source, channel.header, "type"),
    body: segmentsOf(source, channel.body),
    footer: channel.footer === null ? null : segmentsOf(source, channel.footer),
    buttons: buttonRows(source, channel).map(({ row }) => row),
    variables: variablesOf(source, root, channel.parameter),
  };
};

const buttonMarkup = (
  local: string,
  type: WhatsAppButtonKind,
  text: string,
  attributes: Readonly<{ url?: string | undefined; phone?: string | undefined }>,
): string => {
  const tag = `${local}.${BUTTON_TAGS[type]}`;
  const attribute =
    type === "url" && attributes.url !== undefined
      ? ` url=${encodeAttribute(attributes.url)}`
      : type === "phone" && attributes.phone !== undefined
        ? ` phone=${encodeAttribute(attributes.phone)}`
        : "";
  return `<${tag}${attribute}>${encodeText(text, false, false)}</${tag}>`;
};

const newButton = (local: string, type: WhatsAppButtonKind): string =>
  buttonMarkup(local, type, BUTTON_DEFAULTS[type], {
    url: "https://example.com",
    phone: "+15555550100",
  });

const editPart = (
  source: string,
  channel: WhatsAppChannel,
  part: WhatsAppPart,
  index: number,
  text: string,
): ChannelEditResult => {
  const element = channel[part];
  if (element === null) {
    // Header and footer come into being with their first text.
    if (part === "body" || text === "" || index !== 0) return { ok: true, edits: [] };
    const tag = `${channel.local}.${part === "header" ? "Header" : "Footer"}`;
    const markup = `<${tag}>${encodeText(text, false, false)}</${tag}>`;
    const anchor =
      part === "header" ? channel.body!.node : (channel.buttons?.node ?? channel.body!.node);
    return {
      ok: true,
      edits: [insertBeside(source, anchor, part === "header" ? "before" : "after", markup)],
    };
  }
  const segments = segmentsOf(source, element);
  // A header or footer emptied of all its text goes away rather than staying as an empty part.
  if (part !== "body" && text === "" && segments.length === 1)
    return { ok: true, edits: [removeChild(source, element.node)] };
  return writeText(source, element, segments, index, text);
};

/** The source replacements that apply one form change to the WhatsApp body. */
export const editWhatsAppChannel = (source: string, edit: WhatsAppEdit): ChannelEditResult => {
  const channel = whatsappChannel(source);
  if (channel === null || channel.body === null)
    return { ok: false, reason: "The WhatsApp body is not editable here." };
  const { root, local } = channel;
  switch (edit.kind) {
    case "attribute": {
      if (
        edit.name === "category" &&
        !(WHATSAPP_CATEGORIES as readonly string[]).includes(edit.value ?? "")
      )
        return { ok: false, reason: "Choose a WhatsApp category." };
      // `language` and `category` are required, so an emptied one stays as an empty string.
      const value = edit.name === "name" && edit.value === "" ? undefined : (edit.value ?? "");
      return setAttribute(source, root, edit.name, value);
    }
    case "headerType": {
      if (channel.header === null)
        return { ok: false, reason: "Add the header text before choosing its type." };
      if (!WHATSAPP_HEADER_TYPES.includes(edit.value))
        return { ok: false, reason: `\`${edit.value}\` is not a header type.` };
      return setAttribute(
        source,
        channel.header,
        "type",
        edit.value === "text" ? undefined : edit.value,
      );
    }
    case "text":
      return editPart(source, channel, edit.part, edit.segment, edit.text);
    case "buttonAdd": {
      const button = newButton(local, edit.type);
      const buttons = channel.buttons;
      if (buttons === null) {
        const anchor = channel.footer ?? channel.body;
        const tag = `${local}.Buttons`;
        const indent = ownLineIndent(source, anchor.node.start);
        const markup =
          indent === null
            ? `<${tag}>${button}</${tag}>`
            : `<${tag}>\n${indent}${INDENT}${button}\n${indent}</${tag}>`;
        return { ok: true, edits: [insertBeside(source, anchor.node, "after", markup)] };
      }
      if (buttons.selfClosing) {
        const tag = `${local}.Buttons`;
        const indent = ownLineIndent(source, buttons.node.start);
        const markup =
          indent === null
            ? `<${tag}>${button}</${tag}>`
            : `<${tag}>\n${indent}${INDENT}${button}\n${indent}</${tag}>`;
        return {
          ok: true,
          edits: [replacement(source, buttons.node.start, buttons.node.end, markup)],
        };
      }
      const last = buttons.children.findLast(
        (child) => child.type !== "JSXText" || jsxTextValue(String(child.value ?? "")) !== "",
      );
      if (last !== undefined)
        return { ok: true, edits: [insertBeside(source, last, "after", button)] };
      const indent = ownLineIndent(source, buttons.node.start);
      return {
        ok: true,
        edits: [
          replacement(
            source,
            buttons.contentStart,
            buttons.contentEnd,
            indent === null ? button : `\n${indent}${INDENT}${button}\n${indent}`,
          ),
        ],
      };
    }
    default:
      break;
  }
  const rows = buttonRows(source, channel);
  const target = rows[edit.button];
  if (target === undefined || channel.buttons === null)
    return { ok: false, reason: "That button no longer exists." };
  if (edit.kind === "buttonRemove") {
    return {
      ok: true,
      edits: [removeChild(source, rows.length === 1 ? channel.buttons.node : target.node)],
    };
  }
  const element = elementOf(target.node);
  if (target.row.kind === "locked" || element === null)
    return { ok: false, reason: "That button is locked. Edit it in Source." };
  switch (edit.kind) {
    case "buttonText":
      return writeText(source, element, segmentsOf(source, element), 0, edit.text);
    case "buttonAttribute":
      return setAttribute(source, element, edit.name, edit.value);
    default: {
      const { row } = target;
      const keep = (state: AttributeState): string | undefined =>
        state.kind === "literal" ? state.value : undefined;
      const markup = buttonMarkup(local, edit.type, row.text, {
        url: keep(row.url) ?? "https://example.com",
        phone: keep(row.phone) ?? "+15555550100",
      });
      return { ok: true, edits: [replacement(source, target.node.start, target.node.end, markup)] };
    }
  }
};
