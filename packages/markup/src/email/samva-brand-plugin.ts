import type { BrandPlugin } from "./brand-plugin";

/**
 * Samva's brand plugin, the compiler's default. A template imports its
 * organization's brand from `samva:brand`, and Samva's send path fills
 * `%samva:unsubscribe-url%` per delivery and turns `data-samva-no-track` into
 * its email provider's own no-track marker.
 */
export const samvaBrandPlugin: BrandPlugin = {
  specifier: "samva:brand",
  footerAttribute: "data-samva-footer",
  unsubscribeRowAttribute: "data-samva-unsubscribe",
  unsubscribeUrlPlaceholder: "%samva:unsubscribe-url%",
  noTrackAttribute: "data-samva-no-track",
};
