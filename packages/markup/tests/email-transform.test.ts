import { describe, expect, it } from "@effect/vitest";

import { assetEntry, assetUrl, isAssetPath, isExternalAsset } from "../src/email/assets";
import { transformProject } from "../src/email/transform";

const options = { assetBase: "https://assets.samva.dev/t/abc" } as const;

describe("content-addressed assets", () => {
  it("addresses a file by the hash of its bytes, not by its name", async () => {
    const bytes = new TextEncoder().encode("pretend png");
    const first = await assetEntry("images/logo.png", bytes);
    const second = await assetEntry("images/renamed.png", bytes);
    expect(first.digest).toBe(second.digest);
    expect(first.fileName).toBe(`${first.digest}.png`);
    expect(first.contentType).toBe("image/png");
    expect(assetUrl(first, "https://assets.samva.dev/t/abc")).toBe(
      `https://assets.samva.dev/t/abc/${first.fileName}`,
    );
    const changed = await assetEntry("images/logo.png", new TextEncoder().encode("other"));
    expect(changed.digest).not.toBe(first.digest);
  });

  it("knows which imports become assets and which URLs stay external", () => {
    expect(isAssetPath("a/b/logo.png")).toBe(true);
    expect(isAssetPath("a/b/font.woff2")).toBe(true);
    expect(isAssetPath("a/b/module.ts")).toBe(false);
    expect(isExternalAsset("https://cdn.example.com/a.png")).toBe(true);
    expect(isExternalAsset("./local.png")).toBe(false);
  });

  it("takes the asset base as a build input, so a local export can differ", async () => {
    const files = { "logo.png": new TextEncoder().encode("bytes") };
    const hosted = await transformProject(files, options);
    const local = await transformProject(files, { assetBase: "./assets" });
    const [hostedAsset] = hosted.assets;
    const [localAsset] = local.assets;
    expect(assetUrl(hostedAsset!, options.assetBase)).toContain("https://assets.samva.dev/t/abc/");
    expect(assetUrl(localAsset!, "./assets")).toContain("./assets/");
    expect(hostedAsset?.digest).toBe(localAsset?.digest);
    // An export writes its pages below the directory holding the bytes, so the
    // base that resolves from a page walks back up to it.
    const nested = await transformProject(files, { assetBase: "../../assets" });
    expect(nested.diagnostics).toEqual([]);
    const bad = await transformProject(files, { assetBase: "not a base" });
    expect(bad.diagnostics[0]?.code).toBe("invalid-asset-base");
  });
});

describe("project transform", () => {
  const project = {
    "package.json": '{"name":"demo"}',
    "styles.css": ".card{padding:16px}",
    "emails/welcome.tsx":
      '/** @jsxImportSource @samva/markup/email */\nimport "../styles.css";\nexport const view = () => <p className="text-red-500 card">hi</p>;',
    "images/logo.png": new TextEncoder().encode("png bytes"),
  };

  it("parses each project stylesheet and compiles the discovered classes once", async () => {
    const output = await transformProject(project, options);
    expect(output.stylesheets.get("styles.css")?.rules.map((rule) => rule.selector)).toEqual([
      ".card",
    ]);
    expect(JSON.stringify(output.tailwindSheet)).toContain(".text-red-500");
    expect(output.assets.map((asset) => asset.path)).toEqual(["images/logo.png"]);
  });

  it("compiles no Tailwind when the project uses none", async () => {
    const output = await transformProject(
      { "emails/welcome.tsx": "export const view = () => 1;" },
      options,
    );
    expect(output.tailwindSheet).toBeUndefined();
  });

  it("produces identical output for identical input", async () => {
    const first = await transformProject(project, options);
    const second = await transformProject(project, options);
    expect(JSON.stringify(second.tailwindSheet)).toBe(JSON.stringify(first.tailwindSheet));
    expect([...second.stylesheets]).toEqual([...first.stylesheets]);
    expect(second.assets).toEqual(first.assets);
  });
});
