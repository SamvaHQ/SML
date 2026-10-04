import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  DIAGNOSTIC_CODE_FAMILIES,
  DIAGNOSTIC_CODES,
  hasUpgradeRecipe,
} from "../src/diagnostic-codes";
import { FORMATTER_NAMES } from "../src/fmt";
import { SML_IR_VERSION } from "../src/ir";
import { PROFILE_FORMS, PROFILE_REJECTED } from "../src/sml/profile";

const SOURCE_ROOT = join(import.meta.dirname, "..", "src");

/** Brand stylesheet and render-time errors have their own code spaces, not template diagnostics. */
const OTHER_CODE_SPACES = ["theme-css.ts", "render-ir.ts"];

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") &&
      !path.endsWith(".gen.ts") &&
      !path.endsWith("diagnostic-codes.ts") &&
      !OTHER_CODE_SPACES.some((space) => path.endsWith(space))
      ? [path]
      : [];
  });

const sources = sourceFiles(SOURCE_ROOT).map((path) => readFileSync(path, "utf8"));

/** The code literals the modules that build diagnostics by hand write. */
const emitted = (): Set<string> => {
  const found = new Set<string>();
  const patterns = [
    /code:\s*"([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?)"/g,
    /\b(?:report|fail)\(\s*(?:sink,\s*)?"([a-z][a-z0-9-]*)"/g,
  ];
  for (const source of sources)
    for (const pattern of patterns)
      for (const match of source.matchAll(pattern)) found.add(match[1]!);
  return found;
};

describe("diagnostic codes", () => {
  it("identifies upgrades without accepting unknown or inherited identifiers", () => {
    expect(hasUpgradeRecipe("legacy-definition")).toBe(true);
    for (const code of ["fixture-invalid", "unknown", "toString", "__proto__", "constructor"])
      expect(hasUpgradeRecipe(code)).toBe(false);
  });

  it("lists every code the compiler writes by hand", () => {
    const known = new Set(Object.keys(DIAGNOSTIC_CODES));
    const missing = [...emitted()].filter(
      (code) =>
        !known.has(code) &&
        !Object.keys(DIAGNOSTIC_CODE_FAMILIES).some((prefix) => code.startsWith(prefix)),
    );
    expect(missing).toEqual([]);
  });

  it("lists no code that no module emits", () => {
    const unused = Object.keys(DIAGNOSTIC_CODES).filter(
      (code) => !sources.some((source) => source.includes(`"${code}"`)),
    );
    expect(unused).toEqual([]);
  });
});

describe("generated contract", () => {
  const contract = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "generated", "contract.json"), "utf8"),
  ) as {
    diagnostics: { code: string; upgrade?: string }[];
    profile: { forms: unknown[]; rejected: unknown[] };
    formatters: { name: string }[];
    irVersion: number;
  };

  it("lists the registry, the profile table and the formatters (run codegen:contract)", () => {
    expect(contract.diagnostics.map((entry) => entry.code).toSorted()).toEqual(
      Object.keys(DIAGNOSTIC_CODES).toSorted(),
    );
    expect(contract.diagnostics).toEqual(
      Object.entries(DIAGNOSTIC_CODES)
        .map(([code, spec]) => ({ code, ...spec }))
        .toSorted((a, b) => a.code.localeCompare(b.code)),
    );
    const reference = readFileSync(
      join(import.meta.dirname, "..", "generated", "reference.md"),
      "utf8",
    );
    expect(reference).toContain("## Upgrades");
    for (const diagnostic of contract.diagnostics) {
      if (diagnostic.upgrade === undefined) continue;
      expect(reference).toContain(`### \`${diagnostic.code}\``);
      expect(reference.replace(/\s+/g, " ")).toContain(diagnostic.upgrade.replace(/\s+/g, " "));
    }
    expect(contract.profile.forms).toEqual(JSON.parse(JSON.stringify(PROFILE_FORMS)));
    expect(contract.profile.rejected).toEqual(JSON.parse(JSON.stringify(PROFILE_REJECTED)));
    expect(contract.formatters.map((entry) => entry.name)).toEqual(
      FORMATTER_NAMES.map((name) => `fmt.${name}`),
    );
    expect(contract.irVersion).toBe(SML_IR_VERSION);
  });
});
