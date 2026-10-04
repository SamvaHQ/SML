/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { newsletter, newsletterFixtures, receipt, receiptFixtures } from "./fixtures/email-corpus";
import { renderEmail } from "./support/email-fixture";

describe("transactional corpus", () => {
  it("renders repeated rows, a conditional branch and the call to action in reading order", () => {
    const rendered = renderEmail(receipt, receiptFixtures.typical);
    expect(rendered.subject).toBe("Order A-1001 confirmed");
    expect(rendered.preheader).toBe("Thanks Ada Lovelace, your order is confirmed");
    const order = [
      "Thanks, Ada Lovelace",
      "Analytical Engine",
      "Punch cards",
      "Discount applied: WELCOME10",
      "View your order",
      "Talk to us",
    ].map((fragment) => rendered.html.indexOf(fragment));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(rendered.diagnostics).toEqual([]);
  });

  it("omits the conditional branch and repeated rows when the data does not have them", () => {
    const rendered = renderEmail(receipt, receiptFixtures.empty);
    expect(rendered.html).not.toContain("Discount applied");
    expect(rendered.html).not.toContain("Analytical Engine");
    expect(rendered.html).toContain("<tbody></tbody>");
  });

  it("escapes input in text, attributes and URLs without producing markup", () => {
    const rendered = renderEmail(receipt, receiptFixtures.escaping);
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(rendered.html).toContain('href="https://example.com/orders/A-2?a=1&amp;b=2"');
    expect(rendered.html).toContain("Tea &amp; biscuits");
    expect(rendered.text).toContain('<script>alert("x")</script> & "friends"');
  });

  it("carries non-Latin data through both parts unchanged", () => {
    const rendered = renderEmail(receipt, receiptFixtures.unicode);
    expect(rendered.html).toContain("田中 さくら");
    expect(rendered.html).toContain("מוצר בעברית");
    expect(rendered.text).toContain("お茶 | 3 | ¥1,200");
  });

  it("keeps long repeated data complete", () => {
    const rendered = renderEmail(receipt, receiptFixtures.long);
    // 25 item rows and the header row, plus one row per generated wrapper
    // table (shell, section, spacer, button, divider).
    expect(rendered.html.match(/<tr>/g)).toHaveLength(31);
    expect(rendered.text).toContain("Item 25");
  });

  it("derives plain text that reads the same order as the HTML", () => {
    const rendered = renderEmail(receipt, receiptFixtures.typical);
    expect(rendered.text).toBe(
      [
        "Thanks Ada Lovelace, your order is confirmed",
        "",
        "Thanks, Ada Lovelace",
        "",
        "Order A-1001 is confirmed.",
        "",
        "Item | Qty | Total",
        "Analytical Engine | 1 | $1,200.00",
        "Punch cards | 250 | $25.00",
        "",
        "Discount applied: WELCOME10",
        "",
        "View your order (https://example.com/orders/A-1001)",
        "",
        "Questions? Talk to us (https://example.com/support)",
      ].join("\n"),
    );
  });
});

describe("marketing corpus", () => {
  it("renders a hero image, repeated columns and nested lists", () => {
    const rendered = renderEmail(newsletter, newsletterFixtures.typical);
    expect(rendered.html).toContain('<img src="https://cdn.example.com/hero.png"');
    expect(rendered.html).toContain("Members save 20% this week.");
    expect(rendered.html.match(/<td valign="top"/g)).toHaveLength(2);
    expect(rendered.html).toContain("<li>observability</li>");
    expect(rendered.diagnostics).toEqual([]);
  });

  it("renders the quiet week without the offer or any column", () => {
    const rendered = renderEmail(newsletter, newsletterFixtures.empty);
    expect(rendered.html).not.toContain("Members save");
    expect(rendered.html).toContain('<tr style="width:100%"></tr>');
    expect(rendered.text).toBe(
      [
        "Quiet week",
        "",
        "[Quiet week]",
        "",
        "Quiet week",
        "",
        "Unsubscribe (https://example.com/unsubscribe?token=def)",
      ].join("\n"),
    );
  });

  it("refuses input that does not match the declared schema", () => {
    expect(() =>
      renderEmail(newsletter, { ...newsletterFixtures.typical, showOffer: "yes" }),
    ).toThrow("Invalid template input");
  });
});
