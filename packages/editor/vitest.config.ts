import { defineConfig } from "vitest/config";

// The package's own test config, so `vitest run` works from this directory with nothing from the
// repository root. The root run includes it as a project. The package's own entries resolve to
// source through tsconfig `paths`; `@samva/markup` resolves to its built `dist`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "editor",
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./tests/setup.ts"],
    // Node exposes an unconfigured experimental `localStorage` that collides with happy-dom's.
    execArgv: ["--no-experimental-webstorage"],
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
