// The compatibility check: which email clients render a compiled template as written. It is its own
// entry because its rules engine, caniemail, reads Node's `process` when it loads; keeping it out of
// `./compiler` lets the compiler load in a browser.

export {
  checkEmailCompatibility,
  COMPATIBILITY_PROVENANCE,
  EMAIL_CLIENT_MATRIX,
  ESSENTIAL_CONSTRUCTS,
  hasBlockingCompatibility,
  unknownCoverage,
  type CompatibilityInput,
  type CompatibilityProvenance,
  type EmailClientTarget,
} from "./email/compatibility";
export { checkTemplateCompatibility } from "./sml/compatibility";
