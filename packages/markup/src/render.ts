// The render entry: the compiled template and the one function that turns it into a message. It
// imports none of the compiler's libraries (Tailwind, css-tree, caniemail, Babel), so a send path
// that renders compiled templates stays small; `tests/entry-closure.test.ts` pins that.
export { render, RenderError, type RenderDiagnostic } from "./render-template";
export {
  COMPILED_TEMPLATE_VERSION,
  type Channel,
  type CompiledArithmetic,
  type CompiledComparison,
  type CompiledEach,
  type CompiledElement,
  type CompiledEmail,
  type CompiledFormatter,
  type CompiledIf,
  type CompiledNode,
  type CompiledPredicate,
  type CompiledPreheader,
  type CompiledRaw,
  type CompiledRawPart,
  type CompiledSms,
  type CompiledSource,
  type CompiledStyle,
  type CompiledTemplate,
  type CompiledValue,
  type CompiledWhatsApp,
  type CompiledWhatsAppButton,
  type CompiledWhatsAppButtonNode,
  type RenderedEmail,
  type RenderedMessage,
  type RenderedSms,
  type RenderedWhatsApp,
  type RenderedWhatsAppButton,
} from "./compiled-template";
export { escapeAttribute, escapeText } from "./email/html";
export {
  EMAIL_ELEMENTS,
  EMAIL_GLOBAL_ATTRIBUTES,
  emailElement,
  isUrlAttribute,
  type EmailAttributeSpec,
  type EmailElementSpec,
  type EmailGlobalProps,
  type EmailIntrinsicElements,
  type EmailLayout,
  type EmailStyle,
  type EmailTag,
} from "./email/elements";
export { smsSegmentInfo, type SmsEncoding, type SmsSegmentInfo } from "./sms-segments";

export type {
  SemanticComponentName,
  SemanticComponent,
  SemanticProp,
  SemanticBlock,
  SemanticInline,
  SemanticIntrinsic,
  EmailPresentation,
  EmailPresentationOverride,
} from "./ir/nodes";
