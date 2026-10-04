import type { EmailContent } from "../template";
import { brandTailwindCss, parseBrandCss } from "../theme-css";
import {
  BRAND_COMPONENT_CLASSES,
  brandComponents,
  withoutUnsubscribeRow,
  type BrandComponents,
  type EmailBrand,
} from "./brand";
import type { BrandPlugin } from "./brand-plugin";
import { applyStylesheet } from "./cascade";
import { parseStylesheet } from "./css";
import { EmailCompileError } from "./diagnostics";
import { compileEmail, renderEmailContent, type RenderedEmail } from "./render";
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
  return brandTailwindCss(parsed.value);
};

/** A footer block for the send path to append, and its plain-text tail. */
export interface RenderedBrandFooter {
  readonly html: string;
  readonly text: string;
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
  if (node === null) return { html: "", text: "" };
  const styled = applyStylesheet(node, parseStylesheet(tailwind.css, { origin: plugin.specifier }));
  const compiled = compileEmail(styled.tree, { brandPlugin: plugin });
  const rendered = options.unsubscribe
    ? compiled
    : withoutUnsubscribeRow({ html: compiled.html, text: compiled.text }, plugin);
  const text = (rendered.text ?? "").trim();
  return { html: rendered.html ?? "", text: text === "" ? "" : `\n\n---\n${text}` };
};

/**
 * Render content against a brand as a project whose `theme.css` imports only
 * the brand renders it: Tailwind compiles the brand theme for
 * the classes the content names, `BrandLogo` and `BrandFooter` are bound to the
 * brand, and the render inlines the result. A brand preview renders through
 * this, so it shows what a template importing the brand compiles to.
 */
export const renderBrandSample = async (
  brand: EmailBrand,
  sample: {
    /** Every class the content names; nothing is discovered from source here. */
    readonly classes: readonly string[];
    readonly render: (components: BrandComponents) => EmailContent;
  },
  brandPlugin: BrandPlugin = samvaBrandPlugin,
): Promise<RenderedEmail> => {
  const tailwind = await compileTailwind(
    [...BRAND_COMPONENT_CLASSES, ...sample.classes],
    { css: `@import ${JSON.stringify(brandPlugin.specifier)};` },
    { stylesheets: new Map(), brandCss: brandTheme(brand, brandPlugin), brandPlugin },
  );
  const components = brandComponents(brand, brandPlugin);
  return renderEmailContent(
    parseStylesheet(tailwind.css, { origin: brandPlugin.specifier }),
    () => sample.render(components),
    { brandPlugin },
  );
};
