import type { EmailChild } from "./jsx-runtime";

// The supported HTML subset for object email templates. One table is both the
// runtime allowlist the serializer validates against and the source the JSX
// intrinsic prop types are derived from, so widening the vocabulary is a single
// edit and the two can never disagree.

/** How one attribute is spelled and what values it accepts. */
export interface EmailAttributeSpec {
  /** `measure` accepts the pixel/percentage pair email HTML actually uses. */
  readonly type: "string" | "number" | "measure" | "url";
  readonly values?: readonly string[];
  readonly required?: true;
}

/** What an element is for. The serializer and the plain-text derivation both read this. */
export type EmailLayout =
  | "document"
  | "metadata"
  | "block"
  | "inline"
  | "preformatted"
  | "table"
  | "table-section"
  | "row"
  | "cell"
  | "list"
  | "list-item"
  | "break"
  | "rule"
  | "image"
  | "link";

export interface EmailElementSpec {
  /** `raw` is CSS text emitted verbatim; only the compiler produces it. */
  readonly content: "void" | "flow" | "text" | "raw";
  readonly layout: EmailLayout;
  readonly attributes: Readonly<Record<string, EmailAttributeSpec>>;
  /** When present, only these element tags may appear as children. */
  readonly childElements?: readonly string[];
}

/** Attributes every supported element accepts. `class`/`className`/`style` are handled separately. */
export const EMAIL_GLOBAL_ATTRIBUTES = {
  id: { type: "string" },
  title: { type: "string" },
  lang: { type: "string" },
  dir: { type: "string", values: ["ltr", "rtl", "auto"] },
  role: { type: "string" },
} as const satisfies Record<string, EmailAttributeSpec>;

const alignment = { type: "string", values: ["left", "center", "right"] } as const;
const verticalAlignment = { type: "string", values: ["top", "middle", "bottom"] } as const;
const flowAttributes = { align: alignment } as const;
const cellAttributes = {
  align: alignment,
  valign: verticalAlignment,
  width: { type: "measure" },
  height: { type: "measure" },
  bgcolor: { type: "string" },
  colspan: { type: "number" },
  rowspan: { type: "number" },
} as const;

// Generic so each entry keeps its literal attribute table; a widened
// `Record<string, EmailAttributeSpec>` would make every prop name legal.
const block = <A extends Readonly<Record<string, EmailAttributeSpec>>>(attributes: A) =>
  ({ content: "flow", layout: "block", attributes }) as const;
const inline = () => ({ content: "flow", layout: "inline", attributes: {} }) as const;

/** The complete supported vocabulary. Anything outside it is a compile error with a source location. */
export const EMAIL_ELEMENTS = {
  html: {
    content: "flow",
    layout: "document",
    // Namespace declarations classic Outlook needs for the VML and
    // OfficeDocumentSettings blocks the primitives emit.
    attributes: {
      xmlns: { type: "string" },
      "xmlns:o": { type: "string" },
      "xmlns:v": { type: "string" },
      "xmlns:w": { type: "string" },
    },
    childElements: ["head", "body"],
  },
  head: {
    content: "flow",
    layout: "metadata",
    attributes: {},
    childElements: ["title", "meta", "style"],
  },
  title: { content: "text", layout: "metadata", attributes: {} },
  style: { content: "raw", layout: "metadata", attributes: { type: { type: "string" } } },
  meta: {
    content: "void",
    layout: "metadata",
    attributes: {
      name: { type: "string" },
      content: { type: "string" },
      charset: { type: "string" },
      "http-equiv": { type: "string" },
    },
  },
  body: {
    content: "flow",
    layout: "block",
    attributes: { bgcolor: { type: "string" } },
  },

  div: block(flowAttributes),
  section: block(flowAttributes),
  article: block(flowAttributes),
  header: block(flowAttributes),
  footer: block(flowAttributes),
  main: block(flowAttributes),
  center: block({}),
  p: block(flowAttributes),
  blockquote: block(flowAttributes),
  pre: { content: "flow", layout: "preformatted", attributes: {} },

  h1: block(flowAttributes),
  h2: block(flowAttributes),
  h3: block(flowAttributes),
  h4: block(flowAttributes),
  h5: block(flowAttributes),
  h6: block(flowAttributes),

  span: inline(),
  strong: inline(),
  b: inline(),
  em: inline(),
  i: inline(),
  u: inline(),
  s: inline(),
  small: inline(),
  code: inline(),

  a: {
    content: "flow",
    layout: "link",
    attributes: {
      href: { type: "url", required: true },
      target: { type: "string" },
      rel: { type: "string" },
      name: { type: "string" },
    },
  },
  img: {
    content: "void",
    layout: "image",
    attributes: {
      src: { type: "url", required: true },
      alt: { type: "string", required: true },
      width: { type: "measure" },
      height: { type: "measure" },
      border: { type: "measure" },
      align: alignment,
    },
  },

  table: {
    content: "flow",
    layout: "table",
    attributes: {
      width: { type: "measure" },
      height: { type: "measure" },
      border: { type: "measure" },
      cellpadding: { type: "measure" },
      cellspacing: { type: "measure" },
      align: alignment,
      bgcolor: { type: "string" },
    },
    childElements: ["caption", "colgroup", "thead", "tbody", "tfoot", "tr"],
  },
  caption: { content: "flow", layout: "block", attributes: flowAttributes },
  colgroup: {
    content: "flow",
    layout: "table-section",
    attributes: { span: { type: "number" }, width: { type: "measure" } },
    childElements: ["col"],
  },
  col: {
    content: "void",
    layout: "table-section",
    attributes: { span: { type: "number" }, width: { type: "measure" } },
  },
  thead: {
    content: "flow",
    layout: "table-section",
    attributes: { align: alignment, valign: verticalAlignment, bgcolor: { type: "string" } },
    childElements: ["tr"],
  },
  tbody: {
    content: "flow",
    layout: "table-section",
    attributes: { align: alignment, valign: verticalAlignment, bgcolor: { type: "string" } },
    childElements: ["tr"],
  },
  tfoot: {
    content: "flow",
    layout: "table-section",
    attributes: { align: alignment, valign: verticalAlignment, bgcolor: { type: "string" } },
    childElements: ["tr"],
  },
  tr: {
    content: "flow",
    layout: "row",
    attributes: {
      align: alignment,
      valign: verticalAlignment,
      bgcolor: { type: "string" },
      height: { type: "measure" },
    },
    childElements: ["td", "th"],
  },
  td: { content: "flow", layout: "cell", attributes: cellAttributes },
  th: { content: "flow", layout: "cell", attributes: cellAttributes },

  ul: { content: "flow", layout: "list", attributes: {}, childElements: ["li"] },
  ol: {
    content: "flow",
    layout: "list",
    attributes: { start: { type: "number" }, type: { type: "string" } },
    childElements: ["li"],
  },
  li: { content: "flow", layout: "list-item", attributes: {} },

  br: { content: "void", layout: "break", attributes: {} },
  hr: {
    content: "void",
    layout: "rule",
    attributes: { width: { type: "measure" }, size: { type: "number" }, align: alignment },
  },
} as const satisfies Record<string, EmailElementSpec>;

export type EmailTag = keyof typeof EMAIL_ELEMENTS;

/** Attributes that must carry a URL; these are checked against the safe-scheme rule. */
export const isUrlAttribute = (tag: string, attribute: string): boolean => {
  const spec = (EMAIL_ELEMENTS as Readonly<Record<string, EmailElementSpec>>)[tag];
  return spec?.attributes[attribute]?.type === "url";
};

/** Look up one supported element, or `undefined` when the tag is outside the vocabulary. */
export const emailElement = (tag: string): EmailElementSpec | undefined =>
  Object.hasOwn(EMAIL_ELEMENTS, tag)
    ? (EMAIL_ELEMENTS as Readonly<Record<string, EmailElementSpec>>)[tag]
    : undefined;

// ── Type-level prop derivation ────────────────────────────────────────────────

/** A declaration block. Values are CSS text; numbers are emitted verbatim. */
export interface EmailStyle {
  readonly [property: string]: string | number | undefined;
}

type AttributeType<Spec extends EmailAttributeSpec> = Spec extends {
  readonly values: readonly string[];
}
  ? Spec["values"][number]
  : Spec["type"] extends "number"
    ? number
    : Spec["type"] extends "measure"
      ? number | string
      : string;

type AttributeProps<Attributes extends Readonly<Record<string, EmailAttributeSpec>>> = {
  readonly [
    K in keyof Attributes as Attributes[K] extends { readonly required: true } ? K : never
  ]: AttributeType<Attributes[K]>;
} & {
  readonly [
    K in keyof Attributes as Attributes[K] extends { readonly required: true } ? never : K
  ]?: AttributeType<Attributes[K]> | undefined;
};

/** Attributes accepted on every element, including the open `data-`/`aria-` families. */
export interface EmailGlobalProps {
  readonly key?: string | number | undefined;
  readonly class?: string | undefined;
  readonly className?: string | undefined;
  readonly style?: EmailStyle | undefined;
  readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
  readonly [attribute: `aria-${string}`]: string | number | boolean | undefined;
}

type ChildrenProp<Content extends EmailElementSpec["content"]> = Content extends "void"
  ? Record<never, never>
  : Content extends "text" | "raw"
    ? { readonly children?: string | number | undefined }
    : { readonly children?: EmailChild };

/** Props each supported tag accepts, derived from `EMAIL_ELEMENTS`. */
export type EmailIntrinsicElements = {
  readonly [Tag in EmailTag]: EmailGlobalProps &
    AttributeProps<typeof EMAIL_GLOBAL_ATTRIBUTES> &
    AttributeProps<(typeof EMAIL_ELEMENTS)[Tag]["attributes"]> &
    ChildrenProp<(typeof EMAIL_ELEMENTS)[Tag]["content"]>;
};
