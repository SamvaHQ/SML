import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";

import {
  compileProject,
  exportProject,
  loadProject,
  readProjectFiles,
  renderEmailFixtures,
  templateDirectories,
} from "../src/project";
import {
  cleanupProjects,
  emailTemplate,
  LOGO,
  multiChannelTemplate,
  SIGNATURE_PARTIAL,
  tempProject,
  THEME,
} from "./support/project";

// A project is a folder of templates: several definitions, partials shared
// between them, ordinary modules that are not templates, and imported files that
// become content-addressed assets. Nothing is evaluated, and nothing here needs a
// Samva credential or the network.

afterEach(cleanupProjects);

const withPartial = (id: string, copy: string) =>
  emailTemplate(id, copy, {
    imports: 'import { Signature } from "../components/signature";',
    body: `<Email><p className="text-brand">${copy}, {input.name}</p><Signature /></Email>`,
  });

describe("template directories", () => {
  it("scans templates/ and emails/ when both exist, and only the configured dir when set", async () => {
    const root = await tempProject({
      "templates/a.tsx": emailTemplate("a"),
      "emails/b.tsx": emailTemplate("b"),
      "other/c.tsx": emailTemplate("c"),
    });
    expect((await templateDirectories(root)).map((dir) => dir.slice(root.length))).toEqual([
      "/templates",
      "/emails",
    ]);
    const both = await loadProject({ root });
    expect(both.catalog.templates.map((entry) => entry.entryPath)).toEqual([
      "templates/a.tsx",
      "emails/b.tsx",
    ]);
    const only = await loadProject({ root, dir: "other" });
    expect(only.catalog.templates.map((entry) => entry.entryPath)).toEqual(["other/c.tsx"]);
  });

  it("recognizes emails/ on its own and finds nothing in a project with neither", async () => {
    const emails = await tempProject({ "emails/b.tsx": emailTemplate("b") });
    expect(
      (await loadProject({ root: emails })).catalog.templates.map((entry) => entry.id),
    ).toEqual(["b"]);
    const empty = await tempProject({});
    expect((await loadProject({ root: empty })).catalog.templates).toEqual([]);
  });

  it("refuses a templates directory outside the project root", async () => {
    const root = await tempProject({});
    await expect(templateDirectories(root, "../elsewhere")).rejects.toThrow(
      /outside the project root/,
    );
  });
});

describe("project catalog", () => {
  it("discovers templates by declared id and leaves partials out", async () => {
    const root = await tempProject({
      "templates/welcome.tsx": withPartial("welcome", "Welcome"),
      "templates/receipt.tsx": withPartial("receipt", "Receipt"),
      "components/signature.tsx": SIGNATURE_PARTIAL,
      "templates/helpers.tsx": "export const noteOf = 'text';\n",
      "theme.css": THEME,
    });
    const { catalog, diagnostics } = await loadProject({ root });

    // Identity is declared, not derived from the path.
    expect(catalog.templates.map((entry) => entry.id)).toEqual(["receipt", "welcome"]);
    expect(catalog.helpers).toEqual(["templates/helpers.tsx"]);
    expect(catalog.failures).toEqual([]);
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const welcome = catalog.templates.find((entry) => entry.id === "welcome")!;
    expect(welcome.channels).toEqual(["email"]);
    expect(Object.keys(welcome.fixtures)).toEqual(["first", "second"]);
    const [first] = renderEmailFixtures(welcome);
    expect(first?.rendered?.html).toContain("Welcome, Ada");
    expect(first?.rendered?.html).toContain("The Samva team");
    expect(first?.rendered?.html).toContain("#123456");
  });

  it("reports two definitions declaring one id, keeping the first by path", async () => {
    const root = await tempProject({
      "templates/one.tsx": emailTemplate("same"),
      "templates/two.tsx": emailTemplate("same", "Other"),
    });
    const { catalog } = await loadProject({ root });
    expect(catalog.templates.map((entry) => entry.entryPath)).toEqual(["templates/one.tsx"]);
    expect(catalog.diagnostics.map((item) => item.code)).toEqual(["duplicate-template-id"]);
  });

  it("keeps a failing template in the catalog with its findings and compiles the rest", async () => {
    const root = await tempProject({
      "templates/good.tsx": emailTemplate("good"),
      "templates/bad.tsx": emailTemplate("bad", "Hello", {
        body: "<Email><p>{input.nmae}</p></Email>",
      }),
    });
    const { catalog } = await loadProject({ root });
    expect(catalog.templates.map((entry) => entry.id)).toEqual(["good"]);
    expect(catalog.failures.map((entry) => entry.entryPath)).toEqual(["templates/bad.tsx"]);
    expect(catalog.failures[0]?.diagnostics.map((item) => item.code)).toContain("unknown-field");
  });

  it("does not run template modules, so top-level code has no effect", async () => {
    const root = await tempProject({
      "templates/side-effect.tsx": `${emailTemplate("side-effect")}\nthrow new Error("evaluated");\n`,
    });
    const { catalog } = await loadProject({ root });
    expect(catalog.templates.map((entry) => entry.id)).toEqual(["side-effect"]);
  });

  it("reports a defineEmail entry as an error, not as a helper", async () => {
    const root = await tempProject({
      "templates/legacy.tsx": `import { defineEmail } from "@samva/markup/template";\nexport default defineEmail({});\n`,
    });
    const { catalog } = await loadProject({ root });
    expect(catalog.helpers).toEqual([]);
    expect(catalog.failures[0]?.diagnostics.map((item) => item.code)).toEqual([
      "legacy-definition",
    ]);
  });

  it("declares each channel a template has", async () => {
    const root = await tempProject({ "templates/order.tsx": multiChannelTemplate("order") });
    const { catalog } = await loadProject({ root });
    expect(catalog.templates[0]?.channels).toEqual(["email", "sms", "whatsapp"]);
  });

  it("resolves imported assets to content-addressed files under the asset base", async () => {
    const root = await tempProject({
      "assets/logo.png": LOGO,
      "templates/logo.tsx": emailTemplate("logo", "Hello", {
        imports: 'import logo from "../assets/logo.png";',
        body: '<Email><img src={logo} alt="Samva" width="12" height="12" /></Email>',
      }),
    });
    const project = await loadProject({ root, assetBase: "https://assets.samva.test/p" });
    expect(project.catalog.assets).toHaveLength(1);
    const asset = project.catalog.assets[0]!;
    const [first] = renderEmailFixtures(project.catalog.templates[0]!);
    expect(first?.rendered?.html).toContain(`https://assets.samva.test/p/${asset.fileName}`);
  });

  it("reads scripts, stylesheets and assets but not hidden folders or node_modules", async () => {
    const root = await tempProject({
      "templates/a.tsx": emailTemplate("a"),
      "theme.css": THEME,
      "assets/logo.png": LOGO,
      "README.md": "# readme\n",
      ".samva/brands/x.json": "{}",
      "node_modules/pkg/index.js": "export {}",
    });
    const files = await readProjectFiles(root);
    expect(Object.keys(files).sort()).toEqual([
      "assets/logo.png",
      "package.json",
      "templates/a.tsx",
      "theme.css",
    ]);
    expect(files["assets/logo.png"]).toBeInstanceOf(Uint8Array);
  });

  it("compiles the same files to the same catalog", async () => {
    const root = await tempProject({ "templates/a.tsx": emailTemplate("a") });
    const files = await readProjectFiles(root);
    const input = { files, entries: ["templates/a.tsx"], assetBase: "" };
    expect(await compileProject(input)).toEqual(await compileProject(input));
  });
});

describe("exportProject", () => {
  it("writes browsable pages, channel files and the asset manifest", async () => {
    const root = await tempProject({
      "assets/logo.png": LOGO,
      "templates/logo.tsx": emailTemplate("logo", "Hello", {
        imports: 'import logo from "../assets/logo.png";',
        body: '<Email><img src={logo} alt="Samva" width="12" height="12" /></Email>',
      }),
      "templates/order.tsx": multiChannelTemplate("order"),
    });
    const out = join(root, "out");
    const receipt = await exportProject({ root, out });

    expect(receipt.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(receipt.templates.map((entry) => entry.id)).toEqual(["logo", "order"]);
    const page = await readFile(join(out, "templates/logo/first.html"), "utf8");
    const asset = receipt.assets.assets[0]!;
    expect(page).toContain(`../../assets/${asset.fileName}`);
    expect(await readdir(join(out, "assets"))).toEqual([asset.fileName]);
    expect(await readFile(join(out, "templates/order/first.sms.txt"), "utf8")).toContain(
      "Hi Ada, your order shipped.",
    );
    expect(
      JSON.parse(await readFile(join(out, "templates/order/first.whatsapp.json"), "utf8")),
    ).toMatchObject({ body: "Hi Ada, your order shipped.", language: "en_US" });
    const manifest = JSON.parse(await readFile(join(out, "catalog.json"), "utf8"));
    expect(manifest.assets.assets[0].url).toBe(`../../assets/${asset.fileName}`);
  });
});
