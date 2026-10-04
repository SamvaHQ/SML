// The bundler-agnostic compiler boundary.
//
// Everything a host needs to turn an authored TSX project into email output
// lives behind this module as plain functions with explicit inputs and outputs.
// It imports no Vite, no esbuild and no Node builtins, so the same functions run
// in a Vite plugin, in an esbuild plugin, and inside an isolated render worker.
//
// `@samva/vite` and Samva's hosted editor are adapters over this surface: they
// own module resolution, watching and transport, never compilation semantics. A
// host that reaches past this module for a transform is a host whose output can
// drift from the others.

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

export {
  compileSelector,
  parseStylesheet,
  type CssDeclaration,
  type CssRule,
  type Specificity,
  type Stylesheet,
} from "./email/css";

export {
  downlevelMediaQuery,
  finalizeValue,
  foldCalc,
  renderHeadCss,
  resolveVariables,
} from "./email/css-values";

export {
  classListOf,
  matchesSelector,
  type Ancestry,
  type CompiledSelector,
  type Compound,
} from "./email/selectors";

export { downlevelColors, formatColor, parseColor } from "./email/css-color";

export { applyStylesheet, type AppliedStyles } from "./email/cascade";

export {
  compileTailwind,
  discoverClassCandidates,
  TAILWIND_VERSION,
  type ClassDiscovery,
  type TailwindLimits,
  type TailwindOptions,
  type TailwindOutput,
} from "./email/tailwind";

export {
  projectBrandSpecifier,
  transformProject,
  type ProjectTransform,
  type TransformOptions,
} from "./email/transform";

export { parseBrandSpecifier } from "./email/brand-plugin";

export {
  renderBrandFooter,
  renderBrandSample,
  type RenderedBrandFooter,
} from "./email/brand-footer";

export * from "./static";
export { TEMPLATE_NAME_PATTERN, type EmailContent } from "./template";
