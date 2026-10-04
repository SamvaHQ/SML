// The parity corpus. This package and Samva's hosted runtime compile exactly these
// files with exactly these options, and both must produce the digests below: the
// hosted runtime keeps its own copy of this corpus and asserts the same golden
// values against the `@samva/markup` it installs. A compiler change that alters
// published output changes these digests deliberately, and the hosted copy moves
// with the release that carries it.

const PARITY_THEME = `@import "./starter.css";
@import "samva:brand";
@theme {
  --color-accent: #0f766e;
}
`;

/** The brand `samva:brand` resolves to in a parity build. Every host passes it. */
const PARITY_BRAND = {
  slug: "parity",
  css: `@font-face {
  font-family: "Parity Display";
  src: url("https://fonts.samva.test/parity-display.woff2") format("woff2");
}
@theme {
  --color-brand: #be123c;
  --font-display: "Parity Display", Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-brand: #fda4af;
  }
}
`,
  assets: {
    logoUrl: "https://assets.samva.test/parity/logo.png",
    logoDarkUrl: "https://assets.samva.test/parity/logo-dark.png",
  },
  footer: {
    companyName: "Parity Ltd",
    address: {
      street1: "1 Parity Way",
      city: "London",
      region: "",
      postalCode: "EC1A 1AA",
      country: "GB",
    },
    socialLinks: [{ label: "GitHub", url: "https://github.com/parity" }],
  },
} as const;

/** Where a parity build serves assets from, its theme, and its brand. Every host passes this. */
export const PARITY_COMPILE_OPTIONS = {
  assetBase: "https://assets.samva.test/parity",
  tailwind: { css: PARITY_THEME },
  brand: PARITY_BRAND,
} as const;

export const PARITY_ENTRY = "emails/receipt.tsx";

/**
 * One project exercising every construct the two hosts have to agree on:
 * imported CSS with a media-query override and a project font, a Tailwind
 * utility discovered from source, an imported asset, a component in another
 * module, and a conditional.
 */
export const PARITY_PROJECT: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({ name: "parity", private: true }),
  "theme.css": PARITY_THEME,
  "starter.css":
    "@theme {\n  --color-brand: #4f46e5;\n  --color-accent: #4338ca;\n  --color-muted: #71717a;\n}\n",
  "fonts/parity-sans.woff2": "wOF2 parity font bytes",
  "styles.css":
    "@font-face{font-family:'Parity Sans';src:url(./fonts/parity-sans.woff2) format('woff2');font-weight:400}.panel{padding:16px;background-color:#f6f6f6;font-family:'Parity Sans', Helvetica, sans-serif}@media (width>=40rem){.panel{padding:32px}}",
  "emails/badge.tsx": `/** @jsxImportSource @samva/markup/email */
export const Badge = ({ label }: { readonly label: string }) => (
  <span className="text-red-500 font-bold">{label}</span>
);
`,
  "emails/receipt.tsx": `/** @jsxImportSource @samva/markup/email */
import "../styles.css";
import { defineTemplate } from "@samva/markup";
import { Email, Section, Button } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { BrandFooter, BrandLogo } from "samva:brand";
import { Badge } from "./badge";

export default defineTemplate({
  id: "parity-receipt",
  schema: jsonSchema<{ name: string; total: string }>({
    type: "object",
    additionalProperties: false,
    required: ["name", "total"],
    properties: { name: { type: "string" }, total: { type: "string" } },
  }),
  fixtures: { basic: { name: "Ada Lovelace", total: "$42.00" } },
  email: {
    subject: (input) => \`Receipt for \${input.name}\`,
    preheader: () => "Your order is confirmed",
    body: (input) => (
      <Email title="Receipt" backgroundColor="#ffffff">
        <Section style={{ padding: 24 }}>
          <BrandLogo width={96} />
          <h1 className="panel font-display text-brand dark:text-brand-dark">Thanks, {input.name}</h1>
          <p className="text-muted">Starter-themed copy</p>
          <p className="text-accent">Project-themed copy</p>
          <p>
            Total <Badge label={input.total} />
          </p>
          {input.total === "$0.00" ? null : (
            <Button href="https://example.com/order" width={200} height={44}>
              View order
            </Button>
          )}
        </Section>
        <BrandFooter />
      </Email>
    ),
  },
});
`,
};

/**
 * SHA-256 of each rendered part. A change here is a change to published output:
 * regenerate deliberately, never to make a test pass.
 */
export const PARITY_DIGESTS = {
  subject: "57d08cb8284aa1a977674a5cbd235e563cfa08817ef31e71adf0b76301792a4d",
  html: "a6fdecd04e2e745c40ad5116c22106ca7478d29b03d8f685dcb2ffaed768f6fb",
  text: "2e6adf328a9e1a8b323e8d091bfbad545161d762b8297fd4b39d544ab8a7f5ec",
} as const;

/**
 * SHA-256 of the compiler's whole output for this project: the IR and the asset manifest. Both
 * hosts compute it from the same call, so a compile that reaches one host and not the other fails
 * on one side.
 */
export const PARITY_COMPILE_DIGEST =
  "c6ca9fea6364f8e98801b627a682d1daaaa34a9d0442b73b965022bde0397b12";

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Digest one rendered part exactly as both hosts must. */
export const parityDigest = async (value: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/** Canonical text for a whole project compile, so both hosts digest one thing. */
export const parityCompileText = (compiled: {
  readonly ir: unknown;
  readonly assets: readonly { readonly path: string; readonly digest: string }[];
}): string =>
  JSON.stringify([compiled.ir, compiled.assets.map((asset) => [asset.path, asset.digest])]);

/** Every part of a render, digested, ready to compare against the golden values. */
export const parityDigests = async (rendered: {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}): Promise<Record<keyof typeof PARITY_DIGESTS, string>> => ({
  subject: await parityDigest(rendered.subject),
  html: await parityDigest(rendered.html),
  text: await parityDigest(rendered.text),
});
