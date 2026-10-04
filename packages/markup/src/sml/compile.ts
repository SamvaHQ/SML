import { assetUrl } from "../email/assets";
import { EmailCompileError } from "../email/diagnostics";
import { samvaBrandPlugin } from "../email/samva-brand-plugin";
import { transformProject, type TransformOptions } from "../email/transform";
import { Findings } from "./diagnostics";
import { completed, lowerProject, type CompiledTemplate } from "./lower-project";
import { loadProject } from "./project";

// `compileTemplate` is the static compiler: a project's files in, the template's IR out, with no
// module evaluated on the way. It is what the CLI, the editor, the agents and the publish step
// run, so a template means the same thing everywhere it is read.

export interface CompileTemplateOptions extends TransformOptions {
  /** The project's files by path. Binary files are addressed as assets. */
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  /** The entry: a `.tsx` file that default-exports `defineTemplate({ ... })`. */
  readonly entry: string;
  /**
   * The portable JSON Schema, for an entry whose `schema` is not a literal `jsonSchema(...)`
   * (a Zod or Effect schema needs a library to become JSON Schema). A host that has evaluated the
   * schema passes its conversion here; a literal schema is read from source and this is ignored.
   */
  readonly schema?: Readonly<Record<string, unknown>> | undefined;
}

export type { CompiledTemplate } from "./lower-project";

/** Compile a project's entry template to IR without evaluating any of it. */
export const compileTemplate = async (
  options: CompileTemplateOptions,
): Promise<CompiledTemplate> => {
  const findings = new Findings();
  const project = loadProject(options.files, options.entry, findings, {
    brandPlugin: options.brandPlugin ?? samvaBrandPlugin,
  });
  if (project === undefined) return completed(findings, undefined);

  let transformed: Awaited<ReturnType<typeof transformProject>>;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- The project transform refuses a theme or brand it cannot resolve with a typed error; its findings become this compile's.
  try {
    transformed = await transformProject(options.files, options);
  } catch (error) {
    if (!(error instanceof EmailCompileError)) throw error; // oxlint-disable-line samva/no-try-catch-or-throw -- Not a statement about the project.
    findings.items.push(...error.diagnostics);
    return completed(findings, undefined);
  }
  findings.items.push(
    ...transformed.diagnostics.filter((item) => item.code !== "tailwind-dynamic-class"),
  );
  const assetsByPath = new Map(transformed.assets.map((asset) => [asset.path, asset]));
  return lowerProject(options, project, findings, {
    assets: transformed.assets,
    stylesheets: transformed.stylesheets,
    tailwindSheet: transformed.tailwindSheet,
    urlFor: (path) => {
      const entry = assetsByPath.get(path);
      return entry === undefined ? undefined : assetUrl(entry, options.assetBase);
    },
  });
};
