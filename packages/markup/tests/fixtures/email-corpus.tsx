/** @jsxImportSource @samva/markup/email */
import {
  Button,
  Column,
  Columns,
  Divider,
  Email,
  Image,
  Link,
  Section,
  Spacer,
} from "../../src/email/components";
import type { TemplateDefinition } from "../support/email-fixture";
import { corpusTemplate } from "./email-compile";

// The maintained email corpus: one transactional layout and one marketing
// layout, each exercising nested components, repeated rows, conditional
// branches, links, images, responsive-ready widths and plain-text derivation.
// The compatibility lane renders the same corpus, so a new construct is added
// here once.

interface ReceiptItem {
  readonly name: string;
  readonly quantity: number;
  readonly total: string;
}

export interface ReceiptInput {
  readonly customer: { readonly name: string };
  readonly orderId: string;
  readonly items: readonly ReceiptItem[];
  readonly discount?: string;
  readonly orderUrl: string;
}

const receiptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["customer", "orderId", "items", "orderUrl"],
  properties: {
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string" } },
    },
    orderId: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "total"],
        properties: {
          name: { type: "string" },
          quantity: { type: "integer" },
          total: { type: "string" },
        },
      },
    },
    discount: { type: "string" },
    orderUrl: { type: "string" },
  },
} satisfies Record<string, unknown>;

const ItemRow = ({ item }: { readonly item: ReceiptItem }) => (
  <tr>
    <td align="left">{item.name}</td>
    <td align="center">{item.quantity}</td>
    <td align="right">{item.total}</td>
  </tr>
);

export const receipt: TemplateDefinition<ReceiptInput> = corpusTemplate<ReceiptInput>(
  receiptSchema,
  (input) => ({
    subject: `Order ${input.orderId} confirmed`,
    preheader: `Thanks ${input.customer.name}, your order is confirmed`,
    body: (
      <Email title={`Order ${input.orderId}`} backgroundColor="#f6f6f6">
        <Section style={{ padding: 24, backgroundColor: "#ffffff" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Thanks, {input.customer.name}</h1>
          <p>
            Order <strong>{input.orderId}</strong> is confirmed.
          </p>
          <table width="100%" cellpadding="8">
            <thead>
              <tr>
                <th align="left">Item</th>
                <th align="center">Qty</th>
                <th align="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {input.items.map((item) => (
                <ItemRow key={item.name} item={item} />
              ))}
            </tbody>
          </table>
          {input.discount === undefined ? null : (
            <p style={{ color: "#047857" }}>Discount applied: {input.discount}</p>
          )}
          <Spacer height={24} />
          <Button href={input.orderUrl} width={220} height={44} borderRadius={6}>
            View your order
          </Button>
          <Divider />
          <p style={{ fontSize: 12, color: "#6b7280" }}>
            Questions? <Link href="https://example.com/support">Talk to us</Link>
          </p>
        </Section>
      </Email>
    ),
  }),
  "corpus-receipt",
);

interface Article {
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly tags: readonly string[];
}

export interface NewsletterInput {
  readonly headline: string;
  readonly heroImage: string;
  readonly articles: readonly Article[];
  readonly showOffer: boolean;
  readonly unsubscribeUrl: string;
}

const newsletterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "heroImage", "articles", "showOffer", "unsubscribeUrl"],
  properties: {
    headline: { type: "string" },
    heroImage: { type: "string" },
    articles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "url", "tags"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          url: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    showOffer: { type: "boolean" },
    unsubscribeUrl: { type: "string" },
  },
} satisfies Record<string, unknown>;

const ArticleColumn = ({ article }: { readonly article: Article }) => (
  <Column width="50%" valign="top" style={{ padding: 12 }}>
    <h2 style={{ fontSize: 18, margin: 0 }}>
      <Link href={article.url}>{article.title}</Link>
    </h2>
    <p>{article.summary}</p>
    <ul>
      {article.tags.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
  </Column>
);

export const newsletter: TemplateDefinition<NewsletterInput> = corpusTemplate<NewsletterInput>(
  newsletterSchema,
  (input) => ({
    subject: input.headline,
    preheader: input.headline,
    body: (
      <Email title={input.headline} backgroundColor="#111827">
        <Section style={{ padding: 0 }}>
          <Image src={input.heroImage} alt={input.headline} width={600} height={200} />
        </Section>
        <Section style={{ padding: 16, backgroundColor: "#ffffff" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>{input.headline}</h1>
          {input.showOffer ? (
            <p style={{ backgroundColor: "#fef3c7", padding: 12 }}>Members save 20% this week.</p>
          ) : null}
          <Columns>
            {input.articles.map((article) => (
              <ArticleColumn key={article.url} article={article} />
            ))}
          </Columns>
          <Divider />
          <p style={{ fontSize: 12 }}>
            <Link href={input.unsubscribeUrl}>Unsubscribe</Link>
          </p>
        </Section>
      </Email>
    ),
  }),
  "corpus-newsletter",
);

/** Fixture data covering typical, empty, long and non-Latin input. */
export const receiptFixtures = {
  typical: {
    customer: { name: "Ada Lovelace" },
    orderId: "A-1001",
    items: [
      { name: "Analytical Engine", quantity: 1, total: "$1,200.00" },
      { name: "Punch cards", quantity: 250, total: "$25.00" },
    ],
    discount: "WELCOME10",
    orderUrl: "https://example.com/orders/A-1001",
  },
  empty: {
    customer: { name: "" },
    orderId: "A-0",
    items: [],
    orderUrl: "https://example.com/orders/A-0",
  },
  escaping: {
    customer: { name: '<script>alert("x")</script> & "friends"' },
    orderId: "A-<b>2</b>",
    items: [{ name: "Tea & biscuits", quantity: 2, total: "£4.50" }],
    orderUrl: "https://example.com/orders/A-2?a=1&b=2",
  },
  unicode: {
    customer: { name: "田中 さくら" },
    orderId: "A-1002",
    items: [
      { name: "お茶", quantity: 3, total: "¥1,200" },
      { name: "מוצר בעברית", quantity: 1, total: "₪30" },
    ],
    orderUrl: "https://example.com/orders/A-1002",
  },
  long: {
    customer: { name: "Ada ".repeat(40).trim() },
    orderId: "A-1003",
    items: Array.from({ length: 25 }, (_, index) => ({
      name: `Item ${index + 1} ${"with a long descriptive name ".repeat(3)}`,
      quantity: index + 1,
      total: `$${index + 1}.00`,
    })),
    orderUrl: "https://example.com/orders/A-1003",
  },
} as const satisfies Record<string, ReceiptInput>;

export const newsletterFixtures = {
  typical: {
    headline: "This week in engineering",
    heroImage: "https://cdn.example.com/hero.png",
    articles: [
      {
        title: "Shipping faster",
        summary: "How we cut our deploy time in half.",
        url: "https://example.com/posts/shipping-faster",
        tags: ["delivery", "tooling"],
      },
      {
        title: "Reading the logs",
        summary: "A short guide to our tracing conventions.",
        url: "https://example.com/posts/reading-the-logs",
        tags: ["observability"],
      },
    ],
    showOffer: true,
    unsubscribeUrl: "https://example.com/unsubscribe?token=abc",
  },
  empty: {
    headline: "Quiet week",
    heroImage: "https://cdn.example.com/hero.png",
    articles: [],
    showOffer: false,
    unsubscribeUrl: "https://example.com/unsubscribe?token=def",
  },
} as const satisfies Record<string, NewsletterInput>;
