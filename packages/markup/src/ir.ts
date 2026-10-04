// The SML intermediate representation: what compiling a template produces, what a publication
// pins, what the editor and agents read, and what every send renders. It is JSON, versioned, and
// carries no code. Rendering it is a pure function of the IR and the input (see `./render-ir`).

import type { BrandPlugin } from "./email/brand-plugin";

/** The IR version this package writes. A publication pins the version it was built with. */
export const SML_IR_VERSION = 1;

/**
 * Where a node came from: `[line, column]` in the entry file, or `[line, column, file]` with an
 * index into `TemplateIr.sources` when the node came from an imported project file. Published
 * sends strip these.
 */
export type IrSource = readonly [line: number, column: number, file?: number];

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
export type IrValue =
  | string
  | number
  | boolean
  | null
  | { readonly bind: string }
  | { readonly lit: unknown }
  | { readonly concat: readonly IrValue[] }
  | { readonly format: IrFormatter; readonly args: readonly IrValue[] }
  | { readonly if: IrPredicate; readonly then: IrValue; readonly else: IrValue }
  | { readonly op: IrArithmetic; readonly args: readonly [IrValue, IrValue] }
  | { readonly length: IrValue }
  /** How many items of a bound array satisfy `where`, with each item bound as `$as` while it runs. */
  | { readonly count: IrValue; readonly as: string; readonly where: IrPredicate };

export type IrFormatter = "money" | "number" | "date" | "time" | "plural" | "list";

export type IrArithmetic = "+" | "-" | "*" | "/" | "%";

export type IrComparison = "eq" | "ne" | "lt" | "gt" | "le" | "ge";

/** A condition over the input. Truthiness follows JavaScript: `""`, `0`, `null` and absent are false. */
export type IrPredicate =
  /** The bound value at this path is truthy. */
  | { readonly present: string }
  /** Any value is truthy. */
  | { readonly truthy: IrValue }
  | { readonly not: IrPredicate }
  | { readonly and: readonly IrPredicate[] }
  | { readonly or: readonly IrPredicate[] }
  | { readonly cmp: IrComparison; readonly args: readonly [IrValue, IrValue] };

/**
 * An element's inline style. A string is fully static and was checked at compile time; a list
 * carries declarations whose values are read at render time; `if` selects between two styles.
 */
export type IrStyle =
  | string
  | readonly (readonly [property: string, value: IrValue])[]
  | { readonly if: IrPredicate; readonly then: IrStyle; readonly else: IrStyle };

/** A part of compatibility markup the primitives emit verbatim. */
export type IrRawPart = string | { readonly attr: IrValue } | { readonly text: IrValue };

export interface IrElement {
  readonly el: string;
  readonly attrs?: Readonly<Record<string, IrValue>>;
  readonly style?: IrStyle;
  readonly children?: readonly IrNode[];
  /**
   * Set by the compiler on the elements `BrandFooter` writes: only they may carry the reserved
   * footer markers, so an element the author wrote cannot claim a footer the send path would
   * then not append.
   */
  readonly reserved?: true;
  readonly src?: IrSource;
}

/** Content that appears when the predicate holds, or else `else`. */
export interface IrIf {
  readonly if: IrPredicate;
  readonly then: readonly IrNode[];
  readonly else?: readonly IrNode[];
  readonly src?: IrSource;
}

/**
 * Repeat `children` for each item of a bound array.
 *
 * `where` skips the items that fail a condition (`.filter(...)`), with the item bound as `$as`.
 * `chunk` groups the items into consecutive slices of that size instead: the loop variable `$as`
 * then holds one slice, an array, and the last slice may be shorter. Filtering applies first.
 */
export interface IrEach {
  readonly each: IrValue;
  /** The loop variable, referenced as `$as.field`. */
  readonly as: string;
  /** The zero-based index variable, referenced as `$index`. */
  readonly index?: string;
  readonly where?: IrPredicate;
  readonly chunk?: number;
  readonly children: readonly IrNode[];
  readonly src?: IrSource;
}

/**
 * Compatibility markup the email primitives emit verbatim (conditional comments, VML). Bound
 * parts are escaped for the context they sit in. `text` is what the plain-text part reads.
 */
export interface IrRaw {
  readonly raw: readonly IrRawPart[];
  readonly text?: IrValue;
  readonly src?: IrSource;
}

/** Where the hidden inbox-preview block goes; it renders the channel's `preheader`. */
export interface IrPreheader {
  readonly preheader: true;
}

/** A node in an email body. A bare value in child position is rendered as escaped text. */
export type IrNode = IrValue | IrElement | IrIf | IrEach | IrRaw | IrPreheader;

export interface IrEmail {
  readonly subject: IrValue;
  readonly preheader?: IrValue;
  readonly body: IrNode;
}

/** A plain-text channel body: text pieces, conditionals and loops. */
export interface IrSms {
  readonly category?: string;
  readonly body: readonly IrNode[];
}

export type IrWhatsAppButton =
  | { readonly type: "quick-reply"; readonly text: IrValue }
  | { readonly type: "url"; readonly text: IrValue; readonly url: IrValue }
  | { readonly type: "phone"; readonly text: IrValue; readonly phone: IrValue }
  | { readonly type: "copy-code"; readonly code: IrValue };

/** A button, or buttons that appear when a condition over the input holds. */
export type IrWhatsAppButtonNode =
  | IrWhatsAppButton
  | {
      readonly if: IrPredicate;
      readonly then: readonly IrWhatsAppButtonNode[];
      readonly else?: readonly IrWhatsAppButtonNode[];
      readonly src?: IrSource;
    };

export interface IrWhatsApp {
  readonly name?: string;
  readonly category: string;
  readonly language: string;
  /** For a media header, `content` is the media URL. */
  readonly header?: {
    readonly type: "text" | "image" | "video" | "document";
    readonly content: readonly IrNode[];
  };
  readonly body: readonly IrNode[];
  readonly footer?: readonly IrNode[];
  readonly buttons?: readonly IrWhatsAppButtonNode[];
}

export interface TemplateIr {
  readonly sml: typeof SML_IR_VERSION;
  readonly template: string;
  readonly locale?: string;
  /** Project paths that `IrSource` file indexes name; index 0 is the entry. */
  readonly sources?: readonly string[];
  readonly email?: IrEmail;
  readonly sms?: IrSms;
  readonly whatsapp?: IrWhatsApp;
  /** The portable JSON Schema every send's input is validated against. */
  readonly schema: Readonly<Record<string, unknown>>;
}

/** How the renderer resolves formatters that take no explicit locale or time zone. */
export interface RenderOptions {
  /** Overrides the template's `locale`. */
  readonly locale?: string;
  /** IANA time zone; defaults to UTC. */
  readonly timeZone?: string;
  /** Also return where each element landed in the HTML, for mapping findings back to source. */
  readonly positions?: boolean;
  /**
   * The brand plugin the template compiled against: its unsubscribe placeholder gets the
   * no-track marker, and only the elements `BrandFooter` wrote may carry its footer markers.
   * `samvaBrandPlugin` when omitted.
   */
  readonly brandPlugin?: BrandPlugin;
}

/** One rendered element's offset range in the HTML, and the source it was lowered from. */
export interface RenderedPosition {
  readonly start: number;
  readonly end: number;
  readonly tag: string;
  readonly src?: IrSource;
}

export interface RenderedIrEmail {
  readonly subject: string;
  readonly preheader: string | undefined;
  readonly html: string;
  readonly text: string;
  /** Present when the render asked for `positions`. */
  readonly positions?: readonly RenderedPosition[];
}

export type RenderedWhatsAppButton =
  | { readonly type: "quick-reply"; readonly text: string }
  | { readonly type: "url"; readonly text: string; readonly url: string }
  | { readonly type: "phone"; readonly text: string; readonly phone: string }
  | { readonly type: "copy-code"; readonly code: string };

/** A WhatsApp message with every text rendered and every conditional button resolved. */
export interface RenderedIrWhatsApp {
  readonly name?: string;
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
