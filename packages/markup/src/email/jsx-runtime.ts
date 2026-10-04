import { hasProperty } from "../internal/guards";
import {
  completeJsxSourceLocation,
  JSX_SOURCE_LOCATION_PROP,
  type JsxSource,
  type JsxSourceLocation,
} from "../source-locations";
import type { EmailDiagnostic } from "./diagnostics";
import type { EmailIntrinsicElements } from "./elements";

/** Derived authoring tree; source stays canonical. Origins run from inner element to component call sites. */
export type EmailNode =
  | { readonly type: "Text"; readonly value: string }
  | {
      readonly type: "Element";
      readonly tag: string;
      readonly props: Readonly<Record<string, unknown>>;
      readonly children: readonly EmailNode[];
      readonly origins: readonly JsxSourceLocation[];
      /**
       * True when this element is written at `origins[0]`; false when a compiler
       * primitive generated it and `origins[0]` is the call site that asked for
       * it. Both point at the same authoring target, but only an authored element
       * can have its own props edited there.
       */
      readonly authored: boolean;
    }
  | { readonly type: "Fragment"; readonly children: readonly EmailNode[] }
  /**
   * Compatibility markup a compiler primitive emits verbatim — conditional
   * comments and VML. Only the primitives in `./components` construct it;
   * nothing an author passes as a string reaches this node.
   */
  | {
      readonly type: "Raw";
      readonly html: string;
      readonly text: string;
      readonly origins: readonly JsxSourceLocation[];
    };

type EmailNodeOf<Type extends EmailNode["type"]> = Extract<EmailNode, { readonly type: Type }>;
type EmailNodeFields<Type extends EmailNode["type"]> = Omit<EmailNodeOf<Type>, "type">;

/** Constructors for the authoring tree. The tree is data; nothing here validates it. */
export const EmailNode = {
  Text: (fields: EmailNodeFields<"Text">): EmailNodeOf<"Text"> => ({ type: "Text", ...fields }),
  Element: (fields: EmailNodeFields<"Element">): EmailNodeOf<"Element"> => ({
    type: "Element",
    ...fields,
  }),
  Fragment: (fields: EmailNodeFields<"Fragment">): EmailNodeOf<"Fragment"> => ({
    type: "Fragment",
    ...fields,
  }),
  Raw: (fields: EmailNodeFields<"Raw">): EmailNodeOf<"Raw"> => ({ type: "Raw", ...fields }),
} as const;

const EMAIL_NODE_TYPES: ReadonlySet<string> = new Set<EmailNode["type"]>([
  "Text",
  "Element",
  "Fragment",
  "Raw",
]);

/** True for a node this runtime built; anything else is not a child it can place. */
const isEmailNode = (input: unknown): input is EmailNode =>
  hasProperty(input, "type") && typeof input.type === "string" && EMAIL_NODE_TYPES.has(input.type);
export type EmailChild =
  | EmailNode
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly EmailChild[];
export type EmailComponent<P = never> = (props: P) => EmailChild;
export const Fragment = Symbol.for("@samva/markup/email/Fragment");

// A component's generated wrappers must select the authoring element that asked
// for them, so the call site of every component currently on the stack is
// appended to each element built inside it. Rendering is synchronous, so a
// plain stack is the whole mechanism.
const callSites: JsxSourceLocation[] = [];

/** Call sites enclosing the element being built, innermost first. */
export const currentEmailOrigins = (): readonly JsxSourceLocation[] => [...callSites].reverse();

// Primitives report authoring problems they can see but cannot express in the
// tree (a Button without the size its classic-Outlook fallback needs). The sink
// is drained by `renderEmail` before and after each render, and the isolated
// host gives every render a fresh module graph besides.
const reported: EmailDiagnostic[] = [];

/** Record a finding from inside a compiler primitive, located at the authoring call site. */
export const reportEmailDiagnostic = (diagnostic: Omit<EmailDiagnostic, "origins">): void => {
  reported.push({ ...diagnostic, origins: currentEmailOrigins() });
};

/** Take and clear the findings primitives reported during a render. */
export const drainEmailDiagnostics = (): readonly EmailDiagnostic[] => reported.splice(0);

// oxlint-disable samva/no-try-catch-or-throw, samva/no-error-constructor -- Synchronous JSX authoring failures belong to the build/render caller.
/** Normalize actual values without interpolation or recording proxies. */
export const normalizeChildren = (input: unknown): EmailNode[] => {
  if (input === null || input === undefined || typeof input === "boolean") return [];
  if (typeof input === "string") return [EmailNode.Text({ value: input })];
  if (typeof input === "number" && Number.isFinite(input))
    return [EmailNode.Text({ value: String(input) })];
  if (Array.isArray(input)) return input.flatMap(normalizeChildren);
  if (isEmailNode(input)) return [input];
  throw new TypeError(
    "Email children must be synchronous text, finite numbers, elements, or arrays",
  );
};

/** Compatibility markup emitted by a compiler primitive, with the text it stands for. */
export const rawMarkup = (html: string, text = ""): EmailNode =>
  EmailNode.Raw({ html, text, origins: currentEmailOrigins() });

/** Automatic JSX factory for ordinary HTML and synchronous imported components. */
export const jsx = (
  type: string | EmailComponent<Record<string, unknown>> | typeof Fragment,
  props: Record<string, unknown> | null,
): EmailNode => {
  const { children, [JSX_SOURCE_LOCATION_PROP]: source, ...attributes } = props ?? {};
  const origin = completeJsxSourceLocation(source as JsxSource | undefined);
  if (type === Fragment) return EmailNode.Fragment({ children: normalizeChildren(children) });
  if (typeof type === "string")
    return EmailNode.Element({
      tag: type,
      props: attributes,
      children: normalizeChildren(children),
      origins: origin === undefined ? currentEmailOrigins() : [origin, ...currentEmailOrigins()],
      authored: origin !== undefined,
    });
  // Children were already built at the call site and keep their own origins;
  // only markup the component itself creates inherits this call site.
  if (origin !== undefined) callSites.push(origin);
  try {
    return EmailNode.Fragment({
      children: normalizeChildren(type({ ...attributes, children })),
    });
  } finally {
    if (origin !== undefined) callSites.pop();
  }
};
export const jsxs = jsx;
// oxlint-enable samva/no-try-catch-or-throw, samva/no-error-constructor

export namespace JSX {
  export type Element = EmailNode;
  export type ElementType = string | EmailComponent | typeof Fragment;
  export interface ElementChildrenAttribute {
    readonly children: object;
  }
  export interface IntrinsicAttributes {
    readonly key?: string | number | undefined;
  }
  export interface IntrinsicElements extends EmailIntrinsicElements {}
}
