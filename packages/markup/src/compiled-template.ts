// The compiled template: what compiling a template produces, what a publication pins, what the
// editor and agents read, and what every send renders. It is JSON, versioned, and carries no code.
// Rendering it is a pure function of the template and the input (see `./render-template`).

import type {
  EmailPresentation,
  SemanticComponent,
  SemanticIntrinsic,
  WebPresentation,
} from "./ir/nodes";
import type { SmsSegmentInfo } from "./sms-segments";

/** The version this package writes. A publication pins the version it was built with. */
export const COMPILED_TEMPLATE_VERSION = 2;

/**
 * Where a node came from: `[line, column]` in the entry file, or `[line, column, file]` with an
 * index into `CompiledTemplate.sources` when the node came from an imported project file. Published
 * sends strip these.
 */
export type CompiledSource = readonly [line: number, column: number, file?: number];

/**
 * A value read at render time.
 *
 * - a string, number, boolean or `null` is a literal;
 * - `bind` reads the input: `"order.id"` is a path from the input root, `"$item.title"` a path
 *   from the enclosing `each` variable named `item` (the `$` prefix keeps loop variables from
 *   colliding with input fields);
 * - `lit` is a literal object or array, for formatter options;
 * - `concat` joins the text of its parts (a template string);
 * - `format` calls one formatter from `@samva/markup/fmt`;
 * - `if` selects between two values (a conditional attribute or class);
 * - `op` is arithmetic, allowed inside formatter arguments and conditions;
 * - `length` is `.length` of a bound array or string;
 * - `count` is `.filter(...).length`: the items of an array that satisfy a condition.
 */
export type CompiledValue =
  | string
  | number
  | boolean
  | null
  | { readonly bind: string }
  | { readonly lit: unknown }
  | { readonly concat: readonly CompiledValue[] }
  | { readonly format: CompiledFormatter; readonly args: readonly CompiledValue[] }
  | { readonly if: CompiledPredicate; readonly then: CompiledValue; readonly else: CompiledValue }
  | { readonly op: CompiledArithmetic; readonly args: readonly [CompiledValue, CompiledValue] }
  | { readonly length: CompiledValue }
  /** How many items of a bound array satisfy `where`, with each item bound as `$as` while it runs. */
  | { readonly count: CompiledValue; readonly as: string; readonly where: CompiledPredicate };

export type CompiledFormatter = "money" | "number" | "date" | "time" | "plural" | "list";

export type CompiledArithmetic = "+" | "-" | "*" | "/" | "%";

export type CompiledComparison = "eq" | "ne" | "lt" | "gt" | "le" | "ge";

/** A condition over the input. Truthiness follows JavaScript: `""`, `0`, `null` and absent are false. */
export type CompiledPredicate =
  /** The bound value at this path is truthy. */
  | { readonly present: string }
  /** Any value is truthy. */
  | { readonly truthy: CompiledValue }
  | { readonly not: CompiledPredicate }
  | { readonly and: readonly CompiledPredicate[] }
  | { readonly or: readonly CompiledPredicate[] }
  | { readonly cmp: CompiledComparison; readonly args: readonly [CompiledValue, CompiledValue] };

/**
 * An element's inline style. A string is fully static and was checked at compile time; a list
 * carries declarations whose values are read at render time; `if` selects between two styles.
 */
export type CompiledStyle =
  | string
  | readonly (readonly [property: string, value: CompiledValue])[]
  | { readonly if: CompiledPredicate; readonly then: CompiledStyle; readonly else: CompiledStyle };

/** A part of compatibility markup the primitives emit verbatim. */
export type CompiledRawPart =
  | string
  | { readonly attr: CompiledValue }
  | { readonly text: CompiledValue };

export interface CompiledElement {
  readonly el: string;
  readonly attrs?: Readonly<Record<string, CompiledValue>>;
  readonly style?: CompiledStyle;
  readonly children?: readonly CompiledNode[];
  /**
   * Set by the compiler on the elements `BrandFooter` writes: only they may carry the reserved
   * footer markers, so an element the author wrote cannot claim a footer the send path would
   * then not append.
   */
  readonly reserved?: true;
  readonly src?: CompiledSource;
}

/** Content that appears when the predicate holds, or else `else`. */
export interface CompiledIf {
  readonly if: CompiledPredicate;
  readonly then: readonly CompiledNode[];
  readonly else?: readonly CompiledNode[];
  readonly src?: CompiledSource;
}

/**
 * Repeat `children` for each item of a bound array.
 *
 * `where` skips the items that fail a condition (`.filter(...)`), with the item bound as `$as`.
 * `chunk` groups the items into consecutive slices of that size instead: the loop variable `$as`
 * then holds one slice, an array, and the last slice may be shorter. Filtering applies first.
 */
export interface CompiledEach {
  readonly each: CompiledValue;
  /** The loop variable, referenced as `$as.field`. */
  readonly as: string;
  /** The zero-based index variable, referenced as `$index`. */
  readonly index?: string;
  readonly where?: CompiledPredicate;
  readonly chunk?: number;
  readonly children: readonly CompiledNode[];
  readonly src?: CompiledSource;
}

/**
 * Compatibility markup the email primitives emit verbatim (conditional comments, VML). Bound
 * parts are escaped for the context they sit in. `text` is what the plain-text part reads.
 */
export interface CompiledRaw {
  readonly raw: readonly CompiledRawPart[];
  readonly text?: CompiledValue;
  readonly src?: CompiledSource;
}

/** Where the hidden inbox-preview block goes; it renders the channel's `preheader`. */
export interface CompiledPreheader {
  readonly preheader: true;
}

/** A semantic body node or an email primitive produced by target lowering. Bare values are escaped text. */
export type CompiledNode =
  | CompiledValue
  | CompiledElement
  | CompiledIf
  | CompiledEach
  | CompiledRaw
  | CompiledPreheader
  | SemanticComponent
  | SemanticIntrinsic;

export interface CompiledEmail {
  readonly subject: CompiledValue;
  readonly preheader?: CompiledValue;
  readonly body: CompiledNode;
  /** Resolved email presentation, indexed by deterministic lowering order; contains no body. */
  readonly presentation?: EmailPresentation;
  /** Project CSS for the web target; email's resolved cascade is independent. */
  readonly web?: WebPresentation;
}

/** A plain-text channel body: text pieces, conditionals and loops. */
export interface CompiledSms {
  readonly category?: string;
  readonly body: readonly CompiledNode[];
}

export type CompiledWhatsAppButton =
  | { readonly type: "quick-reply"; readonly text: CompiledValue }
  | { readonly type: "url"; readonly text: CompiledValue; readonly url: CompiledValue }
  | { readonly type: "phone"; readonly text: CompiledValue; readonly phone: CompiledValue }
  | { readonly type: "copy-code"; readonly code: CompiledValue }
  | {
      readonly type: "flow";
      readonly text: CompiledValue;
      /** The Samva flow handle, resolved to Meta's flow id when the template is registered. */
      readonly flow: string;
      readonly action: "navigate" | "data_exchange";
      /** Meta's `navigate_screen`; absent opens the flow's first entry screen. */
      readonly screen?: string;
    };

/** A button, or buttons that appear when a condition over the input holds. */
export type CompiledWhatsAppButtonNode =
  | CompiledWhatsAppButton
  | {
      readonly if: CompiledPredicate;
      readonly then: readonly CompiledWhatsAppButtonNode[];
      readonly else?: readonly CompiledWhatsAppButtonNode[];
      readonly src?: CompiledSource;
    };

export interface CompiledWhatsApp {
  readonly category: string;
  readonly language: string;
  /** For a media header, `content` is the media URL. */
  readonly header?: {
    readonly type: "text" | "image" | "video" | "document";
    readonly content: readonly CompiledNode[];
  };
  readonly body: readonly CompiledNode[];
  readonly footer?: readonly CompiledNode[];
  readonly buttons?: readonly CompiledWhatsAppButtonNode[];
}

export interface CompiledTemplate {
  readonly sml: typeof COMPILED_TEMPLATE_VERSION;
  readonly template: string;
  readonly locale?: string;
  /** Project paths that `CompiledSource` file indexes name; index 0 is the entry. */
  readonly sources?: readonly string[];
  readonly email?: CompiledEmail;
  readonly sms?: CompiledSms;
  readonly whatsapp?: CompiledWhatsApp;
  /** The portable JSON Schema every send's input is validated against. */
  readonly schema: Readonly<Record<string, unknown>>;
}

/** The channels a template can declare. */
export type Channel = "email" | "sms" | "whatsapp";

/** Email and web lower the same body; plain-message targets keep their authored channels. */
export type Target = Channel | "web";

/** An element's offsets in rendered HTML and its authored source reference. */
export interface RenderedPosition {
  readonly start: number;
  readonly end: number;
  readonly tag: string;
  readonly src?: CompiledSource;
}

/** Values for a host-owned page shell. Styles are CSS text, never HTML. */
export interface PageHeadHints {
  readonly title?: string;
  readonly lang?: string;
  readonly dir?: "ltr" | "rtl" | "auto";
  readonly styles: string;
}

/** A semantic body fragment, with shell hints and offsets for source selection. */
export interface RenderedPage {
  readonly html: string;
  readonly headHints: PageHeadHints;
  readonly positions: readonly RenderedPosition[];
}

export interface RenderedEmail {
  readonly subject: string;
  readonly preheader: string | undefined;
  readonly html: string;
  readonly text: string;
}

/** An SMS message: its text and what it costs in segments. */
export interface RenderedSms {
  readonly text: string;
  readonly segments: SmsSegmentInfo;
}

export type RenderedWhatsAppButton =
  | { readonly type: "quick-reply"; readonly text: string }
  | { readonly type: "url"; readonly text: string; readonly url: string }
  | { readonly type: "phone"; readonly text: string; readonly phone: string }
  | { readonly type: "copy-code"; readonly code: string }
  | {
      readonly type: "flow";
      readonly text: string;
      readonly flow: string;
      readonly action: "navigate" | "data_exchange";
      readonly screen?: string;
    };

/** A WhatsApp message with every text rendered and every conditional button resolved. */
export interface RenderedWhatsApp {
  readonly language: string;
  readonly category: string;
  /** For a media header, `text` is the media URL. */
  readonly header?: {
    readonly type: "text" | "image" | "video" | "document";
    readonly text: string;
  };
  readonly body: string;
  readonly footer?: string;
  readonly buttons: readonly RenderedWhatsAppButton[];
}

/** What `render` returns for each target. */
export interface RenderedMessage {
  readonly email: RenderedEmail;
  readonly web: RenderedPage;
  readonly sms: RenderedSms;
  readonly whatsapp: RenderedWhatsApp;
}
