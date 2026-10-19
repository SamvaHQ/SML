import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone dev app for the editor shell — NOT a workspace member. @samva/editor/*
// is aliased to source so shell/canvas edits hot-reload; @samva/markup/* resolves to
// its built dist through the normal package exports.
const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

const PATH_SHIM = "\0browser-path-shim";

/**
 * Two Node reads in caniemail's closure, shimmed in the dependency pre-bundle: its data module
 * calls `createRequire`, so it loads a plain JSON import instead, and its glob matcher reads
 * `path.sep`, which a POSIX separator answers.
 */
const caniemailBrowserShims = {
  name: "caniemail-browser-shims",
  resolveId(id: string) {
    return id === "path" ? PATH_SHIM : null;
  },
  load(id: string) {
    if (id === PATH_SHIM) return 'export const sep = "/";\nexport default { sep };\n';
    if (!id.replaceAll("\\", "/").endsWith("/caniemail/dist/json.js")) return null;
    return 'import data from "../data/caniemail.json";\nexport const caniEmailJson = data;\n';
  },
};

export default defineConfig({
  // `@samva/markup/compiler` loads caniemail, whose glob dependency reads Node's `process` when it
  // loads and whose data module calls Node's `createRequire`. The compiled host
  // (`compiled-host.ts`) runs the compiler in the browser, so both are made browser-safe here.
  optimizeDeps: { rolldownOptions: { plugins: [caniemailBrowserShims] } },
  define: {
    "process.platform": JSON.stringify("browser"),
    "process.version": JSON.stringify("v22.0.0"),
  },
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: [
      { find: "@samva/editor/shell", replacement: src("shell.ts") },
      { find: "@samva/editor/mock", replacement: src("mock.ts") },
      { find: "@samva/editor/host/effect", replacement: src("host/effect.ts") },
      { find: "@samva/editor/host", replacement: src("host/types.ts") },
    ],
  },
  server: { port: 5232 },
});
