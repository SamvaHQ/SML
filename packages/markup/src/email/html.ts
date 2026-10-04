/* oxlint-disable eslint/no-control-regex -- URL and attribute validation intentionally rejects control characters. */
import { isObject } from "../internal/guards";
import { BRAND_FOOTER_MARKER, UNSUBSCRIBE_LINK } from "../internal/unsubscribe-link";
import { INSTANCE_PATH_ATTRIBUTE, type EmittedPosition } from "../preview";
import type { JsxSourceLocation } from "../source-locations";
import { reservedBrandAttributes, type BrandPlugin } from "./brand-plugin";
import type { EmailDiagnostic } from "./diagnostics";
import {
  emailElement,
  EMAIL_ELEMENTS,
  EMAIL_GLOBAL_ATTRIBUTES,
  type EmailAttributeSpec,
  type EmailElementSpec,
} from "./elements";
import type { EmailNode } from "./jsx-runtime";
import { samvaBrandPlugin } from "./samva-brand-plugin";

// The serializer is the only place authored values become markup. Every value
// is escaped for its context, every attribute is checked against the element's
// spec, and anything outside the vocabulary produces a located diagnostic
// instead of disappearing from the output.

/** Escape a value for element content. */
export const escapeText = (value: string): string =>
  value.replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
  );

/** Escape a value for a double-quoted attribute. */
export const escapeAttribute = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SAFE_URL_SCHEME = /^(https:\/\/|mailto:|tel:|cid:|#)/i;
// A local export serves assets from a relative base, so a relative reference is
// legal — but only one that cannot be read as a scheme. `//host` is excluded: it
// inherits a protocol the message has no control over.
const RELATIVE_URL = /^(\.{1,2}\/|\/(?!\/))/;

/**
 * Only references an email client will follow safely; no `javascript:`, no
 * `data:`. A relative reference is legal only for an export: a file on disk can
 * resolve one against its own directory, and a delivered message cannot resolve
 * anything but an absolute URL.
 */
const isSafeUrl = (value: string, relative: boolean): boolean =>
  !/^[\u0000-\u0020]/.test(value) &&
  !CONTROL_CHARACTERS.test(value) &&
  !value.includes("\\") &&
  (SAFE_URL_SCHEME.test(value) || (relative && RELATIVE_URL.test(value)));

// camelCase from an authored style object, kebab-case from the cascade.
const CSS_PROPERTY = /^(--[a-zA-Z0-9-]+|[a-zA-Z][a-zA-Z0-9-]*)$/;
const CSS_UNSAFE = /[;{}<>\\]|expression\s*\(|@import|\/\*/i;
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/** camelCase to kebab-case; already-kebab names pass through unchanged. */
export const kebab = (property: string): string =>
  property.startsWith("--") ? property : property.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`);

// A bare number is pixels for every property that takes a length, which is what
// an author coming from React style objects expects. These are the properties
// in the supported subset where a bare number is already a valid value.
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

/** A bare number is pixels for every property that takes a length. */
export const declarationValue = (property: string, value: string | number): string =>
  typeof value === "number" && value !== 0 && !UNITLESS.has(property) && !property.startsWith("--")
    ? `${value}px`
    : String(value);

interface Sink {
  readonly diagnostics: EmailDiagnostic[];
  /** True when this document is an export rather than a message to deliver. */
  readonly relativeUrls: boolean;
  /** True when each element carries its instance path as an attribute. */
  readonly instancePaths: boolean;
  readonly brandPlugin: BrandPlugin;
  /** The attributes only `BrandFooter` writes. */
  readonly reservedAttributes: ReadonlySet<string>;
  /** Offset ranges of each emitted element, for mapping a finding back to source. */
  readonly positions: EmittedPosition[];
  /** Characters written so far, so a range can be recorded without a second pass. */
  written: number;
}

/** Elements are numbered within their parent; fragments are transparent to that count. */
interface ElementCounter {
  next: number;
}

const report = (
  sink: Sink,
  code: string,
  message: string,
  origins: readonly JsxSourceLocation[],
  severity: EmailDiagnostic["severity"] = "error",
): void => {
  sink.diagnostics.push({ code, severity, message, origins });
};

const declarations = (
  sink: Sink,
  style: Readonly<Record<string, unknown>>,
  origins: readonly JsxSourceLocation[],
): string => {
  const parts: string[] = [];
  for (const [property, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (!CSS_PROPERTY.test(property)) {
      report(
        sink,
        "unsupported-style-property",
        `Style property ${JSON.stringify(property)} is not a CSS property name; write it in camelCase (backgroundColor) or as a custom property (--brand).`,
        origins,
      );
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number") {
      report(
        sink,
        "invalid-style-value",
        `Style ${property} must be a string or number, not ${typeof value}.`,
        origins,
      );
      continue;
    }
    const text = declarationValue(property, value);
    if (CSS_UNSAFE.test(text) || CONTROL_CHARACTERS.test(text)) {
      report(
        sink,
        "unsafe-style-value",
        `Style ${property} contains CSS that could break out of the declaration; remove ${JSON.stringify(text)}.`,
        origins,
      );
      continue;
    }
    let unsafeUrl: string | undefined;
    for (const match of text.matchAll(CSS_URL)) {
      if (!isSafeUrl(match[2] ?? "", sink.relativeUrls)) unsafeUrl = match[2] ?? "";
    }
    if (unsafeUrl !== undefined) {
      report(
        sink,
        "unsafe-url",
        `Style ${property} points at ${JSON.stringify(unsafeUrl)}; email URLs must use https:, mailto:, tel:, cid: or a fragment${sink.relativeUrls ? ", or a relative path" : ""}.`,
        origins,
      );
      continue;
    }
    parts.push(`${kebab(property)}:${text}`);
  }
  return parts.join(";");
};

const attributeValue = (
  sink: Sink,
  tag: string,
  name: string,
  spec: EmailAttributeSpec,
  value: unknown,
  origins: readonly JsxSourceLocation[],
): string | undefined => {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    report(
      sink,
      "invalid-attribute-value",
      `<${tag} ${name}> must be a string or number, not ${typeof value}.`,
      origins,
    );
    return undefined;
  }
  const text = String(value);
  if (CONTROL_CHARACTERS.test(text)) {
    report(
      sink,
      "invalid-attribute-value",
      `<${tag} ${name}> contains control characters.`,
      origins,
    );
    return undefined;
  }
  if (spec.values !== undefined && !spec.values.includes(text)) {
    report(
      sink,
      "invalid-attribute-value",
      `<${tag} ${name}> accepts ${spec.values.join(", ")}; received ${JSON.stringify(text)}.`,
      origins,
    );
    return undefined;
  }
  if (spec.type === "number" && !/^-?\d+$/.test(text)) {
    report(sink, "invalid-attribute-value", `<${tag} ${name}> must be an integer.`, origins);
    return undefined;
  }
  if (spec.type === "measure" && !/^\d+(\.\d+)?%?$/.test(text)) {
    report(
      sink,
      "invalid-attribute-value",
      `<${tag} ${name}> must be a pixel count or a percentage.`,
      origins,
    );
    return undefined;
  }
  if (spec.type === "url" && !isSafeUrl(text, sink.relativeUrls)) {
    report(
      sink,
      "unsafe-url",
      sink.relativeUrls
        ? `<${tag} ${name}> must use https:, mailto:, tel:, cid:, a fragment, or a relative path; received ${JSON.stringify(text)}.`
        : `<${tag} ${name}> must use https:, mailto:, tel:, cid: or a fragment; received ${JSON.stringify(text)}. A relative path resolves only in an export, never in a delivered message.`,
      origins,
    );
    return undefined;
  }
  return text;
};

const attributes = (
  sink: Sink,
  tag: string,
  spec: EmailElementSpec,
  props: Readonly<Record<string, unknown>>,
  origins: readonly JsxSourceLocation[],
): string => {
  const emitted: string[] = [];
  const present = new Set<string>();
  let classes: string | undefined;
  // The brand footer's unsubscribe link: its href is a placeholder the send
  // path fills per delivery, and the no-track marker keeps click tracking from
  // rewriting it.
  const unsubscribeLink =
    tag === "a" && (props as Readonly<Record<PropertyKey, unknown>>)[UNSUBSCRIBE_LINK] === true;
  const { unsubscribeUrlPlaceholder, noTrackAttribute } = sink.brandPlugin;
  for (const [key, value] of Object.entries(props)) {
    if (key === "key") continue;
    const name = key === "className" ? "class" : key;
    if (unsubscribeLink && name === "href" && value === unsubscribeUrlPlaceholder) {
      present.add(name);
      emitted.push(` href="${escapeAttribute(unsubscribeUrlPlaceholder)}" ${noTrackAttribute}`);
      continue;
    }
    if (name === "class") {
      if (value === undefined || value === null) continue;
      if (typeof value !== "string") {
        report(sink, "invalid-attribute-value", `<${tag} class> must be a string.`, origins);
        continue;
      }
      if (classes !== undefined) {
        report(
          sink,
          "duplicate-attribute",
          `<${tag}> sets both class and className; keep one.`,
          origins,
        );
        continue;
      }
      classes = value;
      emitted.push(` class="${escapeAttribute(value)}"`);
      continue;
    }
    if (name === "style") {
      if (value === undefined || value === null) continue;
      if (!isObject(value) || Array.isArray(value)) {
        report(
          sink,
          "invalid-style",
          `<${tag} style> must be a property object, for example style={{ backgroundColor: "#fff" }}.`,
          origins,
        );
        continue;
      }
      const css = declarations(sink, value as Readonly<Record<string, unknown>>, origins);
      if (css !== "") emitted.push(` style="${escapeAttribute(css)}"`);
      continue;
    }
    if (/^on/i.test(name)) {
      report(
        sink,
        "event-handler",
        `<${tag} ${name}> is an event handler; email clients strip scripting and Samva refuses it.`,
        origins,
      );
      continue;
    }
    if (
      sink.reservedAttributes.has(name) &&
      (props as Readonly<Record<PropertyKey, unknown>>)[BRAND_FOOTER_MARKER] !== true
    ) {
      report(
        sink,
        "reserved-attribute",
        `<${tag} ${name}> is written only by BrandFooter from ${sink.brandPlugin.specifier}; render BrandFooter instead of marking an element as the footer.`,
        origins,
      );
      continue;
    }
    if (/^(data|aria)-[a-z0-9-]+$/.test(name)) {
      const text = attributeValue(sink, tag, name, { type: "string" }, value, origins);
      if (text !== undefined) emitted.push(` ${name}="${escapeAttribute(text)}"`);
      continue;
    }
    const globalAttributes = EMAIL_GLOBAL_ATTRIBUTES as Readonly<
      Record<string, EmailAttributeSpec>
    >;
    const attribute = Object.hasOwn(globalAttributes, name)
      ? globalAttributes[name]
      : Object.hasOwn(spec.attributes, name)
        ? spec.attributes[name]
        : undefined;
    if (attribute === undefined) {
      const supported = [
        ...Object.keys(EMAIL_GLOBAL_ATTRIBUTES),
        ...Object.keys(spec.attributes),
        "class",
        "style",
      ]
        .sort()
        .join(", ");
      report(
        sink,
        "unsupported-attribute",
        `<${tag}> does not support the ${name} attribute. Supported: ${supported}, plus data-* and aria-*.`,
        origins,
      );
      continue;
    }
    present.add(name);
    const text = attributeValue(sink, tag, name, attribute, value, origins);
    if (text !== undefined) emitted.push(` ${name}="${escapeAttribute(text)}"`);
  }
  for (const [name, attribute] of Object.entries(spec.attributes)) {
    if (attribute.required === true && !present.has(name))
      report(sink, "missing-attribute", `<${tag}> requires the ${name} attribute.`, origins);
  }
  return emitted.join("");
};

/** Fragments are transparent to a content model; raw compatibility markup is not content. */
const contentChildren = (children: readonly EmailNode[]): readonly EmailNode[] =>
  children.flatMap((child) =>
    child.type === "Fragment" ? contentChildren(child.children) : [child],
  );

const checkContentModel = (
  sink: Sink,
  tag: string,
  spec: EmailElementSpec,
  children: readonly EmailNode[],
  origins: readonly JsxSourceLocation[],
): void => {
  if (spec.content === "void") {
    if (contentChildren(children).length > 0)
      report(sink, "void-element-children", `<${tag}> cannot have children.`, origins);
    return;
  }
  if (spec.content === "text" || spec.content === "raw") {
    for (const child of contentChildren(children))
      if (child.type !== "Text")
        report(
          sink,
          "invalid-content",
          `<${tag}> accepts text only.`,
          child.type === "Element" ? child.origins : origins,
        );
    return;
  }
  if (spec.childElements === undefined) return;
  for (const child of contentChildren(children)) {
    if (child.type === "Raw") continue;
    if (child.type === "Text") {
      if (child.value.trim() !== "")
        report(
          sink,
          "invalid-content",
          `<${tag}> cannot contain text directly; put it inside <${spec.childElements[0]}>.`,
          origins,
        );
      continue;
    }
    if (child.type === "Element" && !spec.childElements.includes(child.tag))
      report(
        sink,
        "invalid-content",
        `<${tag}> accepts only ${spec.childElements.map((name) => `<${name}>`).join(", ")}; found <${child.tag}>.`,
        child.origins,
      );
  }
};

/** Every write goes through here so `sink.written` stays the emitted offset. */
const emit = (sink: Sink, text: string): string => {
  sink.written += text.length;
  return text;
};

const serialize = (
  sink: Sink,
  node: EmailNode,
  parentPath: string,
  counter: ElementCounter,
): string => {
  switch (node.type) {
    case "Text":
      return emit(sink, escapeText(node.value));
    case "Raw":
      return emit(sink, node.html);
    case "Fragment":
      return node.children.map((child) => serialize(sink, child, parentPath, counter)).join("");
    case "Element": {
      const start = sink.written;
      const index = counter.next++;
      const path = parentPath === "" ? String(index) : `${parentPath}.${index}`;
      const own: ElementCounter = { next: 0 };
      const stamp = sink.instancePaths ? ` ${INSTANCE_PATH_ATTRIBUTE}="${path}"` : "";
      const spec = emailElement(node.tag);
      if (spec === undefined) {
        report(
          sink,
          "unsupported-element",
          `<${node.tag}> is not part of the supported email vocabulary. Supported elements: ${Object.keys(EMAIL_ELEMENTS).join(", ")}.`,
          node.origins,
        );
        return "";
      }
      checkContentModel(sink, node.tag, spec, node.children, node.origins);
      if (spec.content === "raw") {
        const css = node.children
          .map((child) => (child.type === "Text" ? child.value : ""))
          .join("");
        // Raw text cannot be escaped without breaking it, so it must not be
        // able to close its own element. Only the compiler builds these nodes.
        if (/<\/|<!--/i.test(css)) {
          report(
            sink,
            "unsafe-raw-text",
            `<${node.tag}> content cannot contain markup.`,
            node.origins,
          );
          return "";
        }
        const rawAttrs = attributes(sink, node.tag, spec, node.props, node.origins);
        const raw = css === "" ? "" : `<${node.tag}${rawAttrs}${stamp}>${css}</${node.tag}>`;
        return record(sink, start, node, path, emit(sink, raw));
      }
      const attrs = attributes(sink, node.tag, spec, node.props, node.origins);
      // Void elements close themselves: the transitional XHTML doctype email
      // needs is served to parsers that treat an unclosed tag as an error.
      if (spec.content === "void")
        return record(sink, start, node, path, emit(sink, `<${node.tag}${attrs}${stamp} />`));
      const open = emit(sink, `<${node.tag}${attrs}${stamp}>`);
      const children = node.children.map((child) => serialize(sink, child, path, own)).join("");
      const close = emit(sink, `</${node.tag}>`);
      return record(sink, start, node, path, `${open}${children}${close}`);
    }
  }
};

/** Record an element's emitted range once its content is written. */
const record = (
  sink: Sink,
  start: number,
  node: EmailNode & { type: "Element" },
  instancePath: string,
  text: string,
): string => {
  sink.positions.push({
    start,
    end: sink.written,
    origins: node.origins,
    instancePath,
    tag: node.tag,
    authored: node.authored,
  });
  return text;
};

export interface EmailHtmlOutput {
  readonly html: string;
  readonly diagnostics: readonly EmailDiagnostic[];
  /**
   * Each emitted element's offset range and origins. A compatibility finding
   * carries a position in the emitted document, and this is what turns that
   * back into the authoring element the author can edit.
   */
  readonly positions: readonly EmittedPosition[];
}

/** How this document will be consumed. Delivery is the default; export is opt-in. */
export interface SerializeEmailOptions {
  /**
   * Accept relative references. A local export serves assets from a relative
   * base beside the file; a delivered message has no directory to resolve one
   * against, so this stays off for anything that will be sent.
   */
  readonly relativeUrls?: boolean | undefined;
  /**
   * Stamp every element with its instance path, so an editor preview can
   * resolve a click in the rendered document to exactly one rendered element.
   * A delivered message never carries it.
   */
  readonly instancePaths?: boolean | undefined;
  /** The brand plugin whose footer markers and unsubscribe link `BrandFooter` writes. */
  readonly brandPlugin?: BrandPlugin | undefined;
}

const serializationSink = (options: SerializeEmailOptions): Sink => {
  const brandPlugin = options.brandPlugin ?? samvaBrandPlugin;
  return {
    diagnostics: [],
    positions: [],
    written: 0,
    relativeUrls: options.relativeUrls === true,
    instancePaths: options.instancePaths === true,
    brandPlugin,
    reservedAttributes: reservedBrandAttributes(brandPlugin),
  };
};

/** Lower the derived tree to email HTML, reporting every unsupported construct with its origin. */
export const serializeEmailHtml = (
  node: EmailNode,
  options: SerializeEmailOptions = {},
): EmailHtmlOutput => {
  const sink = serializationSink(options);
  const html = serialize(sink, node, "", { next: 0 });
  return { html, diagnostics: sink.diagnostics, positions: sink.positions };
};

/** An authored style object as a declaration list, checked by the same rules as a serialized tree. */
export const serializeStyle = (
  style: Readonly<Record<string, unknown>>,
  origins: readonly JsxSourceLocation[],
): { readonly css: string; readonly diagnostics: readonly EmailDiagnostic[] } => {
  const sink = serializationSink({});
  const css = declarations(sink, style, origins);
  return { css, diagnostics: sink.diagnostics };
};

/**
 * Check one static attribute value against its element's spec, as serialization does. Returns
 * the text that would be emitted, or `undefined` when the attribute is dropped or invalid.
 */
export const checkAttribute = (
  tag: string,
  name: string,
  value: unknown,
  origins: readonly JsxSourceLocation[],
): { readonly text: string | undefined; readonly diagnostics: readonly EmailDiagnostic[] } => {
  const sink = serializationSink({});
  const element = emailElement(tag);
  const globals = EMAIL_GLOBAL_ATTRIBUTES as Readonly<Record<string, EmailAttributeSpec>>;
  const attributeSpec = (): EmailAttributeSpec | undefined => {
    if (/^(data|aria)-[a-z0-9-]+$/.test(name)) return { type: "string" };
    if (Object.hasOwn(globals, name)) return globals[name];
    if (element !== undefined && Object.hasOwn(element.attributes, name))
      return element.attributes[name];
    return undefined;
  };
  const spec = attributeSpec();
  if (spec === undefined) return { text: undefined, diagnostics: sink.diagnostics };
  const text = attributeValue(sink, tag, name, spec, value, origins);
  return { text, diagnostics: sink.diagnostics };
};
