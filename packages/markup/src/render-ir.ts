/* oxlint-disable eslint/no-control-regex -- URL, header and attribute validation intentionally rejects control characters. */
/* oxlint-disable samva/no-hand-rolled-object-guard, samva/no-unsafe-type-assertion -- The renderer walks untrusted JSON IR and input; the guards here are the validation, and the narrowing casts follow a key-presence check. */
/* oxlint-disable samva/no-try-catch-or-throw, samva/no-error-constructor -- The send-time renderer is a synchronous security boundary: unsafe IR or data rejects the whole render with one IrRenderError. */
import { reservedBrandAttributes, type BrandPlugin } from "./email/brand-plugin";
import { emailElement, EMAIL_GLOBAL_ATTRIBUTES, type EmailAttributeSpec } from "./email/elements";
import type { EmailElementSpec, EmailLayout } from "./email/elements";
import { samvaBrandPlugin } from "./email/samva-brand-plugin";
import { callFormatter, createFmt, type Fmt } from "./fmt";
import type {
  IrArithmetic,
  IrComparison,
  IrEach,
  IrElement,
  IrIf,
  IrNode,
  IrPredicate,
  IrRaw,
  IrRawPart,
  IrSource,
  IrStyle,
  IrValue,
  IrWhatsAppButtonNode,
  RenderedIrEmail,
  RenderedIrWhatsApp,
  RenderedPosition,
  RenderedWhatsAppButton,
  RenderOptions,
  TemplateIr,
} from "./ir";

// Rendering a template's IR is a pure function of the IR and the input. Untrusted data flows
// through here into markup, so every value is escaped for its context, every attribute is
// checked against the element's spec, and anything unsafe rejects the whole render. The output
// is byte-compatible with the JSX serializer's (`./email/html`) and text derivation
// (`./email/text`); this module re-implements both so the JSX pipeline can be removed.

export interface IrRenderDiagnostic {
  readonly code: string;
  readonly message: string;
}

export class IrRenderError extends Error {
  readonly diagnostics: readonly IrRenderDiagnostic[];
  constructor(diagnostics: readonly IrRenderDiagnostic[]) {
    super(
      `Template render rejected: ${diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ")}`,
    );
    this.name = "IrRenderError";
    this.diagnostics = diagnostics;
  }
}

const fail = (code: string, message: string): never => {
  throw new IrRenderError([{ code, message }]);
};

// ── Limits ────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10_000;
const MAX_DEPTH = 64;

/** Classic Outlook lays a document out correctly only under a transitional doctype. */
const EMAIL_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

const PREHEADER_TARGET_LENGTH = 200;
const PREHEADER_PADDING = " ‌​‍‎‏﻿";

// ── Escaping and validation (mirrors ./email/html) ────────────────────────────

const escapeText = (value: string): string =>
  value.replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
  );

const escapeAttribute = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SAFE_URL_SCHEME = /^(https:\/\/|mailto:|tel:|cid:|#)/i;

/** A delivered message can resolve only an absolute URL, so relative references are refused. */
const isSafeUrl = (value: string): boolean =>
  !/^[\u0000- ]/.test(value) &&
  !CONTROL_CHARACTERS.test(value) &&
  !value.includes("\\") &&
  SAFE_URL_SCHEME.test(value);

const CSS_PROPERTY = /^(--[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)$/;
const CSS_UNSAFE = /[;{}<>\\]|expression\s*\(|@import|\/\*/i;
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

const kebab = (property: string): string =>
  property.startsWith("--") ? property : property.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);

const UNITLESS = new Set([
  "opacity",
  "zIndex",
  "fontWeight",
  "lineHeight",
  "order",
  "flexGrow",
  "flexShrink",
  "columnCount",
  "orphans",
  "widows",
  "zoom",
  "fillOpacity",
  "strokeOpacity",
]);

const declarationValue = (property: string, value: string | number): string =>
  typeof value === "number" && value !== 0 && !UNITLESS.has(property) && !property.startsWith("--")
    ? `${value}px`
    : String(value);

// ── Concrete tree ─────────────────────────────────────────────────────────────

interface CText {
  readonly t: "text";
  readonly v: string;
}
interface CRaw {
  readonly t: "raw";
  readonly html: string;
  readonly text: string;
}
interface CElement {
  readonly t: "el";
  readonly tag: string;
  readonly content: EmailElementSpec["content"];
  readonly layout: EmailLayout;
  /** Serialized attributes, each with its leading space. */
  readonly attrs: string;
  /** Resolved attribute values the text derivation reads (`href`, `alt`, `role`, `start`). */
  readonly props: ReadonlyMap<string, unknown>;
  readonly children: readonly CNode[];
  readonly src?: IrSource | undefined;
}
type CNode = CText | CRaw | CElement;

type Scope = ReadonlyMap<string, unknown>;

interface Ctx {
  readonly input: unknown;
  readonly locale: string | undefined;
  readonly timeZone: string | undefined;
  readonly plain: boolean;
  readonly brandPlugin: BrandPlugin;
  /** The attributes only the elements `BrandFooter` wrote may carry. */
  readonly reservedAttributes: ReadonlySet<string>;
  readonly diagnostics: IrRenderDiagnostic[];
  iterations: number;
  fmt: Fmt | undefined;
  /** The channel's rendered preheader, consumed by the first `{preheader:true}` marker. */
  preheader: string | undefined;
  markerUsed: boolean;
}

const report = (ctx: Ctx, code: string, message: string): void => {
  ctx.diagnostics.push({ code, message });
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const has = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.hasOwn(value, key);

// ── Paths ─────────────────────────────────────────────────────────────────────

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

const step = (value: unknown, segment: string): unknown => {
  if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
  if (Array.isArray(value)) {
    return ARRAY_INDEX.test(segment) && Object.hasOwn(value, segment)
      ? (value as readonly unknown[])[Number(segment)]
      : undefined;
  }
  if (isRecord(value) && Object.hasOwn(value, segment)) return value[segment];
  return undefined;
};

const resolvePath = (ctx: Ctx, scope: Scope, path: unknown): unknown => {
  if (typeof path !== "string" || path === "") return undefined;
  const [first = "", ...rest] = path.split(".");
  if (FORBIDDEN_SEGMENTS.has(first)) return undefined;
  let current: unknown = first.startsWith("$") ? scope.get(first) : step(ctx.input, first);
  for (const segment of rest) {
    if (current === undefined || current === null) return undefined;
    current = step(current, segment);
  }
  return current;
};

// ── Values ────────────────────────────────────────────────────────────────────

const invalid = (message: string): never => fail("invalid-value", message);

/** The text a value contributes: strings as is, finite numbers, nothing for null and booleans. */
const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : invalid("A non-finite number cannot be text.");
  }
  if (value === null || value === undefined || typeof value === "boolean") return "";
  return invalid("An object or array cannot be rendered as text.");
};

const finiteNumber = (value: unknown, what: string): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : invalid(`${what} must be a finite number.`);

const arithmetic = (op: IrArithmetic, left: number, right: number): number => {
  if ((op === "/" || op === "%") && right === 0) return invalid("Division by zero.");
  let result: number;
  switch (op) {
    case "+":
      result = left + right;
      break;
    case "-":
      result = left - right;
      break;
    case "*":
      result = left * right;
      break;
    case "/":
      result = left / right;
      break;
    case "%":
      result = left % right;
      break;
    default:
      return invalid(`Unknown arithmetic operator ${JSON.stringify(op)}.`);
  }
  return Number.isFinite(result) ? result : invalid("Arithmetic produced a non-finite number.");
};

const formatterContext = (ctx: Ctx): Fmt => {
  ctx.fmt ??= createFmt({ locale: ctx.locale, timeZone: ctx.timeZone });
  return ctx.fmt;
};

const applyFormat = (ctx: Ctx, name: unknown, args: readonly unknown[]): string => {
  if (typeof name !== "string") return invalid("A format node needs a formatter name.");
  try {
    return callFormatter(formatterContext(ctx), name, args);
  } catch (error) {
    return fail("format-error", error instanceof Error ? error.message : String(error));
  }
};

const nullish = (value: unknown): unknown => (value === undefined ? null : value);

const compare = (op: IrComparison, left: unknown, right: unknown): boolean => {
  switch (op) {
    case "eq":
      return nullish(left) === nullish(right);
    case "ne":
      return nullish(left) !== nullish(right);
    case "lt":
    case "gt":
    case "le":
    case "ge": {
      const ordered =
        (typeof left === "number" && typeof right === "number") ||
        (typeof left === "string" && typeof right === "string");
      if (!ordered) return false;
      const a = left as number | string;
      const b = right as number | string;
      if (op === "lt") return a < b;
      if (op === "gt") return a > b;
      return op === "le" ? a <= b : a >= b;
    }
    default:
      return invalid(`Unknown comparison ${JSON.stringify(op)}.`);
  }
};

const checkDepth = (depth: number): void => {
  if (depth > MAX_DEPTH) fail("render-limit", `Templates nest at most ${MAX_DEPTH} levels deep.`);
};

const evalArgs = (ctx: Ctx, scope: Scope, args: unknown, depth: number): readonly unknown[] =>
  Array.isArray(args)
    ? (args as readonly IrValue[]).map((arg) => evalValue(ctx, scope, arg, depth + 1))
    : invalid("Arguments must be an array.");

const evalValue = (ctx: Ctx, scope: Scope, value: IrValue, depth: number): unknown => {
  checkDepth(depth);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return invalid("Unknown value node.");
  const node: Readonly<Record<string, unknown>> = value;
  if (has(node, "bind")) return resolvePath(ctx, scope, node.bind);
  if (has(node, "lit")) return node.lit;
  if (has(node, "concat")) {
    return evalArgs(ctx, scope, node.concat, depth).map(textOf).join("");
  }
  if (has(node, "format")) {
    return applyFormat(ctx, node.format, evalArgs(ctx, scope, node.args, depth));
  }
  if (has(node, "if")) {
    return evalPredicate(ctx, scope, node.if as IrPredicate, depth + 1)
      ? evalValue(ctx, scope, node.then as IrValue, depth + 1)
      : evalValue(ctx, scope, node.else as IrValue, depth + 1);
  }
  if (has(node, "op")) {
    const [left, right] = evalArgs(ctx, scope, node.args, depth);
    return arithmetic(
      node.op as IrArithmetic,
      finiteNumber(left, "An arithmetic operand"),
      finiteNumber(right, "An arithmetic operand"),
    );
  }
  if (has(node, "count")) {
    const items = evalValue(ctx, scope, node.count as IrValue, depth + 1);
    if (!Array.isArray(items)) return invalid("count applies to an array.");
    return selectItems(ctx, scope, items, String(node.as), node.where as IrPredicate, depth).length;
  }
  if (has(node, "length")) {
    const measured = evalValue(ctx, scope, node.length as IrValue, depth + 1);
    return typeof measured === "string" || Array.isArray(measured)
      ? measured.length
      : invalid("length applies to a string or an array.");
  }
  return invalid("Unknown value node.");
};

const evalPredicate = (ctx: Ctx, scope: Scope, predicate: IrPredicate, depth: number): boolean => {
  checkDepth(depth);
  if (typeof predicate !== "object" || predicate === null || Array.isArray(predicate)) {
    return invalid("Unknown predicate.");
  }
  const node: Readonly<Record<string, unknown>> = predicate;
  if (has(node, "present")) return Boolean(resolvePath(ctx, scope, node.present));
  if (has(node, "truthy")) {
    return Boolean(evalValue(ctx, scope, node.truthy as IrValue, depth + 1));
  }
  if (has(node, "not")) {
    return !evalPredicate(ctx, scope, node.not as IrPredicate, depth + 1);
  }
  if (has(node, "and")) {
    return asArray(node.and).every((item) =>
      evalPredicate(ctx, scope, item as IrPredicate, depth + 1),
    );
  }
  if (has(node, "or")) {
    return asArray(node.or).some((item) =>
      evalPredicate(ctx, scope, item as IrPredicate, depth + 1),
    );
  }
  if (has(node, "cmp")) {
    const [left, right] = evalArgs(ctx, scope, node.args, depth);
    return compare(node.cmp as IrComparison, left, right);
  }
  return invalid("Unknown predicate.");
};

const asArray = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? (value as readonly unknown[]) : invalid("Expected an array.");

// ── Attributes and style ──────────────────────────────────────────────────────

const declarations = (
  ctx: Ctx,
  scope: Scope,
  entries: readonly (readonly [string, IrValue])[],
  depth: number,
): string => {
  const parts: string[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      report(ctx, "invalid-style", "A style declaration is a [property, value] pair.");
      continue;
    }
    const [property, raw] = entry;
    const value = evalValue(ctx, scope, raw, depth + 1);
    if (value === undefined || value === null) continue;
    if (typeof property !== "string" || !CSS_PROPERTY.test(property)) {
      report(
        ctx,
        "unsupported-style-property",
        `Style property ${JSON.stringify(property)} is not a CSS property name.`,
      );
      continue;
    }
    if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
      report(ctx, "invalid-style-value", `Style ${property} must be a string or finite number.`);
      continue;
    }
    const text = declarationValue(property, value);
    if (CSS_UNSAFE.test(text) || CONTROL_CHARACTERS.test(text)) {
      report(
        ctx,
        "unsafe-style-value",
        `Style ${property} contains CSS that could break out of the declaration.`,
      );
      continue;
    }
    let unsafeUrl: string | undefined;
    for (const match of text.matchAll(CSS_URL)) {
      if (!isSafeUrl(match[2] ?? "")) unsafeUrl = match[2] ?? "";
    }
    if (unsafeUrl !== undefined) {
      report(
        ctx,
        "unsafe-url",
        `Style ${property} points at ${JSON.stringify(unsafeUrl)}; email URLs must use https:, mailto:, tel:, cid: or a fragment.`,
      );
      continue;
    }
    parts.push(`${kebab(property)}:${text}`);
  }
  return parts.join(";");
};

const styleText = (ctx: Ctx, scope: Scope, style: IrStyle, depth: number): string => {
  checkDepth(depth);
  if (typeof style === "string") {
    if (CONTROL_CHARACTERS.test(style)) {
      report(ctx, "unsafe-style-value", "A style contains control characters.");
      return "";
    }
    return style;
  }
  if (Array.isArray(style)) {
    return declarations(ctx, scope, style as readonly (readonly [string, IrValue])[], depth);
  }
  if (isRecord(style) && has(style, "if")) {
    return evalPredicate(ctx, scope, style.if as IrPredicate, depth + 1)
      ? styleText(ctx, scope, style.then as IrStyle, depth + 1)
      : styleText(ctx, scope, style.else as IrStyle, depth + 1);
  }
  report(
    ctx,
    "invalid-style",
    "An element style is a string, a declaration list or a conditional.",
  );
  return "";
};

const attributeText = (
  ctx: Ctx,
  tag: string,
  name: string,
  spec: EmailAttributeSpec,
  value: unknown,
): string | undefined => {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return "";
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
    report(
      ctx,
      "invalid-attribute-value",
      `<${tag} ${name}> must be a string or finite number, not ${typeof value}.`,
    );
    return undefined;
  }
  const text = String(value);
  if (CONTROL_CHARACTERS.test(text)) {
    report(ctx, "invalid-attribute-value", `<${tag} ${name}> contains control characters.`);
    return undefined;
  }
  if (spec.values !== undefined && !spec.values.includes(text)) {
    report(
      ctx,
      "invalid-attribute-value",
      `<${tag} ${name}> accepts ${spec.values.join(", ")}; received ${JSON.stringify(text)}.`,
    );
    return undefined;
  }
  if (spec.type === "number" && !/^-?\d+$/.test(text)) {
    report(ctx, "invalid-attribute-value", `<${tag} ${name}> must be an integer.`);
    return undefined;
  }
  if (spec.type === "measure" && !/^\d+(\.\d+)?%?$/.test(text)) {
    report(
      ctx,
      "invalid-attribute-value",
      `<${tag} ${name}> must be a pixel count or a percentage.`,
    );
    return undefined;
  }
  if (spec.type === "url" && !isSafeUrl(text)) {
    report(
      ctx,
      "unsafe-url",
      `<${tag} ${name}> must use https:, mailto:, tel:, cid: or a fragment; received ${JSON.stringify(text)}. A relative path resolves only in an export, never in a delivered message.`,
    );
    return undefined;
  }
  return text;
};

const buildAttributes = (
  ctx: Ctx,
  scope: Scope,
  tag: string,
  spec: EmailElementSpec,
  node: IrElement,
  props: Map<string, unknown>,
  depth: number,
): string => {
  const emitted: string[] = [];
  const present = new Set<string>();
  let classes: string | undefined;
  const source = node.attrs ?? {};
  if (!isRecord(source)) {
    report(ctx, "invalid-attribute-value", `<${tag}> attrs must be an object.`);
    return "";
  }
  for (const [key, raw] of Object.entries(source)) {
    if (key === "key") continue;
    const name = key === "className" ? "class" : key;
    const value = evalValue(ctx, scope, raw, depth + 1);
    props.set(name, value);
    // The brand footer's unsubscribe link: its href is a placeholder the send path fills per
    // delivery, and the no-track marker keeps click tracking from rewriting it.
    if (tag === "a" && name === "href" && raw === ctx.brandPlugin.unsubscribeUrlPlaceholder) {
      present.add(name);
      emitted.push(
        ` href="${escapeAttribute(ctx.brandPlugin.unsubscribeUrlPlaceholder)}" ${ctx.brandPlugin.noTrackAttribute}`,
      );
      continue;
    }
    if (name === "class") {
      if (value === undefined || value === null) continue;
      if (typeof value !== "string") {
        report(ctx, "invalid-attribute-value", `<${tag} class> must be a string.`);
        continue;
      }
      if (CONTROL_CHARACTERS.test(value)) {
        report(ctx, "invalid-attribute-value", `<${tag} class> contains control characters.`);
        continue;
      }
      if (classes !== undefined) {
        report(ctx, "duplicate-attribute", `<${tag}> sets both class and className; keep one.`);
        continue;
      }
      classes = value;
      emitted.push(` class="${escapeAttribute(value)}"`);
      continue;
    }
    if (name === "style") {
      report(
        ctx,
        "invalid-style",
        `<${tag}> writes its style on the element, not as an attribute.`,
      );
      continue;
    }
    if (/^on/i.test(name)) {
      report(
        ctx,
        "event-handler",
        `<${tag} ${name}> is an event handler; email clients strip scripting and Samva refuses it.`,
      );
      continue;
    }
    if (ctx.reservedAttributes.has(name) && node.reserved !== true) {
      report(ctx, "reserved-attribute", `<${tag} ${name}> is reserved for the brand footer.`);
      continue;
    }
    if (/^(data|aria)-[a-z0-9-]+$/.test(name)) {
      const text = attributeText(ctx, tag, name, { type: "string" }, value);
      if (text !== undefined) emitted.push(` ${name}="${escapeAttribute(text)}"`);
      continue;
    }
    const globals = EMAIL_GLOBAL_ATTRIBUTES as Readonly<Record<string, EmailAttributeSpec>>;
    const attribute = Object.hasOwn(globals, name)
      ? globals[name]
      : Object.hasOwn(spec.attributes, name)
        ? spec.attributes[name]
        : undefined;
    if (attribute === undefined) {
      report(ctx, "unsupported-attribute", `<${tag}> does not support the ${name} attribute.`);
      continue;
    }
    present.add(name);
    const text = attributeText(ctx, tag, name, attribute, value);
    if (text !== undefined) emitted.push(` ${name}="${escapeAttribute(text)}"`);
  }
  for (const [name, attribute] of Object.entries(spec.attributes)) {
    if (attribute.required === true && !present.has(name)) {
      report(ctx, "missing-attribute", `<${tag}> requires the ${name} attribute.`);
    }
  }
  if (node.style !== undefined) {
    const css = styleText(ctx, scope, node.style, depth + 1);
    if (css !== "") emitted.push(` style="${escapeAttribute(css)}"`);
  }
  return emitted.join("");
};

// ── Content model ─────────────────────────────────────────────────────────────

const checkContentModel = (
  ctx: Ctx,
  tag: string,
  spec: EmailElementSpec,
  children: readonly CNode[],
): void => {
  if (spec.content === "void") {
    if (children.length > 0) report(ctx, "void-element-children", `<${tag}> cannot have children.`);
    return;
  }
  if (spec.content === "text" || spec.content === "raw") {
    for (const child of children) {
      if (child.t !== "text") report(ctx, "invalid-content", `<${tag}> accepts text only.`);
    }
    return;
  }
  if (spec.childElements === undefined) return;
  for (const child of children) {
    if (child.t === "raw") continue;
    if (child.t === "text") {
      if (child.v.trim() !== "") {
        report(
          ctx,
          "invalid-content",
          `<${tag}> cannot contain text directly; put it inside <${spec.childElements[0]}>.`,
        );
      }
      continue;
    }
    if (!spec.childElements.includes(child.tag)) {
      report(
        ctx,
        "invalid-content",
        `<${tag}> accepts only ${spec.childElements.map((name) => `<${name}>`).join(", ")}; found <${child.tag}>.`,
      );
    }
  }
};

// ── Nodes ─────────────────────────────────────────────────────────────────────

const pushText = (out: CNode[], value: unknown): void => {
  if (value === null || value === undefined || typeof value === "boolean") return;
  out.push({ t: "text", v: textOf(value) });
};

const evalElement = (
  ctx: Ctx,
  scope: Scope,
  node: IrElement,
  depth: number,
  out: CNode[],
): void => {
  const tag = node.el;
  if (ctx.plain) {
    report(ctx, "unsupported-element", "A plain-text body cannot contain elements.");
    return;
  }
  const spec = typeof tag === "string" ? emailElement(tag) : undefined;
  if (spec === undefined) {
    report(
      ctx,
      "unsupported-element",
      `<${String(tag)}> is not part of the supported email vocabulary.`,
    );
    return;
  }
  const children: CNode[] = [];
  for (const child of node.children ?? []) evalNode(ctx, scope, child, depth + 1, children);
  checkContentModel(ctx, tag, spec, children);
  if (spec.content === "raw") {
    const css = children.map((child) => (child.t === "text" ? child.v : "")).join("");
    if (/<\/|<!--/i.test(css)) {
      report(ctx, "unsafe-raw-text", `<${tag}> content cannot contain markup.`);
      return;
    }
  }
  const props = new Map<string, unknown>();
  const attrs = buildAttributes(ctx, scope, tag, spec, node, props, depth);
  out.push({
    t: "el",
    tag,
    content: spec.content,
    layout: spec.layout,
    attrs,
    props,
    children,
    src: node.src,
  });
};

const evalRaw = (ctx: Ctx, scope: Scope, node: IrRaw, depth: number, out: CNode[]): void => {
  if (ctx.plain) {
    out.push({
      t: "text",
      v: node.text === undefined ? "" : textOf(evalValue(ctx, scope, node.text, depth + 1)),
    });
    return;
  }
  const html = asArray(node.raw)
    .map((part) => rawPart(ctx, scope, part as IrRawPart, depth + 1))
    .join("");
  const text = node.text === undefined ? "" : textOf(evalValue(ctx, scope, node.text, depth + 1));
  out.push({ t: "raw", html, text });
};

const rawPart = (ctx: Ctx, scope: Scope, part: IrRawPart, depth: number): string => {
  if (typeof part === "string") return part;
  const record = part as Readonly<Record<string, unknown>>;
  if (isRecord(record) && has(record, "attr")) {
    return escapeAttribute(textOf(evalValue(ctx, scope, record.attr as IrValue, depth + 1)));
  }
  if (isRecord(record) && has(record, "text")) {
    return escapeText(textOf(evalValue(ctx, scope, record.text as IrValue, depth + 1)));
  }
  return invalid("A raw part is a string, {attr} or {text}.");
};

const loopKey = (name: string): string => (name.startsWith("$") ? name : `$${name}`);

/** The items that satisfy a `where` clause, each bound as the loop variable while it is tested. */
const selectItems = (
  ctx: Ctx,
  scope: Scope,
  items: readonly unknown[],
  as: string,
  where: IrPredicate | undefined,
  depth: number,
): readonly unknown[] => {
  if (where === undefined) return items;
  const key = loopKey(as);
  return items.filter((item) => {
    if (++ctx.iterations > MAX_ITERATIONS) {
      fail("render-limit", `A render iterates at most ${MAX_ITERATIONS} times.`);
    }
    const inner = new Map(scope);
    inner.set(key, item);
    return evalPredicate(ctx, inner, where, depth + 1);
  });
};

const evalEach = (ctx: Ctx, scope: Scope, node: IrEach, depth: number, out: CNode[]): void => {
  const source = evalValue(ctx, scope, node.each, depth + 1);
  if (!Array.isArray(source)) invalid("each needs an array.");
  const selected = selectItems(
    ctx,
    scope,
    source as readonly unknown[],
    String(node.as),
    node.where,
    depth,
  );
  let items: readonly unknown[] = selected;
  if (node.chunk !== undefined) {
    if (!Number.isInteger(node.chunk) || node.chunk < 1) invalid("chunk is a positive integer.");
    const slices: unknown[][] = [];
    for (let at = 0; at < selected.length; at += node.chunk)
      slices.push(selected.slice(at, at + node.chunk));
    items = slices;
  }
  const itemKey = loopKey(String(node.as));
  const indexKey = node.index === undefined ? undefined : loopKey(String(node.index));
  for (const [index, item] of items.entries()) {
    if (++ctx.iterations > MAX_ITERATIONS) {
      fail("render-limit", `A render iterates at most ${MAX_ITERATIONS} times.`);
    }
    const inner = new Map(scope);
    inner.set(itemKey, item);
    if (indexKey !== undefined) inner.set(indexKey, index);
    for (const child of asArray(node.children)) {
      evalNode(ctx, inner, child as IrNode, depth + 1, out);
    }
  }
};

const evalNode = (ctx: Ctx, scope: Scope, node: IrNode, depth: number, out: CNode[]): void => {
  checkDepth(depth);
  if (node === null || typeof node !== "object") {
    pushText(out, node);
    return;
  }
  if (!isRecord(node)) {
    invalid("An array cannot be rendered as a node.");
    return;
  }
  if (has(node, "el")) return evalElement(ctx, scope, node as unknown as IrElement, depth, out);
  if (has(node, "each")) return evalEach(ctx, scope, node as unknown as IrEach, depth, out);
  if (has(node, "raw")) return evalRaw(ctx, scope, node as unknown as IrRaw, depth, out);
  if (has(node, "preheader")) {
    if (!ctx.markerUsed && ctx.preheader !== undefined && !ctx.plain) {
      ctx.markerUsed = true;
      out.push(preheaderBlock(ctx, ctx.preheader));
    }
    return;
  }
  if (has(node, "if") && Array.isArray((node as Readonly<Record<string, unknown>>).then)) {
    const branch = evalPredicate(ctx, scope, (node as unknown as IrIf).if, depth + 1)
      ? (node as unknown as IrIf).then
      : ((node as unknown as IrIf).else ?? []);
    for (const child of branch) evalNode(ctx, scope, child, depth + 1, out);
    return;
  }
  pushText(out, evalValue(ctx, scope, node as IrValue, depth + 1));
};

// ── Preheader ─────────────────────────────────────────────────────────────────

const PREHEADER_STYLE: readonly (readonly [string, IrValue])[] = [
  ["display", "none"],
  ["overflow", "hidden"],
  ["lineHeight", "1px"],
  ["opacity", 0],
  ["maxHeight", 0],
  ["maxWidth", 0],
];

/** The hidden inbox-preview block: the text, then padding so the client cannot borrow body copy. */
const preheaderBlock = (ctx: Ctx, text: string): CNode => {
  const children: IrNode[] = [text];
  if (text.length < PREHEADER_TARGET_LENGTH) {
    children.push({
      el: "div",
      attrs: { "data-samva-preheader-padding": true },
      children: [
        PREHEADER_PADDING.repeat(
          Math.ceil((PREHEADER_TARGET_LENGTH - text.length) / PREHEADER_PADDING.length),
        ),
      ],
    });
  }
  const out: CNode[] = [];
  evalElement(
    ctx,
    new Map(),
    { el: "div", attrs: { "data-samva-preheader": text }, style: PREHEADER_STYLE, children },
    0,
    out,
  );
  return out[0] ?? { t: "text", v: "" };
};

/** Put the block first inside `<body>`, or return undefined when there is no body. */
const insertPreheader = (nodes: readonly CNode[], block: CNode): readonly CNode[] | undefined => {
  for (const [index, node] of nodes.entries()) {
    if (node.t !== "el") continue;
    if (node.tag === "body")
      return nodes.with(index, { ...node, children: [block, ...node.children] });
    const replaced = insertPreheader(node.children, block);
    if (replaced !== undefined) return nodes.with(index, { ...node, children: replaced });
  }
  return undefined;
};

// ── Serialization ─────────────────────────────────────────────────────────────

const serialize = (node: CNode): string => {
  switch (node.t) {
    case "text":
      return escapeText(node.v);
    case "raw":
      return node.html;
    case "el": {
      if (node.content === "raw") {
        const css = node.children.map((child) => (child.t === "text" ? child.v : "")).join("");
        return css === "" ? "" : `<${node.tag}${node.attrs}>${css}</${node.tag}>`;
      }
      if (node.content === "void") return `<${node.tag}${node.attrs} />`;
      return `<${node.tag}${node.attrs}>${node.children.map(serialize).join("")}</${node.tag}>`;
    }
  }
};

/** Serialize while recording where each element lands, for the same document `serialize` writes. */
const serializeWithPositions = (
  nodes: readonly CNode[],
  offset: number,
): { readonly html: string; readonly positions: readonly RenderedPosition[] } => {
  const positions: RenderedPosition[] = [];
  let written = offset;
  const write = (node: CNode): string => {
    switch (node.t) {
      case "text": {
        const out = escapeText(node.v);
        written += out.length;
        return out;
      }
      case "raw":
        written += node.html.length;
        return node.html;
      case "el": {
        const start = written;
        let out: string;
        if (node.content === "raw") {
          const css = node.children.map((child) => (child.t === "text" ? child.v : "")).join("");
          out = css === "" ? "" : `<${node.tag}${node.attrs}>${css}</${node.tag}>`;
          written += out.length;
        } else if (node.content === "void") {
          out = `<${node.tag}${node.attrs} />`;
          written += out.length;
        } else {
          const open = `<${node.tag}${node.attrs}>`;
          written += open.length;
          const inner = node.children.map(write).join("");
          const close = `</${node.tag}>`;
          written += close.length;
          out = `${open}${inner}${close}`;
        }
        positions.push({
          start,
          end: written,
          tag: node.tag,
          ...(node.src === undefined ? {} : { src: node.src }),
        });
        return out;
      }
    }
  };
  const html = nodes.map(write).join("");
  return { html, positions };
};

// ── Plain-text derivation (mirrors ./email/text) ──────────────────────────────

interface TextContext {
  readonly preformatted: boolean;
  readonly listDepth: number;
}

const PARAGRAPH = "\n\n";
const LINE = "\n";
const INVISIBLE = /​|‌|‍|‎|‏|⁠|﻿/g;
const TABLE_SECTIONS = new Set(["thead", "tbody", "tfoot"]);

const isLayoutTable = (props: ReadonlyMap<string, unknown>): boolean =>
  props.get("role") === "presentation" || props.get("role") === "none";

const wrap = (inner: string, separator: string): string => {
  const trimmed = inner.replace(/^\s+/, "").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${separator}${trimmed}${separator}`;
};

const collect = (
  nodes: readonly CNode[],
  keep: (tag: string) => boolean,
  descend: (tag: string) => boolean,
): readonly CElement[] =>
  nodes.flatMap((child) => {
    if (child.t !== "el") return [];
    if (keep(child.tag)) return [child];
    return descend(child.tag) ? collect(child.children, keep, descend) : [];
  });

const childText = (node: CElement, context: TextContext): string =>
  node.children.map((child) => derive(child, context)).join("");

const isDecorativeCell = (cell: CElement, context: TextContext): boolean => {
  const images = collect(
    cell.children,
    (tag) => tag === "img",
    () => true,
  );
  return (
    images.length > 0 &&
    images.every((image) => image.props.get("alt") === "") &&
    childText(cell, context).trim() === ""
  );
};

const deriveList = (node: CElement, context: TextContext): string => {
  const indent = "  ".repeat(context.listDepth);
  const start = Number(node.props.get("start") ?? 1);
  const first = Number.isFinite(start) ? start : 1;
  const nested = { ...context, listDepth: context.listDepth + 1 };
  const items = collect(
    node.children,
    (tag) => tag === "li",
    () => false,
  );
  const lines = items.map((item, index) => {
    const marker = node.tag === "ol" ? `${first + index}.` : "-";
    const continuation = `${indent}${" ".repeat(marker.length + 1)}`;
    const [head = "", ...rest] = derive(item, nested)
      .replace(/^\s+/, "")
      .replace(/\s+$/, "")
      .replace(/\n{2,}/g, LINE)
      .split("\n");
    return [
      `${indent}${marker} ${head}`,
      ...rest.map((line) =>
        line.trim() === "" ? "" : /^\s/.test(line) ? line : `${continuation}${line}`,
      ),
    ].join(LINE);
  });
  return wrap(lines.join(LINE), PARAGRAPH);
};

const deriveTable = (node: CElement, context: TextContext): string => {
  if (isLayoutTable(node.props)) return childText(node, context);
  const rows = collect(
    node.children,
    (tag) => tag === "tr",
    (tag) => TABLE_SECTIONS.has(tag),
  ).map((row) =>
    collect(
      row.children,
      (tag) => tag === "td" || tag === "th",
      () => false,
    )
      .filter((cell) => !isDecorativeCell(cell, context))
      .map((cell) => childText(cell, context).replace(/\s+/g, " ").trim())
      .join(" | "),
  );
  return wrap(rows.join(LINE), PARAGRAPH);
};

const deriveElement = (node: CElement, context: TextContext): string => {
  switch (node.layout) {
    case "metadata":
      return "";
    case "document":
    case "inline":
    case "list-item":
      return childText(node, context);
    case "break":
      return LINE;
    case "rule":
      return `${PARAGRAPH}---${PARAGRAPH}`;
    case "image": {
      const alt = node.props.get("alt");
      const trimmed = typeof alt === "string" ? alt.trim() : "";
      return trimmed === "" ? "" : `[${trimmed}]`;
    }
    case "link": {
      const label = childText(node, context).replace(/\s+/g, " ").trim();
      const target = node.props.get("href");
      const href = typeof target === "string" ? target : "";
      if (href === "" || href === label) return label;
      return label === "" ? href : `${label} (${href})`;
    }
    case "list":
      return deriveList(node, context);
    case "table":
      return deriveTable(node, context);
    case "row":
      return wrap(
        collect(
          node.children,
          (tag) => tag === "td" || tag === "th",
          () => false,
        )
          .map((cell) => childText(cell, context).replace(/^\s+|\s+$/g, ""))
          .filter((cell) => cell !== "")
          .join(LINE),
        LINE,
      );
    case "table-section":
    case "cell":
      return wrap(childText(node, context), LINE);
    case "preformatted":
      return wrap(childText(node, { ...context, preformatted: true }), PARAGRAPH);
    case "block":
      return wrap(childText(node, context), PARAGRAPH);
  }
};

const derive = (node: CNode, context: TextContext): string => {
  switch (node.t) {
    case "text":
      return context.preformatted
        ? node.v
        : node.v.replace(INVISIBLE, "").replace(/[^\S\n]+/g, " ");
    case "raw":
      return node.text;
    case "el":
      return deriveElement(node, context);
  }
};

const normalize = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, PARAGRAPH)
    .trim();

// ── Entry points ──────────────────────────────────────────────────────────────

const createContext = (
  ir: TemplateIr,
  input: unknown,
  options: RenderOptions,
  plain: boolean,
): Ctx => {
  const brandPlugin = options.brandPlugin ?? samvaBrandPlugin;
  return {
    input,
    locale: options.locale ?? ir.locale,
    timeZone: options.timeZone,
    plain,
    brandPlugin,
    reservedAttributes: reservedBrandAttributes(brandPlugin),
    diagnostics: [],
    iterations: 0,
    fmt: undefined,
    preheader: undefined,
    markerUsed: false,
  };
};

const settle = (ctx: Ctx): void => {
  if (ctx.diagnostics.length > 0) throw new IrRenderError(ctx.diagnostics);
};

/** Render the email channel of a compiled template against one validated input. */
export const renderIr = (
  ir: TemplateIr,
  input: unknown,
  options: RenderOptions = {},
): RenderedIrEmail => {
  const email = ir.email;
  if (email === undefined) return fail("missing-channel", "The template has no email channel.");
  const ctx = createContext(ir, input, options, false);
  const empty: Scope = new Map();

  const subject = textOf(evalValue(ctx, empty, email.subject, 0));
  if (/[\r\n\u0000]/.test(subject)) {
    fail("invalid-subject", "Invalid email subject: it must be one line of text.");
  }
  if (email.preheader !== undefined) {
    const value = evalValue(ctx, empty, email.preheader, 0);
    if (value !== undefined && value !== null) ctx.preheader = textOf(value);
  }
  const preheader = ctx.preheader;

  let tree: readonly CNode[] = [];
  const nodes: CNode[] = [];
  evalNode(ctx, empty, email.body, 0, nodes);
  tree = nodes;
  if (preheader !== undefined && !ctx.markerUsed) {
    const block = preheaderBlock(ctx, preheader);
    tree = insertPreheader(tree, block) ?? [block, ...tree];
  }
  settle(ctx);

  const text = normalize(
    tree.map((node) => derive(node, { preformatted: false, listDepth: 0 })).join(""),
  );
  if (options.positions === true) {
    // The doctype is prepended after serialization, so every recorded offset moves with it.
    const probe = serializeWithPositions(tree, 0);
    const prefix = probe.html.startsWith("<html") ? EMAIL_DOCTYPE : "";
    const shifted = serializeWithPositions(tree, prefix.length);
    return {
      subject,
      preheader,
      html: `${prefix}${shifted.html}`,
      text,
      positions: shifted.positions,
    };
  }
  const serialized = tree.map(serialize).join("");
  const html = serialized.startsWith("<html") ? `${EMAIL_DOCTYPE}${serialized}` : serialized;
  return { subject, preheader, html, text };
};

const plainText = (ctx: Ctx, nodes: readonly IrNode[]): string => {
  const out: CNode[] = [];
  for (const node of asArray(nodes)) evalNode(ctx, new Map(), node as IrNode, 0, out);
  return out
    .map((node) => (node.t === "text" ? node.v : node.t === "raw" ? node.text : ""))
    .join("");
};

/** Render the SMS channel of a compiled template to plain text. */
export const renderIrSms = (
  ir: TemplateIr,
  input: unknown,
  options: RenderOptions = {},
): string => {
  const sms = ir.sms;
  if (sms === undefined) return fail("missing-channel", "The template has no SMS channel.");
  const ctx = createContext(ir, input, options, true);
  const text = plainText(ctx, sms.body);
  settle(ctx);
  return text;
};

const resolveButtons = (
  ctx: Ctx,
  nodes: readonly IrWhatsAppButtonNode[],
  out: RenderedWhatsAppButton[],
  depth: number,
): void => {
  checkDepth(depth);
  const scope: Scope = new Map();
  const value = (part: IrValue): string => textOf(evalValue(ctx, scope, part, 0));
  for (const node of asArray(nodes) as readonly IrWhatsAppButtonNode[]) {
    if ("if" in node) {
      const branch = evalPredicate(ctx, scope, node.if, depth + 1) ? node.then : (node.else ?? []);
      resolveButtons(ctx, branch, out, depth + 1);
      continue;
    }
    switch (node.type) {
      case "quick-reply":
        out.push({ type: "quick-reply", text: value(node.text) });
        break;
      case "url": {
        const url = value(node.url);
        if (!isSafeUrl(url)) invalid("A button URL must be an absolute https URL.");
        out.push({ type: "url", text: value(node.text), url });
        break;
      }
      case "phone":
        out.push({ type: "phone", text: value(node.text), phone: value(node.phone) });
        break;
      case "copy-code":
        out.push({ type: "copy-code", code: value(node.code) });
        break;
      default:
        invalid("Unknown WhatsApp button.");
    }
  }
};

/** Render the WhatsApp channel of a compiled template: every text rendered, conditional buttons resolved. */
export const renderIrWhatsApp = (
  ir: TemplateIr,
  input: unknown,
  options: RenderOptions = {},
): RenderedIrWhatsApp => {
  const whatsapp = ir.whatsapp;
  if (whatsapp === undefined)
    return fail("missing-channel", "The template has no WhatsApp channel.");
  const ctx = createContext(ir, input, options, true);
  const header =
    whatsapp.header === undefined
      ? undefined
      : { type: whatsapp.header.type, text: plainText(ctx, whatsapp.header.content) };
  if (header !== undefined && header.type !== "text" && !isSafeUrl(header.text))
    invalid("A media header URL must be an absolute https URL.");
  const body = plainText(ctx, whatsapp.body);
  const footer = whatsapp.footer === undefined ? undefined : plainText(ctx, whatsapp.footer);
  const buttons: RenderedWhatsAppButton[] = [];
  resolveButtons(ctx, whatsapp.buttons ?? [], buttons, 0);
  settle(ctx);
  return {
    ...(whatsapp.name === undefined ? {} : { name: whatsapp.name }),
    language: whatsapp.language,
    category: whatsapp.category,
    ...(header === undefined ? {} : { header }),
    body,
    ...(footer === undefined ? {} : { footer }),
    buttons,
  };
};
