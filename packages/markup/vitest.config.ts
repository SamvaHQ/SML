import { defineConfig } from "vitest/config";

// The package's own test config, so `vitest run` works from this directory with nothing from the
// repository root. The root run includes it as a project.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "markup",
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/consumer/**"],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
