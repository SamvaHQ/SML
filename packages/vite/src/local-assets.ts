// A local page points its images at a path (the dev server's asset route, or a
// relative directory beside an export), but the IR renderer refuses everything
// except absolute https URLs, because a delivered message can resolve nothing
// else. A local render therefore compiles against a placeholder https origin
// and swaps that origin for the real base in the rendered output.
//
// The placeholder is as long as the base it stands for. An editor preview maps
// each element to its offsets in the rendered HTML, so the swap must not move
// any of them.

const HTTPS = /^https:\/\//i;

/** True when the renderer accepts `base` as it is: a delivered message can resolve it. */
export const isDeliverableBase = (base: string): boolean => HTTPS.test(base);

/** An https origin exactly as long as `base`, unique enough not to occur in authored content. */
const placeholderBase = (base: string): string =>
  `https://${"~".repeat(Math.max(1, base.length - "https://".length))}`;

/** The placeholder to compile with for `base`, or `base` itself when it can be delivered. */
export const compileBase = (base: string | undefined): string | undefined =>
  base === undefined || isDeliverableBase(base) ? base : placeholderBase(base);

/** Swap the placeholder for `base` in rendered output. */
export const restoreBase = (output: string, base: string | undefined): string =>
  base === undefined || isDeliverableBase(base)
    ? output
    : output.replaceAll(placeholderBase(base), base);
