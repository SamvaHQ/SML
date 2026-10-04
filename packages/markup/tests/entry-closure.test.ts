import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "@effect/vitest";

// The API renders published IR at send time through `./render`. Its import closure must stay free of
// the compiler's libraries so the send path never bundles Tailwind, css-tree, caniemail or Babel.
// `./brand` is imported by the send path and the dashboard as well. It parses `theme.css` with
// css-tree, but compiling (Tailwind, Babel, caniemail) stays behind `./compiler`.

const COMPILER_LIBRARIES = ["@babel/parser", "caniemail", "css-tree", "tailwindcss"];
const SOURCE = resolve(import.meta.dirname, "../src");
// Type-only statements are erased at compile time, so they are not edges of the runtime closure.
const SPECIFIER = /(?:import|export)\s(?!type\b)[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g;

const closure = (entry: string) => {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (modules.has(file)) return;
    modules.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2]!;
      if (!specifier.startsWith(".")) packages.add(specifier);
      else {
        const base = join(dirname(file), specifier);
        const module = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find(
          (candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate),
        );
        if (module !== undefined) visit(module);
        else if (!existsSync(base)) throw new Error(`Unresolved import ${specifier} in ${file}`);
      }
    }
  };
  visit(join(SOURCE, entry));
  return packages;
};

describe("entry import closure", () => {
  it.each([
    { entry: "render.ts", allowed: [] },
    { entry: "brand.ts", allowed: ["css-tree"] },
  ])("keeps $entry free of the compiler's libraries", ({ entry, allowed }) => {
    const packages = [...closure(entry)];
    for (const name of COMPILER_LIBRARIES.filter((library) => !allowed.includes(library)))
      expect(packages.filter((specifier) => specifier.startsWith(name))).toEqual([]);
  });

  it("reaches the compiler's libraries from ./compiler, so the check above can fail", () => {
    const packages = [...closure("compiler.ts")];
    expect(COMPILER_LIBRARIES.filter((name) => packages.some((p) => p.startsWith(name)))).toEqual(
      COMPILER_LIBRARIES,
    );
  });
});
