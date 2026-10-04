import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { Schema } from "effect";
import { defineConfig, type Plugin } from "vite";

/** The root of the installed package a bundled module belongs to: its last `node_modules` segment. */
const PACKAGE_ROOT = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//;
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\.[a-z]+)?$/i;

/** The `package.json` fields a notice needs; `author` and `repository` take either npm form. */
const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  license: Schema.optional(Schema.String),
  author: Schema.optional(Schema.Union([Schema.String, Schema.Struct({ name: Schema.String })])),
  repository: Schema.optional(Schema.Union([Schema.String, Schema.Struct({ url: Schema.String })])),
});
type Manifest = typeof Manifest.Type;

const manifestOf = (root: string): Manifest =>
  Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));

/**
 * A package's licence text. A package that ships no licence file but declares its licence in
 * `package.json` gets a notice built from that declaration, its author and its source; one that
 * declares nothing fails the build rather than ship without a notice.
 */
const noticeOf = (root: string, manifest: Manifest): string => {
  const file = readdirSync(root).find((entry) => LICENSE_FILE.test(entry));
  if (file !== undefined) return readFileSync(join(root, file), "utf8");
  const { license, author, repository } = manifest;
  if (license === undefined) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Build config, not Effect code: a missing notice must fail the build rather than ship without it.
    throw new Error(`${manifest.name} is bundled into the editor but declares no licence`);
  }
  const holder = typeof author === "object" ? author.name : author;
  const source = typeof repository === "object" ? repository.url : repository;
  return [
    `# ${manifest.name}@${manifest.version}`,
    "",
    `Licensed under ${license} (https://spdx.org/licenses/${license}.html), as declared in its package.json; the published package ships no licence file.`,
    ...(holder === undefined ? [] : ["", `Copyright (c) ${holder}`]),
    ...(source === undefined ? [] : ["", `Source: ${source}`]),
    "",
  ].join("\n");
};

/**
 * The app bundles React, Base UI, Hugeicons and the rest of its dependency graph into `dist/editor`,
 * and their licences ask that the notice travel with every copy. The build ships the licence file of
 * every installed package whose code reaches a chunk, read from the module graph so a new dependency
 * is covered without a list to update. Workspace code is Samva's own and carries the package LICENSE.
 */
const bundledLicenses = (): Plugin => ({
  name: "samva-editor-bundled-licenses",
  apply: "build",
  generateBundle(_options, bundle) {
    const roots = new Set<string>();
    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") continue;
      for (const id of output.moduleIds) {
        const root = PACKAGE_ROOT.exec(id.replaceAll("\\", "/"))?.[1];
        if (root !== undefined) roots.add(root);
      }
    }
    const emitted = new Set<string>();
    for (const root of [...roots].sort()) {
      const manifest = manifestOf(root);
      if (emitted.has(manifest.name)) continue;
      emitted.add(manifest.name);
      this.emitFile({
        type: "asset",
        fileName: `licenses/${manifest.name.replace(/^@/, "").replace("/", "-")}.md`,
        source: noticeOf(root, manifest),
      });
    }
  },
});

// The editor UI is a standalone React app. It is built to `../dist/editor` and
// served by the samvaEditor plugin's dev middleware at its configured route; it
// talks to the plugin's HTTP + SSE transport under `<route>/api`. `base: "./"`
// keeps asset URLs relative so the built index.html works when mounted under any
// sub-path. During development of the app itself, run it standalone with
// `bun run dev:editor` against a running example project.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react(), tailwind(), bundledLicenses()],
  build: {
    outDir: fileURLToPath(new URL("../dist/editor", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
