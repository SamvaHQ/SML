import { readFile, readdir } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompileTemplateOptions } from "../../src/compiler";
import type { EmailBrand } from "../../src/email/brand";
import { PARITY_COMPILE_OPTIONS, PARITY_ENTRY, PARITY_PROJECT } from "./email-parity";

export const BASELINE_HEAD = "2b40779294e8b7986e6f0a851788d423d4d31927";
export const BASELINE_DIRECTORY = new URL("../fixtures/rendered-email-baseline/", import.meta.url);

const THEME = `@theme {
  --color-primary: #075985;
  --color-primary-foreground: #ffffff;
  --color-card: #f0f9ff;
  --color-card-foreground: #082f49;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-primary: #7dd3fc;
    --color-primary-foreground: #082f49;
    --color-card: #082f49;
    --color-card-foreground: #f0f9ff;
  }
}`;

const FULL_BRAND: EmailBrand = {
  slug: "baseline",
  css: THEME,
  assets: {
    logoUrl: "https://assets.example.test/logo.png",
    logoDarkUrl: "https://assets.example.test/logo-dark.png",
  },
  footer: {
    companyName: "Baseline & Co.",
    address: {
      street1: "10 Example Street",
      street2: "Suite 2",
      city: "London",
      region: "",
      postalCode: "EC1A 1AA",
      country: "GB",
    },
    socialLinks: [
      { label: "Docs & help", url: "https://example.test/docs?a=1&b=2" },
      { label: "GitHub", url: "https://github.com/example" },
    ],
  },
};

const entry = (
  id: string,
  body: string,
  withPreheader = true,
): string => `/** @jsxImportSource @samva/markup/email */
import { defineTemplate } from "@samva/markup";
import { Email, Section, Columns, Column, Button, Spacer, Divider, Image, Link } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
export default defineTemplate({
  id: "${id}",
  schema: jsonSchema({
    type: "object", additionalProperties: false, required: ["name", "url"],
    properties: { name: { type: "string" }, url: { type: "string" } },
  }),
  fixtures: { basic: { name: "Ada & <Lovelace> — café", url: "https://example.test/open?a=1&b=2" } },
  email: {
    subject: (input) => ${"`Hello ${input.name}`"},
    ${withPreheader ? "preheader: (input) => `Preview for ${input.name}`," : ""}
    body: ${body},
  },
});
`;

const primitiveDefaults = entry(
  "primitive-defaults",
  `(input) => (
  <Email>
    <Section>
      <p>{input.name}</p>
      <Columns><Column>Left</Column><Column>Right</Column></Columns>
      <Button href={input.url} height={44}>Open & view</Button>
      <Spacer height={16} />
      <Divider />
      <Image src="https://assets.example.test/photo.png" alt="Photo & details" />
      <Link href={input.url}>Read more</Link>
    </Section>
  </Email>
)`,
  false,
);

const primitiveStyles = entry(
  "primitive-styles",
  `(input) => (
  <Email lang="ar" dir="rtl" title="Styled & titled" gutter={0} backgroundColor="#f0f9ff" className="font-sans" style={{ paddingTop: 12 }}>
    <Section width={560} align="right" bgcolor="#f0f9ff" className="bg-card text-card-foreground p-4 sm:p-8 rounded" style={{ paddingBottom: 18 }} tableStyle={{ borderCollapse: "separate" }}>
      <h1 className="font-heading text-primary">{input.name}</h1>
      <Columns gap={12} stack={false} width="90%" align="right" className="bg-card" style={{ borderSpacing: 0 }}>
        <Column width="35%" valign="middle" align="right" className="text-primary" style={{ padding: 8 }}>First</Column>
        <Column width={180} valign="bottom" align="center" style={{ backgroundColor: "#ffffff" }}>Second</Column>
      </Columns>
      <Spacer height={0} />
      <Divider color="#075985" thickness={3} className="my-4" style={{ opacity: 0.8 }} />
      <Image src="https://assets.example.test/photo.png" alt="Styled image" width={240} height="120" align="center" className="rounded-lg" style={{ borderRadius: "6px" }} />
      <Link href={input.url} target="_self" rel="nofollow" className="text-primary font-semibold" style={{ textDecoration: "none" }}>Styled link</Link>
    </Section>
    <Section width="80%" align="left" style={{ padding: 6 }}>Percentage band</Section>
    <Section width="480">Pixel band</Section>
  </Email>
)`,
);

const buttons = entry(
  "outlook-buttons",
  `(input) => <Email><Section>
  <Button href={input.url} height={44}>Estimated width</Button>
  <Button href={input.url} width={240} height={48} paddingX={24} backgroundColor="#075985" color="#ffffff" borderRadius={8} borderColor="#082f49" borderWidth={2} fontSize={18} fontFamily="Georgia, serif" align="center" className="rounded-lg" style={{ letterSpacing: "1px" }}>Fixed & bordered</Button>
  <Button href={input.url} height={40} paddingX={10} borderRadius={0} align="right">Square</Button>
  <Button href={input.url}>Without height</Button>
  <Button href={input.url} height={44}><strong>Rich label</strong></Button>
</Section></Email>`,
);

const columns = `/** @jsxImportSource @samva/markup/email */
import { defineTemplate } from "@samva/markup";
import { Email, Section, Columns, Column } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
export default defineTemplate({
  id: "column-options",
  schema: jsonSchema({
    type: "object", additionalProperties: false, required: ["items"],
    properties: { items: { type: "array", items: { type: "string" } } },
  }),
  fixtures: {
    empty: { items: [] }, one: { items: ["One"] },
    odd: { items: ["One", "Two & three", "<Four>", "Café", "五"] },
    even: { items: ["One", "Two", "Three", "Four"] },
  },
  email: {
    subject: () => "Columns & chunks", preheader: () => "",
    body: (input) => <Email><Section width={600}>
      <Columns gap={24}><Column width="40%">Static left</Column><Column>Static right</Column></Columns>
      <Columns gap={0} stack={false}><Column>Zero</Column><Column>gap</Column></Columns>
      <Columns each={input.items}>{(item) => <Column>{item}</Column>}</Columns>
      <Columns each={input.items} per={2}>{(item) => <Column className="bg-card text-card-foreground" style={{ padding: 8 }}>{item}</Column>}</Columns>
      <Columns each={input.items} per={3} stack={false}>{(item) => <Column valign="top">{item}</Column>}</Columns>
      <Columns each={input.items} per={1}>{(item) => <Column width="75%">{item}</Column>}</Columns>
    </Section></Email>,
  },
});`;

const brandEntry = `/** @jsxImportSource @samva/markup/email */
import { defineTemplate } from "@samva/markup";
import { Email, Section } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { BrandLogo, BrandFooter } from "samva:brand";
export default defineTemplate({
  id: "brand-options",
  schema: jsonSchema({ type: "object", additionalProperties: false, properties: {} }),
  fixtures: { basic: {} },
  email: {
    subject: () => "Brand & footer", preheader: () => "Light and dark logos",
    body: () => <Email><Section>
      <BrandLogo />
      <BrandLogo width={120} alt="Custom & logo" align="right" className="rounded" />
      <BrandFooter />
      <BrandFooter unsubscribeLabel="Opt out & preferences" className="text-left" />
    </Section></Email>,
  },
});`;

const project = (source: string): CompileTemplateOptions => ({
  files: { "templates/entry.tsx": source, "theme.css": THEME },
  entry: "templates/entry.tsx",
  assetBase: "https://assets.example.test/baseline",
  tailwind: { css: THEME, cssPath: "theme.css" },
});

export const BUILTIN_BASELINES = [
  {
    name: "primitive-defaults",
    options: {
      ...project(primitiveDefaults),
      tailwind: undefined,
      files: { "templates/entry.tsx": primitiveDefaults },
    },
  },
  { name: "primitive-styles", options: project(primitiveStyles) },
  { name: "outlook-buttons", options: project(buttons) },
  { name: "column-options", options: project(columns) },
  { name: "brand-full", options: { ...project(brandEntry), brand: FULL_BRAND } },
  {
    name: "brand-light",
    options: {
      ...project(brandEntry),
      brand: { ...FULL_BRAND, assets: { logoUrl: FULL_BRAND.assets!.logoUrl } },
    },
  },
  { name: "brand-bare", options: { ...project(brandEntry), brand: { slug: "bare", css: "" } } },
  {
    name: "parity",
    options: { files: PARITY_PROJECT, entry: PARITY_ENTRY, ...PARITY_COMPILE_OPTIONS },
  },
] satisfies readonly { readonly name: string; readonly options: CompileTemplateOptions }[];

// Read authored files as text: neither this loader nor the compiler imports/evaluates a template.
export const starterProject = async (): Promise<Record<string, string>> => {
  const root = new URL("../../../../examples/email-starter/", import.meta.url);
  const entries = await readdir(new URL("templates/", root), {
    recursive: true,
    withFileTypes: true,
  });
  const paths = [
    "theme.css",
    "starter.css",
    ...entries
      .filter((file) => file.isFile() && file.name.endsWith(".tsx"))
      .map((file) => `${relative(fileURLToPath(root), file.parentPath)}/${file.name}`),
  ].sort();
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(new URL(path, root), "utf8")]),
    ),
  );
};
