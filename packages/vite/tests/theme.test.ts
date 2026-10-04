import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";

import { PROJECT_THEME_FILE, readProjectThemeCss, resolveThemePath } from "../src/theme";

describe("project theme source", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "samva-theme-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("resolves default, custom and disabled paths", () => {
    expect(resolveThemePath(dir, undefined)).toBe(join(dir, PROJECT_THEME_FILE));
    expect(resolveThemePath(dir, "custom.css")).toBe(join(dir, "custom.css"));
    expect(resolveThemePath(dir, false)).toBeUndefined();
  });
  it("reads Tailwind CSS verbatim, without applying the structured theme grammar", async () => {
    const css = "@theme { --color-brand: oklch(63.7% 0.237 25.331); --spacing-card: 1rem; }";
    const path = join(dir, "theme.css");
    await writeFile(path, css);
    expect(await readProjectThemeCss(path)).toBe(css);
  });
  it("allows missing or disabled themes and surfaces filesystem failures", async () => {
    expect(await readProjectThemeCss(undefined)).toBeUndefined();
    expect(await readProjectThemeCss(join(dir, "missing.css"))).toBeUndefined();
    await expect(readProjectThemeCss(dir)).rejects.toThrow();
  });
});
