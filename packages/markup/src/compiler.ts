// The compiler entry: a template project's files in, a compiled template and its diagnostics out,
// plus the brand compiles a host stores or previews. It imports no Vite, esbuild, Node builtins or
// caniemail, so the same functions run in a Vite plugin, a Worker, the CLI and the browser.
//
// `@samva/vite` and Samva's hosted editor are adapters over this surface: they own module
// resolution, watching and transport, never compilation semantics.

export { compileTemplate, type CompiledTemplate, type CompileTemplateOptions } from "./sml/compile";
export { checkStaticProfile, introducedProfileErrors } from "./sml/profile";
export { renderBrandFooter, type RenderedBrandFooter } from "./email/brand-footer";
export { previewBrand, type BrandPreview } from "./email/brand-preview";
export { parseBrandSpecifier } from "./email/brand-plugin";
export { projectBrandSpecifier } from "./email/transform";
export type { TailwindOptions } from "./email/tailwind";
export { TEMPLATE_NAME_PATTERN } from "./template";
