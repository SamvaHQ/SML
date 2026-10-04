import { defineConfig } from "tsdown";

// One entry per public `exports` subpath. Object form fixes the dist basename so
// the `exports` map can point at flat `./dist/<subpath>.js` regardless of whether
// the source lives under `src/`.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    email: "src/email.ts",
    "email/jsx-runtime": "src/email/jsx-runtime.ts",
    "email/jsx-dev-runtime": "src/email/jsx-dev-runtime.ts",
    fmt: "src/fmt.ts",
    sms: "src/sms.ts",
    whatsapp: "src/whatsapp.ts",
    "input-schema": "src/input-schema.ts",
    compiler: "src/compiler.ts",
    diagnostics: "src/diagnostics.ts",
    render: "src/render.ts",
    edit: "src/edit.ts",
    brand: "src/brand.ts",
  },
  format: ["esm"],
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  // Pure-TS compiler with no node builtins — runs identically in Worker/browser/CLI.
  // Neutral keeps the output browser-safe; the dashboard editor bundles these entries
  // into the browser, so node-specific output would be a regression.
  platform: "neutral",
  // Emit `.js` (not `.mjs`) so the package's `exports` map to plain `.js`; the
  // package is `type: module`, so `.js` is ESM.
  outExtensions: () => ({ js: ".js" }),
});
