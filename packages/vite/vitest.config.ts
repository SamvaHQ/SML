import { defineConfig } from "vitest/config";

// The package's own test config, so `vitest run` works from this directory with nothing from the
// repository root. The root run includes it as a project. Files run isolated because
// `editor-store.test.ts` mocks `node:fs/promises` before importing the store.
export default defineConfig({
  test: {
    name: "vite",
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/fixtures/**"],
    isolate: true,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
