// The brand entry: brand records, the brand plugin, the brand CSS (`theme.css`) model, footer
// markers, and content-addressed project assets. Compiling a brand footer or preview runs Tailwind,
// so both live behind `./compiler`.
export * from "./email/brand";
export { samvaBrandPlugin, type BrandPlugin } from "./email/brand-plugin";
export * from "./email/assets";
export * from "./theme-css";
