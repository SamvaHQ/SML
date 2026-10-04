import { describe, expect, it } from "@effect/vitest";

import manifest from "../package.json" with { type: "json" };

// A template project depends on @samva/markup alone, and `samva templates check` and `dev` run the
// project's installed copy of the compiler, so the compiler's libraries ship as dependencies. A
// host that only renders imports `./render`, whose import closure excludes them
// (`entry-closure.test.ts`).

const COMPILER_LIBRARIES = ["@babel/parser", "caniemail", "css-tree", "tailwindcss"];

// The public surface. Authoring entries are what a template file imports; tooling entries are what
// a host (Vite, the CLI, the editor, the API) imports; data entries are generated references.
const PUBLIC_ENTRIES = [
  ".",
  "./brand",
  "./compiler",
  "./contract.json",
  "./diagnostics",
  "./edit",
  "./email",
  "./email/jsx-dev-runtime",
  "./email/jsx-runtime",
  "./fmt",
  "./input-schema",
  "./package.json",
  "./reference.md",
  "./render",
  "./samva-brand",
  "./sms",
  "./whatsapp",
];

describe("published package surface", () => {
  it("ships the compiler's libraries as dependencies, with no optional peers", () => {
    for (const name of COMPILER_LIBRARIES) expect(manifest.dependencies).toHaveProperty(name);
    expect(manifest).not.toHaveProperty("peerDependencies");
  });

  it("exports exactly the public entries", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(PUBLIC_ENTRIES);
  });
});
