// The harness's Nimbus welcome email: a real `defineTemplate` project the compiled host builds in
// the browser, in place of the mock's hand-built tree. Fixture names match `MOCK_FIXTURE_NAMES`.

export const NIMBUS_ENTRY_FILE = "templates/welcome.tsx";
export const NIMBUS_THEME_FILE = "theme.css";

/** The placeholder logo URL the template names; the compiled host swaps in an inline mark. */
export const NIMBUS_LOGO_URL = "https://assets.nimbus.example/logo.png";

export const NIMBUS_THEME_CSS = `@theme {
  --color-background: #f4ede3;
  --color-foreground: #2b1d14;
  --color-card: #ffffff;
  --color-card-foreground: #2b1d14;
  --color-primary: #b4532a;
  --color-primary-foreground: #fff7ef;
  --color-secondary: #efe4d4;
  --color-secondary-foreground: #2b1d14;
  --color-muted: #f4ede3;
  --color-muted-foreground: #7a6556;
  --color-accent: #f6e3c8;
  --color-accent-foreground: #5a2e12;
  --color-border: #e5d8c6;
  --radius: 10px;
  --font-sans:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: #1a110b;
    --color-foreground: #f3e8da;
    --color-card: #26190f;
    --color-card-foreground: #f3e8da;
    --color-primary: #e0834f;
    --color-primary-foreground: #2a1306;
    --color-secondary: #33231a;
    --color-secondary-foreground: #f3e8da;
    --color-muted: #33231a;
    --color-muted-foreground: #b9a592;
    --color-accent: #3d2616;
    --color-accent-foreground: #f6dcbd;
    --color-border: #3b2a1e;
  }
}
`;

export const NIMBUS_TEMPLATE_TSX = `/** @jsxImportSource @samva/markup/email */
import { defineTemplate } from "@samva/markup";
import { Button, Column, Columns, Divider, Email, Image, Link, Section, Spacer } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "welcome-first-bag",
  schema: jsonSchema<{ firstName: string; claimUrl: string; perks: string[] }>({
    type: "object",
    properties: {
      firstName: { type: "string" },
      claimUrl: { type: "string" },
      perks: { type: "array", items: { type: "string" } },
    },
    required: ["firstName", "claimUrl", "perks"],
    additionalProperties: false,
  }),
  fixtures: {
    welcome: {
      firstName: "Ada",
      claimUrl: "https://nimbus.example/claim/ada",
      perks: ["Single-origin", "Roasted to order", "Free shipping"],
    },
    returning: {
      firstName: "Grace",
      claimUrl: "https://nimbus.example/claim/grace",
      perks: ["Single-origin", "Roasted to order", "Free shipping"],
    },
  },
  email: {
    subject: (input) => \`\${input.firstName}, your first bag is on us\`,
    preheader: () => "Freshly roasted, free shipping, no strings.",
    body: (input) => (
      <Email lang="en">
        <Section width={560} className="px-1 pt-8 pb-5">
          <Image src="${NIMBUS_LOGO_URL}" alt="Nimbus Coffee" width={132} height={32} />
        </Section>
        <Section width={560} className="bg-card rounded-xl px-8 py-10">
          <p className="text-primary m-0 text-[12px] leading-[16px] font-semibold tracking-[1.5px] uppercase">
            Welcome offer
          </p>
          <h1 className="font-heading text-card-foreground mt-3 mb-0 text-[34px] leading-[42px] font-normal">
            {input.firstName}, your first bag is on us
          </h1>
          <p className="text-card-foreground mt-4 mb-0 text-[16px] leading-[26px]">
            We roast in small batches and ship within a day, so every bag lands fresh.
          </p>
          <Spacer height={24} />
          <Button
            href={input.claimUrl}
            height={48}
            paddingX={26}
            borderRadius={8}
            fontSize={15}
            className="rounded-lg"
          >
            Claim your free bag
          </Button>
          <Spacer height={36} />
          <Divider />
          <Spacer height={28} />
          <Columns each={input.perks} per={3}>
            {(perk) => (
              <Column valign="top" className="px-1 pb-2">
                <div className="bg-accent text-accent-foreground rounded-lg px-4 py-4">
                  <p className="m-0 text-[14px] leading-[20px] font-semibold">{perk}</p>
                </div>
              </Column>
            )}
          </Columns>
          <Spacer height={28} />
          <Section className="bg-secondary text-secondary-foreground rounded-lg px-5 py-4">
            <p className="m-0 text-[15px] leading-[22px] font-semibold">Questions? Just reply.</p>
            <p className="mt-1 mb-0 text-[14px] leading-[22px]">
              It reaches the people who roast your coffee, usually within a working day.
            </p>
          </Section>
        </Section>
        <Section width={560} className="px-1 pt-6 pb-10">
          <p className="text-muted-foreground m-0 text-[13px] leading-[20px]">
            You are receiving this because you signed up at nimbus.example.{" "}
            <Link href="https://nimbus.example/preferences" className="text-[13px]">
              Email preferences
            </Link>
          </p>
          <p className="text-muted-foreground mt-3 mb-0 text-[13px] leading-[20px]">
            Nimbus Coffee, 100 Bean Street, Portland, OR
          </p>
        </Section>
      </Email>
    ),
  },
});
`;

/** A small coffee mark and the "Nimbus" wordmark, inline so no image is ever broken. */
export const NIMBUS_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="264" height="64" viewBox="0 0 132 32">' +
    '<rect x="1" y="1" width="30" height="30" rx="8" fill="#b4532a"/>' +
    '<path d="M9 13h12v5a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6z" fill="#fff7ef"/>' +
    '<path d="M21 14.5h1.8a2.2 2.2 0 0 1 0 4.4H21" fill="none" stroke="#fff7ef" stroke-width="1.6"/>' +
    '<path d="M12.5 7.5c-1 1.2 1 2 0 3.5M16.5 7.5c-1 1.2 1 2 0 3.5" fill="none" stroke="#fff7ef" stroke-width="1.4" stroke-linecap="round"/>' +
    '<text x="40" y="22.5" font-family="Georgia, \'Palatino Linotype\', serif" font-size="20" fill="#c2623a">Nimbus</text>' +
    "</svg>",
)}`;
