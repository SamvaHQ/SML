import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone dev app for the editor shell — NOT a workspace member. @samva/editor/*
// is aliased to source so shell/canvas edits hot-reload; @samva/markup/* resolves to
// its built dist through the normal package exports.
const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

export default defineConfig({
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
