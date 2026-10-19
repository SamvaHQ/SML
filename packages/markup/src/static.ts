// The static compiler: a project's files in, a template's IR out, nothing evaluated.
export { compileTemplate, type CompiledTemplate, type CompileTemplateOptions } from "./sml/compile";
export { checkStaticProfile, introducedProfileErrors } from "./sml/profile";
