import type {
  CompiledNode,
  CompiledRawPart,
  CompiledSource,
  CompiledStyle,
  CompiledValue,
} from "../compiled-template";
import type { EmailBrand } from "../email/brand";
import type { BrandPlugin } from "../email/brand-plugin";
import type { SemanticComponentName } from "./degradations";

export type { SemanticComponentName } from "./degradations";

/** An authored component prop: values retain bindings, and object props retain their fields. */
export type SemanticProp =
  | CompiledValue
  | { readonly object: Readonly<Record<string, SemanticProp>> };

/** A component's identity and authored content, before any target introduces layout markup. */
export interface SemanticComponent {
  readonly type: "component";
  readonly name: SemanticComponentName;
  readonly props?: Readonly<Record<string, SemanticProp>>;
  readonly children?: readonly CompiledNode[];
  /** Resolved brand data, without its stylesheet, for brand components only. */
  readonly brand?: Omit<EmailBrand, "css">;
  readonly src?: CompiledSource;
}

interface SemanticIntrinsicBase {
  readonly tag: string;
  readonly attrs?: Readonly<Record<string, CompiledValue>>;
  readonly style?: CompiledStyle;
  readonly children?: readonly CompiledNode[];
  readonly src?: CompiledSource;
}

export interface SemanticBlock extends SemanticIntrinsicBase {
  readonly type: "block";
}

export interface SemanticInline extends SemanticIntrinsicBase {
  readonly type: "inline";
}

/** The original tag retains the meaning of headings, lists, links, images and table cells. */
export type SemanticIntrinsic = SemanticBlock | SemanticInline;

/** Only presentation that differs from the primitives' deterministic expansion is recorded. */
export interface EmailPresentationOverride {
  readonly attrs?: Readonly<Record<string, CompiledValue>>;
  /** Empty means the cascade removed the primitive's authored declarations. */
  readonly style?: CompiledStyle;
  /** VML/conditional-comment markup after stylesheet token resolution. */
  readonly raw?: readonly CompiledRawPart[];
}

export interface EmailPresentation {
  /** Preorder ordinals of email elements and raw compatibility nodes, before head additions. */
  readonly nodes: Readonly<Record<string, EmailPresentationOverride>>;
  readonly headCss: string;
  readonly fontFaceCss: string;
  readonly brandPlugin: BrandPlugin;
}

export const isStaticScalar = (value: CompiledValue): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** Structural discrimination of this package's IR, shared by compilation and target lowering. */
// oxlint-disable samva/no-hand-rolled-object-guard -- This discriminates internal IR, rather than validating external input.
export const isValueNode = (node: CompiledNode): node is CompiledValue => {
  if (typeof node !== "object" || node === null) return true;
  if ("type" in node || "el" in node || "each" in node || "raw" in node || "preheader" in node)
    return false;
  if ("if" in node && Array.isArray(node.then)) return false;
  return true;
};
