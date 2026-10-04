import { defineConfig } from "tsdown";

// One entry per public `exports` subpath. Object form fixes the dist basename so the `exports` map
// points at flat `./dist/<subpath>.js`.
export default defineConfig({
  entry: {
    host: "src/host/types.ts",
    "host/effect": "src/host/effect.ts",
    shell: "src/shell.ts",
    channels: "src/channels.ts",
    mock: "src/mock.ts",
  },
  format: ["esm"],
  outDir: "dist",
  // Scope the declaration build to what the package publishes; see tsconfig.build.json.
  dts: { tsconfig: "tsconfig.build.json" },
  sourcemap: true,
  clean: true,
  // The editor runs in the browser; hosts bundle it.
  platform: "browser",
  // The stylesheet ships beside the entries. Its `@source` glob is relative to the file, so Tailwind
  // scans the built JavaScript in `dist` as it scans the TypeScript in `src`.
  copy: [{ from: "src/styles.css", to: "dist" }],
  // Emit `.js` (not `.mjs`) so the package's `exports` map to plain `.js`; the package is
  // `type: module`, so `.js` is ESM.
  outExtensions: () => ({ js: ".js" }),
});
