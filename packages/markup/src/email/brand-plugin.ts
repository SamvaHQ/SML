import { samvaBrandPlugin } from "./samva-brand-plugin";

/**
 * How a template reaches its brand and how the footer `BrandFooter` renders is
 * marked for the send path that delivers it. The compiler and the IR renderer
 * read every brand import, footer marker and unsubscribe link from the plugin
 * a build passes; `samvaBrandPlugin` is the default.
 */
export interface BrandPlugin {
  /**
   * The module and stylesheet specifier a template imports its brand from.
   * `<specifier>/<slug>` names one brand; the bare specifier names the default.
   */
  readonly specifier: string;
  /** Marks the block `BrandFooter` renders, so the send path finds a template's own footer. */
  readonly footerAttribute: `data-${string}`;
  /** Marks the footer row that carries the unsubscribe link, so a send can drop it. */
  readonly unsubscribeRowAttribute: `data-${string}`;
  /** The unsubscribe link's href; the send path substitutes each delivery's URL for it. */
  readonly unsubscribeUrlPlaceholder: string;
  /**
   * Written on the unsubscribe link, so the send path delivers it without
   * click tracking: a rewritten link would carry another recipient's token.
   */
  readonly noTrackAttribute: `data-${string}`;
}

export { samvaBrandPlugin };

const SLUG = "[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** `<specifier>` or `<specifier>/<slug>`, as a regular expression source with no groups. */
export const brandSpecifierPattern = (plugin: BrandPlugin): string =>
  `${escapeRegExp(plugin.specifier)}(?:\\/${SLUG})?`;

/** The brand a specifier names: `undefined` slug means the default brand; `undefined` when it names none. */
export const parseBrandSpecifier = (
  specifier: string,
  plugin: BrandPlugin = samvaBrandPlugin,
): { readonly slug: string | undefined } | undefined => {
  const match = new RegExp(`^${escapeRegExp(plugin.specifier)}(?:\\/(${SLUG}))?$`).exec(specifier);
  return match === null ? undefined : { slug: match[1] };
};

/** The attributes only `BrandFooter` writes; an authored element carrying one is refused. */
export const reservedBrandAttributes = (plugin: BrandPlugin): ReadonlySet<string> =>
  new Set([plugin.footerAttribute, plugin.unsubscribeRowAttribute, plugin.noTrackAttribute]);
