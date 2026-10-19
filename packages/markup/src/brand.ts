// The brand entry: brand records, the brand plugin, the brand CSS (`theme.css`) model, footer
// markers, and content-addressed project assets. Rendering a brand footer or sample compiles
// Tailwind, so the footer lives behind `./compiler` and the sample behind `./brand-sample`.
export * from "./email/brand";
export { samvaBrandPlugin, type BrandPlugin } from "./email/brand-plugin";
export * from "./email/assets";
export * from "./theme-css";
