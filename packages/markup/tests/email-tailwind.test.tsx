/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { applyStylesheet } from "../src/email/cascade";
import { Column, Columns, Email, Image, Section } from "../src/email/components";
import { parseStylesheet } from "../src/email/css";
import { compileEmail } from "../src/email/render";
import { compileTailwind, discoverClassCandidates, TAILWIND_VERSION } from "../src/email/tailwind";

describe("pinned Tailwind compilation", () => {
  it("applies utility classes to primitive content and serializes multiline font tokens", async () => {
    const output = await compileTailwind(["font-sans", "p-4", "text-right", "rounded-lg"]);
    const applied = applyStylesheet(
      <Email className="font-sans">
        <Section className="p-4">
          <Columns>
            <Column className="text-right">
              <Image className="rounded-lg" src="https://example.com/logo.png" alt="Logo" />
            </Column>
          </Columns>
        </Section>
      </Email>,
      parseStylesheet(output.css, { origin: "tailwind" }),
    );
    const html = compileEmail(applied.tree).html;
    expect(html).toMatch(/<td[^>]*font-family:/);
    expect(html).toMatch(/<td[^>]*padding:1rem/);
    expect(html).toMatch(/<td[^>]*text-align:right/);
    expect(html).toMatch(/<img[^>]*border-radius:/);
    expect(html).not.toContain("var(");
  });

  it("compiles the discovered candidates with the exact pinned release", async () => {
    const output = await compileTailwind(["text-red-500", "p-4"]);
    expect(output.version).toBe(TAILWIND_VERSION);
    expect(output.candidates).toEqual(["p-4", "text-red-500"]);
    expect(output.css).toContain(".text-red-500");
    expect(output.css).toContain(".p-4");
  });

  it("resolves variables and lowers oklch so an inlined utility carries a usable color", async () => {
    const output = await compileTailwind(["text-red-500", "p-4"]);
    const applied = applyStylesheet(
      <p className="p-4 text-red-500">Hello</p>,
      parseStylesheet(output.css, { origin: "tailwind" }),
    );
    const html = compileEmail(applied.tree).html;
    expect(html).toContain("color:#fb2c36");
    expect(html).toContain("padding:1rem");
    expect(html).not.toContain("var(");
    expect(html).not.toContain("oklch");
  });

  it("keeps a responsive utility in <head> with legacy media syntax", async () => {
    const output = await compileTailwind(["sm:p-8"]);
    const applied = applyStylesheet(
      <p className="sm:p-8">Hello</p>,
      parseStylesheet(output.css, { origin: "tailwind" }),
    );
    expect(applied.headCss).toContain("@media (min-width:40rem)");
    expect(applied.headCss).toContain("padding:2rem!important");
    expect(compileEmail(applied.tree).html).toContain('class="sm:p-8"');
  });

  it("keeps a dark-scheme utility in <head> rather than freezing the light value", async () => {
    const output = await compileTailwind(["dark:bg-black", "bg-white"]);
    const applied = applyStylesheet(
      <p className="bg-white dark:bg-black">Hello</p>,
      parseStylesheet(output.css, { origin: "tailwind" }),
    );
    expect(compileEmail(applied.tree).html).toContain("background-color:#fff");
    expect(applied.headCss).toContain("prefers-color-scheme:dark");
  });

  it("takes project theme overrides as its pinned configuration", async () => {
    const output = await compileTailwind(["text-brand"], {
      css: "@theme { --color-brand: #ff8800; }",
    });
    expect(output.css).toContain("#ff8800");
  });

  it("accepts a declared safelist for classes source cannot state", async () => {
    const output = await compileTailwind([], { safelist: ["underline"] });
    expect(output.candidates).toEqual(["underline"]);
    expect(output.css).toContain(".underline");
  });
});

describe("class discovery", () => {
  const module = (source: string) => discoverClassCandidates(source, "emails/welcome.tsx");

  it("reads literal classes from JSX attributes and component props", () => {
    const found = module(
      `const Card = (props: { className: string }) => <div className="p-4 text-red-500" />;\n` +
        `export const view = () => <Card className="mt-2" />;\n` +
        `export const props = { class: "font-bold" };`,
    );
    expect(found.candidates).toEqual(["font-bold", "mt-2", "p-4", "text-red-500"]);
    expect(found.diagnostics).toEqual([]);
  });

  it("reads both branches of a conditional and a template with no expressions", () => {
    const found = module(
      'export const view = (ok: boolean) => <p className={ok ? `text-green-600` : "text-red-600"} />;',
    );
    expect(found.candidates).toEqual(["text-green-600", "text-red-600"]);
    expect(found.diagnostics).toEqual([]);
  });

  it("reports a class the compiler cannot discover, with its source location", () => {
    const found = module(
      "export const view = (tone: string) => <p className={`text-${tone}-500 p-2`} />;",
    );
    // The literal fragments still contribute; the interpolated class cannot.
    expect(found.candidates).toContain("p-2");
    expect(found.diagnostics).toHaveLength(1);
    expect(found.diagnostics[0]?.code).toBe("tailwind-dynamic-class");
    expect(found.diagnostics[0]?.severity).toBe("warning");
    expect(found.diagnostics[0]?.origins[0]).toMatchObject({
      fileName: "emails/welcome.tsx",
      lineNumber: 1,
    });
  });

  it("reports a class read from a variable", () => {
    const found = module("export const view = (tone: string) => <p className={tone} />;");
    expect(found.diagnostics.map((entry) => entry.code)).toEqual(["tailwind-dynamic-class"]);
  });
});

describe("generated-output budget", () => {
  it("refuses a candidate set larger than the build allows", async () => {
    const many = Array.from({ length: 40 }, (_, index) => `p-${index}`);
    await expect(
      compileTailwind(many, { limits: { candidates: 8, cssBytes: 1e6 } }),
    ).rejects.toThrow("Tailwind candidate limit exceeded");
  });

  it("refuses a stylesheet larger than the build allows", async () => {
    await expect(
      compileTailwind(["p-4", "text-red-500"], { limits: { candidates: 100, cssBytes: 32 } }),
    ).rejects.toThrow("Generated CSS limit exceeded");
  });

  it("compiles unchanged inside the budget", async () => {
    const output = await compileTailwind(["p-4"], { limits: { candidates: 10, cssBytes: 1e6 } });
    expect(output.css).toContain(".p-4");
  });
});
