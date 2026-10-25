// The compatibility check: which email clients render a compiled template as written. It is its own
// entry because its rules engine, caniemail, reads Node's `process` when it loads; keeping it out of
// `./compiler` lets the compiler load in a browser.

export {
  checkHtmlCompatibility,
  COMPATIBILITY_PROVENANCE,
  EMAIL_CLIENT_MATRIX,
  ESSENTIAL_CONSTRUCTS,
  hasBlockingCompatibility,
  unknownCoverage,
  type CompatibilityInput,
  type CompatibilityProvenance,
  type EmailClientTarget,
} from "./email/compatibility";
export { checkCompatibility } from "./sml/compatibility";
export {
  COMPONENT_DEGRADATIONS,
  componentDegradation,
  type EmailDegradation,
  type SemanticComponentName,
} from "./ir/degradations";
