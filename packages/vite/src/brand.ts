import type { BrandPlugin, EmailBrand } from "@samva/markup/brand";
import { projectBrandSpecifier } from "@samva/markup/compiler";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";

import type { ProjectFiles } from "./layout";

/** A host-resolved brand; a host may attach its content digest. */
export interface ResolvedBrand extends EmailBrand {
  readonly digest?: string | undefined;
}

/** A finding emitted by the host that resolves the brand. */
export interface BrandWarning {
  readonly code: string;
  readonly message: string;
}

export type BrandResolution =
  | {
      readonly ok: true;
      /** `undefined` when the project imports no brand. */
      readonly brand: ResolvedBrand | undefined;
      readonly source: string;
      readonly warnings: readonly BrandWarning[];
    }
  | { readonly ok: false; readonly message: string };

/** The host owns brand storage, authentication and resolution caching. */
export interface BrandResolver {
  readonly resolve: (
    files: ProjectFiles,
    themePath: string | undefined,
  ) => Promise<BrandResolution>;
}

/** Resolve only when a host supplies a resolver; brand imports otherwise fail loudly. */
export const resolveBrand = async (
  files: ProjectFiles,
  themePath: string | undefined,
  resolver: BrandResolver | undefined,
  plugin: BrandPlugin | undefined,
): Promise<BrandResolution> => {
  if (resolver !== undefined) return resolver.resolve(files, themePath);
  const specifier = projectBrandSpecifier(files, themePath ?? "", plugin);
  return specifier === undefined
    ? { ok: true, brand: undefined, source: "none", warnings: [] }
    : {
        ok: false,
        message: `The project imports ${specifier}, but no brandResolver is configured. Pass a brandResolver to the editor or project options.`,
      };
};

/** Host warnings stay warnings; unavailable brands are errors. */
export const brandDiagnostics = (resolution: BrandResolution): EmailDiagnostic[] =>
  resolution.ok
    ? resolution.warnings.map((warning) => ({
        code: warning.code,
        severity: "warning",
        message: warning.message,
        origins: [],
      }))
    : [{ code: "brand-unavailable", severity: "error", message: resolution.message, origins: [] }];
