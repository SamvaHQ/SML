import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  sortImports: {},
  sortTailwindcss: {},
  sortPackageJson: {},
  ignorePatterns: [
    // The JSON Schema 2020-12 dialect, vendored byte-for-byte so it stays diffable against
    // json-schema.org.
    "packages/markup/src/json-schema",
    // A starter's theme is exactly what a created project receives, and the starter manifest
    // digests it byte for byte; the formatter would split its empty `@theme {}`.
    "examples/email-starter/theme.css",
    // Test outputs, written byte-for-byte by the runner that compares them.
    "**/__snapshots__",
    "**/dist",
    "**/*.mdx",
  ],
});
