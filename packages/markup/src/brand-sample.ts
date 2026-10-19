// The brand sample entry: `renderBrandSample` compiles a sample email against a brand theme, for a
// live preview of an unsaved brand in the browser. It loads Tailwind, Babel and css-tree but not
// caniemail, whose glob dependency reads Node's `process` when it loads.
export { renderBrandSample } from "./email/brand-footer";
export type { RenderedEmail } from "./email/render";
export type { EmailContent } from "./template";
