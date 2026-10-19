import { describe, expect, it } from "@effect/vitest";

import { DIAGNOSTIC_CODES } from "../src/diagnostic-codes";
import { compileTemplate } from "../src/sml/compile";

const entry = (imports: string, body: string): string => `
import { defineTemplate } from "@samva/markup";
import { Email, Section, Image } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
${imports}

export default defineTemplate({
  id: "external-asset",
  schema: jsonSchema<{ name: string }>({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Ada" } },
  email: { subject: (input) => input.name, body: () => <Email><Section>${body}</Section></Email> },
});
`;

const warningsFor = async (
  imports: string,
  body: string,
  assetBase = "https://assets.example/t",
) => {
  const compiled = await compileTemplate({
    files: {
      "templates/entry.tsx": entry(imports, body),
      "templates/logo.png": new TextEncoder().encode("png bytes"),
    },
    entry: "templates/entry.tsx",
    assetBase,
  });
  const found = compiled.diagnostics.filter((item) => item.code === "email-external-asset");
  // An external image is a warning: the template still compiles.
  if (found.length > 0)
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return found;
};

describe("email-external-asset", () => {
  it("warns on an external https <img>, naming the host and carrying the fix and location", async () => {
    const found = await warningsFor("", `<img src="https://cdn.example.com/x.png" alt="x" />`);
    expect(found).toHaveLength(1);
    const [warning] = found;
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("cdn.example.com");
    expect(warning?.message).toContain("https://cdn.example.com/x.png");
    expect(warning?.fix).toBe(DIAGNOSTIC_CODES["email-external-asset"].fix);
    expect(warning?.origins[0]?.lineNumber).toBeGreaterThan(0);
  });

  it("warns on the Image primitive", async () => {
    const found = await warningsFor("", `<Image src="https://cdn.example.com/a.png" alt="a" />`);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("cdn.example.com");
  });

  it("does not warn on an imported project asset", async () => {
    expect(
      await warningsFor(`import logo from "./logo.png";`, `<Image src={logo} alt="logo" />`),
    ).toEqual([]);
    expect(
      await warningsFor(
        `import logo from "./logo.png";`,
        `<img src={logo} alt="logo" />`,
        "./assets",
      ),
    ).toEqual([]);
  });

  it("does not warn on a data URI, a relative path or a link href", async () => {
    expect(
      await warningsFor(
        "",
        `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" /><img src="/img/a.png" alt="" /><img src="img/b.png" alt="" /><a href="https://example.com">go</a>`,
      ),
    ).toEqual([]);
  });

  it("does not warn on a URL under the configured https asset base", async () => {
    expect(
      await warningsFor("", `<img src="https://assets.example/t/abc123.png" alt="" />`),
    ).toEqual([]);
    expect(
      await warningsFor("", `<img src="https://assets.example/other/abc123.png" alt="" />`),
    ).toHaveLength(1);
  });
});
