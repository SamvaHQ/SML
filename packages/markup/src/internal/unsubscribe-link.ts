/**
 * Marks the one link the serializer lets carry the brand plugin's unsubscribe
 * placeholder as its href. Only `BrandFooter` sets it; nothing public exports
 * it, so no author-written link can claim the exemption.
 */
export const UNSUBSCRIBE_LINK: unique symbol = Symbol("samva.unsubscribe-link");

/**
 * Marks the elements `BrandFooter` writes the brand plugin's footer markers
 * on. The serializer emits those reserved attributes only for an element
 * carrying it, so an author cannot claim a footer the send path would then
 * not append.
 */
export const BRAND_FOOTER_MARKER: unique symbol = Symbol("samva.brand-footer-marker");
