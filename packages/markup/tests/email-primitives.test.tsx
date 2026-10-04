/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

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
} from "../src/email/components";
import { jsxDEV } from "../src/email/jsx-dev-runtime";
import type { EmailNode } from "../src/email/jsx-runtime";
import { compileEmail, EMAIL_DOCTYPE } from "../src/email/render";
import { corpusTemplate, diagnose } from "./fixtures/email-compile";
import { renderEmail } from "./support/email-fixture";

const html = (node: EmailNode): string => compileEmail(node).html;
const rawHtml = (node: EmailNode): string => {
  if (node.type === "Raw") return node.html;
  if (node.type === "Text") return "";
  return node.children.map(rawHtml).join("");
};

describe("document shell", () => {
  it("emits the head every target client needs and the Outlook DPI block", () => {
    const output = html(<Email title="Receipt">body</Email>);
    expect(output).toContain('<html lang="en" dir="ltr"');
    expect(output).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"');
    expect(output).toContain('<meta charset="utf-8" />');
    expect(output).toContain('<meta name="x-apple-disable-message-reformatting" />');
    expect(output).toContain('<meta name="color-scheme" content="light dark" />');
    expect(output).toContain("<title>Receipt</title>");
    expect(output).toContain("<!--[if mso]><xml><o:OfficeDocumentSettings>");
  });

  it("hides the preheader and pads it so the client cannot borrow body copy", () => {
    const output = renderEmail(
      corpusTemplate<Record<string, never>>({ type: "object" }, () => ({
        subject: "Receipt",
        preheader: "Your order shipped",
        body: <Email>body</Email>,
      })),
      {},
    ).html;
    expect(output).toContain('data-samva-preheader="Your order shipped"');
    expect(output).toContain("display:none;overflow:hidden;line-height:1px;opacity:0");
    expect(output).toContain("data-samva-preheader-padding");
  });

  it("puts the document under the transitional doctype a full render emits", () => {
    const rendered = renderEmail(
      corpusTemplate<Record<string, never>>({ type: "object" }, () => ({
        subject: "Receipt",
        body: <Email>body</Email>,
      })),
      {},
    );
    expect(rendered.html.startsWith(EMAIL_DOCTYPE)).toBe(true);
  });

  it("injects the content preheader into the body when the shell does not declare one", () => {
    const rendered = renderEmail(
      corpusTemplate<Record<string, never>>({ type: "object" }, () => ({
        subject: "Receipt",
        preheader: "From the content",
        body: <Email>body</Email>,
      })),
      {},
    );
    expect(rendered.html).toContain('<body style="margin:0;padding:0"><div data-samva-preheader=');
  });
});

describe("layout primitives", () => {
  it("lowers a section to the single-cell presentation table", () => {
    expect(html(<Section style={{ padding: 24 }}>Body</Section>)).toBe(
      '<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" width="100%">' +
        '<tbody><tr><td style="padding:24px">Body</td></tr></tbody></table>',
    );
  });

  it("lowers columns to one row of cells without any flex or grid conversion", () => {
    const output = html(
      <Columns>
        <Column width="50%">Left</Column>
        <Column width="50%" align="right">
          Right
        </Column>
      </Columns>,
    );
    expect(output).toContain('<tr style="width:100%"><td width="50%">Left</td>');
    expect(output).toContain('<td align="right" width="50%">Right</td>');
    expect(output.match(/<tr/g)).toHaveLength(1);
  });

  it("keeps spacers and dividers as cells rather than margins", () => {
    expect(html(<Spacer height={24} />)).toContain(
      '<td height="24" style="height:24px;line-height:24px;font-size:1px">',
    );
    expect(html(<Divider color="#cccccc" thickness={2} />)).toContain(
      "border-top:2px solid #cccccc",
    );
  });
});

describe("content primitives", () => {
  it("sizes an image with attributes Outlook reads before CSS", () => {
    const output = html(
      <Image src="https://cdn.example.com/a.png" alt="Product" width={200} height={100} />,
    );
    expect(output).toBe(
      '<img src="https://cdn.example.com/a.png" alt="Product" border="0" width="200" height="100"' +
        ' style="display:block;outline:none;border:none;text-decoration:none;max-width:100%" />',
    );
  });

  it("opens links outside the client without reaching back at the opener", () => {
    expect(html(<Link href="https://example.com/help">Help</Link>)).toBe(
      '<a href="https://example.com/help" target="_blank" rel="noopener noreferrer"' +
        ' style="color:#067df7;text-decoration:none">Help</a>',
    );
  });

  it("draws the classic Outlook button in VML and hides the anchor from it", () => {
    const output = html(
      <Button
        href="https://example.com/order"
        width={200}
        height={44}
        borderRadius={6}
        backgroundColor="#111111"
      >
        View order
      </Button>,
    );
    expect(output).toContain("<!--[if mso]><v:roundrect");
    expect(output).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(output).toContain('href="https://example.com/order"');
    expect(output).toContain('arcsize="14%"');
    expect(output).toContain('fillcolor="#111111"');
    expect(output).toContain("<w:anchorlock/>");
    expect(output).toContain("mso-hide:all");
  });

  it.each(["width", "height", "paddingX", "borderRadius", "borderWidth", "fontSize"] as const)(
    "rejects a non-numeric Button %s before constructing raw VML",
    (name) => {
      const injection = '1--><img src="x" onerror="steal()">';
      // A JavaScript caller can pass a string where the type demands a number.
      const props = Object.defineProperty(
        { href: "https://example.com/order", height: 44, children: "View order" },
        name,
        { value: injection, enumerable: true },
      );
      const node = Button(props);

      expect(rawHtml(node)).not.toContain(injection);
      expect(diagnose(node).some((diagnostic) => diagnostic.code === "invalid-button-number")).toBe(
        true,
      );
    },
  );

  it("rejects a zero Button height before constructing invalid VML", () => {
    const node = (
      <Button href="https://example.com/order" height={0}>
        View order
      </Button>
    );

    expect(rawHtml(node)).not.toContain("v:roundrect");
    expect(rawHtml(node)).not.toMatch(/NaN|Infinity/);
    expect(diagnose(node).some((diagnostic) => diagnostic.code === "invalid-button-number")).toBe(
      true,
    );
  });

  it("sizes the Outlook shape from the label when no width fixes the box", () => {
    const output = html(
      <Button href="https://example.com/order" height={40} fontSize={12}>
        Dashboard gallery QA
      </Button>,
    );
    // 20 glyphs at 12px bold, plus 16px of padding on each side.
    expect(output).toContain("v-text-anchor:middle;width:176px;");
    expect(output).toContain("padding:0 16px");
    expect(output).not.toContain("width:120px");
    expect(
      diagnose(
        <Button href="https://example.com/order" height={40}>
          Go
        </Button>,
      ),
    ).toEqual([]);
  });

  it("warns instead of guessing when the Outlook fallback cannot be drawn", () => {
    const findings = diagnose(<Button href="https://example.com/order">View order</Button>);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("button-outlook-fallback");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.clients).toEqual(["outlook-windows"]);
    expect(html(<Button href="https://example.com/order">View order</Button>)).not.toContain(
      "v:roundrect",
    );
  });
});

describe("generated wrappers keep the authoring origin", () => {
  const origins = (node: EmailNode): readonly { tag: string; origins: readonly unknown[] }[] => {
    if (node.type === "Text" || node.type === "Raw") return [];
    if (node.type === "Fragment") return node.children.flatMap(origins);
    return [{ tag: node.tag, origins: node.origins }, ...node.children.flatMap(origins)];
  };

  it("points every table a primitive generates at the element that asked for it", () => {
    const section = { fileName: "emails/welcome.tsx", lineNumber: 12, columnNumber: 3 };
    const paragraph = { fileName: "emails/welcome.tsx", lineNumber: 13, columnNumber: 5 };
    const tree = jsxDEV(
      Section,
      { children: jsxDEV("p", { children: "Hi" }, undefined, false, paragraph) },
      undefined,
      false,
      section,
    );
    const mapped = origins(tree);
    expect(mapped.map((entry) => entry.tag)).toEqual(["table", "tbody", "tr", "td", "p"]);
    for (const entry of mapped.slice(0, 4)) expect(entry.origins).toEqual([section]);
    expect(mapped.at(-1)?.origins).toEqual([paragraph]);
  });

  it("chains origins from the inner primitive out to each enclosing call site", () => {
    const card = { fileName: "emails/card.tsx", lineNumber: 4, columnNumber: 3 };
    const section = { fileName: "emails/card.tsx", lineNumber: 5, columnNumber: 5 };
    const Card = () => jsxDEV(Section, { children: "Hi" }, undefined, false, section);
    const tree = jsxDEV(Card, {}, undefined, false, card);
    expect(origins(tree)[0]?.origins).toEqual([section, card]);
  });
});
