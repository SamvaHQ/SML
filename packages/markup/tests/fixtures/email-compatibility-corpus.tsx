/** @jsxImportSource @samva/markup/email */
import { Button, Column, Columns, Email, Image, Link, Section } from "../../src/email/components";
import type { SerializeEmailOptions } from "../../src/email/html";
import type { RenderedEmail } from "../../src/email/render";
import { renderEmail, type TemplateDefinition } from "../support/email-fixture";
import { corpusTemplate } from "./email-compile";
import { newsletter, newsletterFixtures, receipt, receiptFixtures } from "./email-corpus";

// The compatibility corpus. Each case exists to stress one thing a client is
// known to get wrong, and each is rendered twice: once for a browser, once for
// an inbox.
//
// The two audiences differ in one way that matters. A file opened from disk can
// resolve a relative asset base; a mail client cannot resolve anything but an
// absolute URL, and it will not fetch a `file:` path. So a case that imports a
// local binary is browser-only by construction, and every emailable case
// references images by external https URL — the recorded-not-fetched path.

export interface CorpusCase {
  readonly id: string;
  readonly title: string;
  /** What this case is here to stress. */
  readonly stresses: string;
  /**
   * `false` when the case cannot be sent: it depends on a locally imported
   * asset, which only resolves against a relative base on disk.
   */
  readonly emailable: boolean;
  /** Renders this case's template; the template validates `input` against its schema. */
  readonly render: (input: unknown, options: SerializeEmailOptions) => RenderedEmail;
  readonly input: unknown;
}

const renders =
  <Input,>(template: TemplateDefinition<Input>): CorpusCase["render"] =>
  (input, options) =>
    renderEmail(template, input, options);

// ── Responsive and dark, the two things a static check cannot settle ──────────

interface CampaignInput {
  readonly headline: string;
  readonly body: string;
  readonly ctaUrl: string;
}

const campaignSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "body", "ctaUrl"],
  properties: {
    headline: { type: "string" },
    body: { type: "string" },
    ctaUrl: { type: "string" },
  },
} satisfies Record<string, unknown>;

/**
 * Utility classes only: the stylesheet comes from the real Tailwind compiler at
 * render time, so what a client receives here is what the compiler actually
 * emits for `sm:` and `dark:`.
 */
export const CAMPAIGN_CLASSES = [
  "p-6",
  "sm:p-10",
  "text-slate-900",
  "dark:text-slate-100",
  "bg-white",
  "dark:bg-slate-900",
  "text-lg",
  "font-bold",
  "text-center",
] as const;

const campaign: TemplateDefinition<CampaignInput> = corpusTemplate<CampaignInput>(
  campaignSchema,
  (input) => ({
    subject: input.headline,
    preheader: input.body.slice(0, 80),
    body: (
      <Email title={input.headline} backgroundColor="#ffffff">
        <Section style={{ padding: 0 }}>
          <div className="bg-white p-6 sm:p-10 dark:bg-slate-900">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {input.headline}
            </h1>
            <p className="text-slate-900 dark:text-slate-100">{input.body}</p>
            <Columns>
              <Column width="50%">
                <p className="text-center">Left column</p>
              </Column>
              <Column width="50%">
                <p className="text-center">Right column</p>
              </Column>
            </Columns>
            <Button href={input.ctaUrl} width={220} height={44} borderRadius={6}>
              Read the update
            </Button>
            <p>
              <Link href={input.ctaUrl}>Or open it in a browser</Link>
            </p>
          </div>
        </Section>
      </Email>
    ),
  }),
  "corpus-campaign",
);

// ── The browser-only case ────────────────────────────────────────────────────

interface BrandedInput {
  readonly name: string;
  /** Resolved by the compiler from a locally imported binary. */
  readonly logoUrl: string;
}

const brandedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "logoUrl"],
  properties: { name: { type: "string" }, logoUrl: { type: "string" } },
} satisfies Record<string, unknown>;

/**
 * The only case that depends on a locally imported asset. Its image resolves
 * against the export's relative base, which no mail client can follow, so it is
 * rendered for the browser set and never sent.
 */
const branded: TemplateDefinition<BrandedInput> = corpusTemplate<BrandedInput>(
  brandedSchema,
  (input) => ({
    subject: `Welcome, ${input.name}`,
    body: (
      <Email title="Welcome">
        <Section style={{ padding: 24 }}>
          <Image src={input.logoUrl} alt="Samva" width={120} height={40} />
          <h1>Welcome, {input.name}</h1>
          <p>This message carries an image imported from the project itself.</p>
        </Section>
      </Email>
    ),
  }),
  "corpus-branded",
);

const campaignInput: CampaignInput = {
  headline: "What shipped this month",
  body: "A responsive layout that stacks on a phone, and a dark palette for clients that honor one.",
  ctaUrl: "https://example.com/changelog",
};

/** Every case, in the order the record lists them. */
export const COMPATIBILITY_CORPUS: readonly CorpusCase[] = [
  {
    id: "transactional-typical",
    title: "Transactional receipt",
    stresses:
      "repeated data rows, a conditional block, a data table, a VML button and links, plus the derived plain text",
    emailable: true,
    render: renders(receipt),
    input: receiptFixtures.typical,
  },
  {
    id: "transactional-empty",
    title: "Transactional receipt, empty data",
    stresses: "an empty repeated collection and an absent conditional block",
    emailable: true,
    render: renders(receipt),
    input: receiptFixtures.empty,
  },
  {
    id: "transactional-unicode",
    title: "Transactional receipt, non-Latin data",
    stresses: "CJK, Hebrew and currency symbols through both the HTML and the text part",
    emailable: true,
    render: renders(receipt),
    input: receiptFixtures.unicode,
  },
  {
    id: "transactional-long",
    title: "Transactional receipt, long data",
    stresses: "twenty-five repeated rows and long unbroken strings",
    emailable: true,
    render: renders(receipt),
    input: receiptFixtures.long,
  },
  {
    id: "marketing-typical",
    title: "Marketing newsletter",
    stresses: "an external https hero image, side-by-side columns and nested lists",
    emailable: true,
    render: renders(newsletter),
    input: newsletterFixtures.typical,
  },
  {
    id: "marketing-quiet",
    title: "Marketing newsletter, nothing to say",
    stresses: "an empty column row and an absent promotional block",
    emailable: true,
    render: renders(newsletter),
    input: newsletterFixtures.empty,
  },
  {
    id: "campaign-responsive-dark",
    title: "Responsive and dark campaign",
    stresses:
      "Tailwind utilities compiled by the pinned release: a stacking breakpoint and a dark-scheme palette, both retained in <head>",
    emailable: true,
    render: renders(campaign),
    input: campaignInput,
  },
  {
    id: "branded-local-asset",
    title: "Locally imported asset",
    stresses: "a content-addressed asset resolved against a relative export base",
    emailable: false,
    render: renders(branded),
    input: { name: "Ada", logoUrl: "" },
  },
];
