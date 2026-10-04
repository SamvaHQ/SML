import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";

describe("shipped sources", () => {
  it("has no node-isms in shipped sources (Worker + browser targets)", () => {
    const sourceDirectory = join(import.meta.dirname, "..", "src");
    for (const file of readdirSync(sourceDirectory, { recursive: true, encoding: "utf8" }).filter(
      (path) => String(path).endsWith(".ts"),
    )) {
      const content = readFileSync(join(sourceDirectory, file), "utf8");
      expect(content, `${file} must not import node built-ins`).not.toMatch(
        /from "(node:|fs|path|os|crypto|url)"/,
      );
      expect(content, `${file} must not touch process/globalThis env`).not.toMatch(
        /process\.env|Date\.now|Math\.random/,
      );
    }
  });
});
