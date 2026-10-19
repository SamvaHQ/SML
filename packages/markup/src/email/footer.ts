import { parseBrandCss, printBrandCss } from "../theme-css";
import { BRAND_COMPONENT_CLASSES, brandComponents, type EmailBrand } from "./brand";
import type { BrandPlugin } from "./brand-plugin";
import { applyStylesheet, renderDarkRules } from "./cascade";
import { parseStylesheet } from "./css";
import { hasBlockingDiagnostic, type EmailDiagnostic } from "./diagnostics";
import { lowerEmail } from "./render";
import { samvaBrandPlugin } from "./samva-brand-plugin";
import { compileTailwind } from "./tailwind";

/** A footer block for the send path to append, and its plain-text tail. */
export interface CompiledFooter {
  readonly html: string;
  readonly text: string;
  /**
   * The rules the footer needs in the message's `<head>`: its dark-mode colors and the
   * `dark:` swap of the brand logo. Empty when it needs none.
   */
  readonly headCss: string;
}

export interface FooterCompile {
  /** The footer, or `undefined` when a finding blocks it. */
  readonly footer: CompiledFooter | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
}

const EMPTY_FOOTER: CompiledFooter = { html: "", text: "", headCss: "" };

/**
 * Compile `BrandFooter` against a brand on its own, for the send path to append to a message
 * whose template renders no footer of its own. It compiles the same component, styled by the same
 * brand theme, a template would get from its brand import. The footer always carries the
 * unsubscribe row; the send drops it with `withoutUnsubscribeRow` from `./brand` where the message
 * has none. A brand theme outside the grammar leaves no footer and comes back as diagnostics.
 */
export const compileFooter = async (
  brand: EmailBrand,
  options: { readonly brandPlugin?: BrandPlugin | undefined } = {},
): Promise<FooterCompile> => {
  const plugin = options.brandPlugin ?? samvaBrandPlugin;
  const theme = parseBrandCss(brand.css);
  if (theme.isErr())
    return {
      footer: undefined,
      diagnostics: theme.error.map((finding) => ({
        code: finding.code,
        severity: "error",
        message: `${plugin.specifier}: ${finding.message}`,
        origins: [],
      })),
    };
  const tailwind = await compileTailwind(BRAND_COMPONENT_CLASSES, {
    css: printBrandCss(theme.value),
  });
  const node = brandComponents(brand, plugin).BrandFooter({});
  if (node === null) return { footer: EMPTY_FOOTER, diagnostics: [] };
  const styled = applyStylesheet(node, parseStylesheet(tailwind.css, { origin: plugin.specifier }));
  const lowered = lowerEmail(styled.tree, { brandPlugin: plugin });
  const diagnostics = [...styled.diagnostics, ...lowered.diagnostics];
  if (lowered.output === undefined || hasBlockingDiagnostic(diagnostics))
    return { footer: undefined, diagnostics };
  const text = lowered.output.text.trim();
  return {
    footer: {
      html: lowered.output.html,
      text: text === "" ? "" : `\n\n---\n${text}`,
      headCss: `${renderDarkRules(styled.darkRules)}${styled.headCss}`,
    },
    diagnostics,
  };
};
