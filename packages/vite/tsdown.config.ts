import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/build.ts", "src/project.ts", "src/dev.ts", "src/render.ts"],
  format: ["esm"],
  outDir: "dist",
  // Scope the declaration build to what the package publishes; see tsconfig.build.json.
  dts: { tsconfig: "tsconfig.build.json" },
  sourcemap: false,
  clean: true,
  platform: "node",
  // Emit `.js` (not `.mjs`) so the package's `exports` map to plain `.js`; the
  // package is `type: module`, so `.js` is ESM.
  outExtensions: () => ({ js: ".js" }),
});
