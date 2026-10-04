import { describe, expect, it } from "@effect/vitest";

import { compileTemplate } from "../src/sml/compile";
import { checkStaticProfile, introducedProfileErrors } from "../src/sml/profile";

const template = (body: string, extra = ""): string => `
import { defineTemplate } from "@samva/markup";
import { fmt } from "@samva/markup/fmt";
import { Email, Section } from "@samva/markup/email";
import { BrandLogo } from "samva:brand";
import { jsonSchema } from "@samva/markup/input-schema";
${extra}

export default defineTemplate({
  id: "order-shipped",
  schema: jsonSchema<{ name: string; total: number; trackingUrl?: string }>({
    type: "object",
    properties: { name: { type: "string" }, total: { type: "number" }, trackingUrl: { type: "string" } },
    required: ["name", "total"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Ada", total: 42 } },
  email: {
    subject: (input) => \`Hi \${input.name}\`,
    body: (input) => (${body}),
  },
});
`;

const codes = (source: string, path?: string) =>
  checkStaticProfile(source, path).map((item) => item.code);

describe("checkStaticProfile", () => {
  it("accepts a template that reads a bound field", () => {
    expect(codes(template('<Email><p className="text-sm">Hi {input.name}</p></Email>'))).toEqual(
      [],
    );
  });

  it("does not need a brand, Tailwind, or the files an import names", () => {
    const source = template(
      '<Email><BrandLogo /><Header name={input.name} /><img src={logo} alt="" /></Email>',
      'import { Header } from "./header";\nimport logo from "./logo.png";\nimport "./theme.css";',
    );
    expect(codes(source, "templates/entry.tsx")).toEqual([]);
  });

  it("reads a partial that the project holds", () => {
    const files = {
      "templates/entry.tsx": template(
        "<Email><Header name={input.name} /></Email>",
        'import { Header } from "./header";',
      ),
      "templates/header.tsx":
        "export const Header = ({ name }: { name: string }) => <h1>{name}</h1>;",
    };
    expect(checkStaticProfile(files, "templates/entry.tsx")).toEqual([]);
    const broken = {
      ...files,
      "templates/header.tsx":
        "export const Header = ({ name }: { name: string }) => <h1>{name.toUpperCase()}</h1>;",
    };
    expect(
      checkStaticProfile(broken, "templates/entry.tsx").some((item) => item.severity === "error"),
    ).toBe(true);
  });

  it.each([
    ["a call in a body", "<Email><p>{input.name.toUpperCase()}</p></Email>"],
    ["an event handler", "<Email><button onClick={() => 1}>x</button></Email>"],
    ["a misspelled field", "<Email><p>{input.nmae}</p></Email>"],
    ["an unguarded optional", "<Email><p>{input.trackingUrl}</p></Email>"],
    ["a computed class name", "<Email><p className={`text-${input.name}`}>x</p></Email>"],
  ])("finds %s", (_label, body) => {
    expect(checkStaticProfile(template(body)).some((item) => item.severity === "error")).toBe(true);
  });

  it("reports the same codes as the full compile for structural findings", async () => {
    const source = template("<Email><p>{input.name.toUpperCase()}</p></Email>");
    const compiled = await compileTemplate({
      files: { "entry.tsx": source.replace('import { BrandLogo } from "samva:brand";\n', "") },
      entry: "entry.tsx",
      assetBase: "https://assets.example",
      tailwind: false,
    });
    const compiledErrors = compiled.diagnostics.filter((item) => item.severity === "error");
    const checked = checkStaticProfile(source, "entry.tsx").filter(
      (item) => item.severity === "error",
    );
    expect(checked.map((item) => [item.code, item.message])).toEqual(
      compiledErrors.map((item) => [item.code, item.message]),
    );
  });

  it("reports a defineEmail entry as outside the profile", () => {
    expect(
      codes(
        'import { defineEmail } from "@samva/markup/template";\nexport default defineEmail({});',
      ),
    ).toContain("legacy-definition");
  });

  it("returns a syntax error rather than throwing", () => {
    expect(codes("export default defineTemplate({")).toEqual(["syntax-error"]);
  });
});

describe("introducedProfileErrors", () => {
  it("counts only errors the source did not already have", () => {
    const before = checkStaticProfile(template("<Email><p>{input.nmae}</p></Email>"));
    const same = checkStaticProfile(template("<Email><p>{input.nmae}</p><p>x</p></Email>"));
    const worse = checkStaticProfile(
      template("<Email><p>{input.nmae}</p><p>{input.name.trim()}</p></Email>"),
    );
    expect(introducedProfileErrors(before, same)).toEqual([]);
    expect(introducedProfileErrors(before, worse).length).toBeGreaterThan(0);
    expect(introducedProfileErrors(worse, before)).toEqual([]);
  });
});
