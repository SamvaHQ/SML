import { parseBrandCss, printBrandCss } from "../theme-css";
import {
  BRAND_COMPONENT_CLASSES,
  brandComponents,
  withoutUnsubscribeRow,
  type EmailBrand,
} from "./brand";
import type { BrandPlugin } from "./brand-plugin";
import { applyStylesheet, renderDarkRules } from "./cascade";
import { parseStylesheet } from "./css";
import { EmailCompileError } from "./diagnostics";
import { compileEmail } from "./render";
import { samvaBrandPlugin } from "./samva-brand-plugin";
import { compileTailwind } from "./tailwind";

/** The brand theme as Tailwind compiles it; a theme outside the grammar is a compile refusal. */
const brandTheme = (brand: EmailBrand, plugin: BrandPlugin): string => {
  const parsed = parseBrandCss(brand.css);
  if (parsed.isErr())
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- A brand theme outside the grammar is a compile refusal, thrown as every other one is.
    throw new EmailCompileError({
      diagnostics: parsed.error.map((finding) => ({
        code: finding.code,
        severity: "error",
        message: `${plugin.specifier}: ${finding.message}`,
        origins: [],
      })),
    });
  return printBrandCss(parsed.value);
};

/** A footer block for the send path to append, and its plain-text tail. */
export interface RenderedBrandFooter {
  readonly html: string;
  readonly text: string;
  /**
   * The rules the footer needs in the message's `<head>`: its dark-mode colors and the
   * `dark:` swap of the brand logo. Empty when it needs none.
   */
  readonly headCss: string;
}

/**
 * Render `BrandFooter` against a brand on its own, for the send path to
 * append to a message whose template renders no footer of its own. It
 * compiles the same component, styled by the same brand theme, a template
 * would get from its brand import. Without `unsubscribe` the unsubscribe row is
 * left out.
 */
export const renderBrandFooter = async (
  brand: EmailBrand,
  options: { readonly unsubscribe: boolean; readonly brandPlugin?: BrandPlugin | undefined },
): Promise<RenderedBrandFooter> => {
  const plugin = options.brandPlugin ?? samvaBrandPlugin;
  const tailwind = await compileTailwind(BRAND_COMPONENT_CLASSES, {
    css: brandTheme(brand, plugin),
  });
  const node = brandComponents(brand, plugin).BrandFooter({});
  if (node === null) return { html: "", text: "", headCss: "" };
  const styled = applyStylesheet(node, parseStylesheet(tailwind.css, { origin: plugin.specifier }));
  const compiled = compileEmail(styled.tree, { brandPlugin: plugin });
  const rendered = options.unsubscribe
    ? compiled
    : withoutUnsubscribeRow({ html: compiled.html, text: compiled.text }, plugin);
  const text = (rendered.text ?? "").trim();
  return {
    html: rendered.html ?? "",
    text: text === "" ? "" : `\n\n---\n${text}`,
    headCss: `${renderDarkRules(styled.darkRules)}${styled.headCss}`,
  };
};
