import { readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";

import { parse } from "@babel/parser";
import { describe, expect, it } from "@effect/vitest";
import { parse as parseCss, walk as walkCss } from "css-tree";

import { isObject } from "../src/internal/guards";
import baseline from "./authoring-boundary-baseline.json" with { type: "json" };

/**
 * The repository holding the authoring packages. Every sibling is found from here, at the same
 * relative paths in the Samva monorepo and in the standalone SML repository.
 */
const ROOT = resolve(import.meta.dirname, "../../..");

type Manifest = {
  readonly name: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
};

// Read from source, so the test needs no built package and no package.json export.
const readManifest = (directory: string): Manifest =>
  JSON.parse(readFileSync(resolve(ROOT, directory, "package.json"), "utf8")) as Manifest;

const markup = readManifest("packages/markup");
const vite = readManifest("packages/vite");
const editor = readManifest("packages/editor");
const viteEditor = readManifest("packages/vite/editor");
const SML = [markup, vite, editor];
const TREES = [
  {
    name: markup.name,
    directory: "packages/markup",
    source: "src",
    dependencies: markup.dependencies ?? {},
  },
  {
    name: vite.name,
    directory: "packages/vite",
    source: "src",
    dependencies: { ...vite.dependencies, ...vite.peerDependencies },
  },
  {
    name: editor.name,
    directory: "packages/editor",
    source: "src",
    dependencies: { ...editor.dependencies, ...editor.peerDependencies },
  },
  // This private build workspace bundles these libraries into the published Vite editor.
  {
    name: viteEditor.name,
    directory: "packages/vite/editor",
    source: "src",
    dependencies: viteEditor.devDependencies ?? {},
  },
];
const HOSTED_MARKERS = ["api.samva.dev", "SAMVA_API_KEY", "ses:no-track"];

type Violation = { file: string; kind: string; value: string };

const filesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });

const packageName = (specifier: string) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;

const privatePackage = (name: string) =>
  name.startsWith("@nucleo/") ||
  (name.startsWith("@samva/") && !SML.some((manifest) => manifest.name === name));

const allowedImport = (
  specifier: string,
  file: string,
  directory: string,
  dependencies: Readonly<Record<string, string>> | undefined,
  importer: string,
) => {
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(file), specifier);
    const owner = TREES.filter((tree) => {
      const path = relative(resolve(ROOT, tree.directory), target);
      return path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
    }).sort((a, b) => b.directory.length - a.directory.length)[0];
    return owner?.directory === directory;
  }
  if (isBuiltin(specifier)) return true;
  const name = packageName(specifier);
  const subpath = specifier.slice(name.length).split("/");
  if (subpath.includes("src") || subpath.includes("..")) return false;
  if (privatePackage(name)) return false;
  const sibling = SML.find((manifest) => manifest.name === name);
  if (sibling !== undefined) {
    const entry = specifier === name ? "." : `.${specifier.slice(name.length)}`;
    return (
      Object.hasOwn(sibling.exports ?? {}, entry) &&
      (name === importer || Object.hasOwn(dependencies ?? {}, name))
    );
  }
  return Object.hasOwn(dependencies ?? {}, name);
};

// Walking the parsed syntax avoids treating diagnostic examples and comments as imports.
const importsIn = (source: string, file: string): string[] => {
  const imports: string[] = [];
  if (file.endsWith(".css")) {
    walkCss(parseCss(source), (node) => {
      if (node.type !== "Atrule" || node.name.toLowerCase() !== "import" || node.prelude === null)
        return;
      walkCss(node.prelude, (child) => {
        if (child.type === "String" || child.type === "Url") imports.push(child.value);
      });
    });
    return imports;
  }
  if (!/\.[cm]?[jt]sx?$/.test(file)) return imports;
  const tree = parse(source, {
    sourceType: "unambiguous",
    plugins: file.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
    createImportExpressions: true,
  });
  const literal = (value: unknown): string => {
    if (!isObject(value)) return "<nonliteral import>";
    if ("type" in value && value.type === "StringLiteral" && "value" in value)
      return String(value.value);
    return "<nonliteral import>";
  };
  const visit = (node: unknown): void => {
    if (!isObject(node)) return;
    if ("type" in node) {
      if (
        [
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
          "ImportExpression",
        ].includes(String(node.type)) &&
        "source" in node &&
        node.source !== null
      )
        imports.push(literal(node.source));
      if (node.type === "TSExternalModuleReference" && "expression" in node)
        imports.push(literal(node.expression));
      if (node.type === "TSImportType" && "source" in node) imports.push(literal(node.source));
      if (node.type === "CallExpression" && "callee" in node && "arguments" in node) {
        const callee = node.callee;
        if (
          isObject(callee) &&
          "type" in callee &&
          callee.type === "Identifier" &&
          "name" in callee &&
          callee.name === "require" &&
          Array.isArray(node.arguments)
        )
          imports.push(literal(node.arguments[0]));
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(tree);
  return imports;
};

const violations = (): Violation[] => {
  const found: Violation[] = [];
  for (const { name, directory, source, dependencies } of TREES) {
    for (const file of filesIn(resolve(ROOT, directory, source))) {
      const text = readFileSync(file, "utf8");
      const path = relative(ROOT, file);
      for (const value of new Set(importsIn(text, file)))
        if (!allowedImport(value, file, directory, dependencies, name))
          found.push({ file: path, kind: "import", value });
      for (const value of HOSTED_MARKERS)
        if (text.includes(value)) found.push({ file: path, kind: "hosted marker", value });
    }
    for (const value of Object.keys(dependencies))
      if (privatePackage(value))
        found.push({ file: `${directory}/package.json`, kind: "dependency", value });
  }
  return found;
};

const key = ({ file, kind, value }: Violation) => `${file}: ${kind} ${value}`;
const assertBaseline = (actual: Violation[], expected: Violation[]) => {
  const found = new Set(actual.map(key));
  const accepted = new Set(expected.map(key));
  const added = [...found].filter((entry) => !accepted.has(entry)).sort();
  const stale = [...accepted].filter((entry) => !found.has(entry)).sort();
  expect(
    { added, stale },
    "Remove the disallowed import/dependency, or move hosted behavior behind a plugin/CLI seam. " +
      "The baseline only shrinks: never add entries; delete stale baseline entries that no longer occur.",
  ).toEqual({ added: [], stale: [] });
  expect(expected.map(key).length, "The baseline must not contain duplicate entries").toBe(
    accepted.size,
  );
};

describe("SML authoring public boundary", () => {
  it("allows only public imports and the explicit shrinking baseline", () => {
    assertBaseline(violations(), baseline);
  });

  it("recognizes static, type, re-export, side-effect, dynamic and CommonJS import edges", () => {
    expect(
      importsIn(
        `import type { X } from '@samva/core';
         export * from '@samva/ui';
         export { X } from '@samva/contracts';
         import '@nucleo/ui';
         import('@samva/core/secret');
         type T = import('@samva/contracts').T;
         import C = require('@samva/core');
         require('@samva/ui');
         import(variable);
         // import '@samva/ignored';
         const example = "import '@samva/example'";`,
        "fixture.ts",
      ),
    ).toEqual([
      "@samva/core",
      "@samva/ui",
      "@samva/contracts",
      "@nucleo/ui",
      "@samva/core/secret",
      "@samva/contracts",
      "@samva/core",
      "@samva/ui",
      "<nonliteral import>",
    ]);
    expect(
      importsIn('/* @import "@samva/ignored"; */ @import url("@samva/ui");', "fixture.css"),
    ).toEqual(["@samva/ui"]);
  });

  it("rejects private packages, undeclared libraries, sibling internals and escaping paths", () => {
    const file = resolve(ROOT, "packages/editor/src/fixture.ts");
    for (const specifier of [
      "@samva/core",
      "@nucleo/ui/outline",
      "@samva/markup/src/ir",
      "@samva/markup/render/../src/ir",
      "../../markup/src/ir",
      "/absolute/module",
      "undeclared-library",
      "reactive/unlisted",
      "clsx/src/index",
      "clsx/../../core/src",
    ])
      expect(
        allowedImport(specifier, file, "packages/editor", editor.dependencies, editor.name),
        specifier,
      ).toBe(false);
    for (const specifier of [
      "./local",
      "../package.json",
      "node:fs",
      "fs/promises",
      "@samva/markup/render",
      "@samva/editor/host",
      "clsx",
    ])
      expect(
        allowedImport(specifier, file, "packages/editor", editor.dependencies, editor.name),
        specifier,
      ).toBe(true);
  });

  it("requires declared sibling dependencies", () => {
    const file = resolve(ROOT, "packages/vite/src/fixture.ts");
    expect(
      allowedImport("@samva/editor/host", file, "packages/vite", vite.dependencies, vite.name),
    ).toBe(false);
    expect(
      allowedImport("@samva/markup/render", file, "packages/vite", vite.dependencies, vite.name),
    ).toBe(true);
  });

  it("keeps nested workspaces separate", () => {
    const file = resolve(ROOT, "packages/vite/src/fixture.ts");
    expect(
      allowedImport("../editor/src/app", file, "packages/vite", vite.dependencies, vite.name),
    ).toBe(false);
    expect(allowedImport("./local", file, "packages/vite", vite.dependencies, vite.name)).toBe(
      true,
    );
  });

  it("rejects new violations and stale baseline entries", () => {
    const violation = {
      file: "packages/editor/src/fixture.ts",
      kind: "import",
      value: "@samva/core",
    };
    expect(() => assertBaseline([violation], [])).toThrow("Remove the disallowed import");
    expect(() => assertBaseline([], [violation])).toThrow("baseline only shrinks");
  });
});
