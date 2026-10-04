/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import {
  Columns,
  Column,
  Divider,
  Email,
  Image,
  Link,
  Section,
  Spacer,
  preheaderNode,
} from "../src/email/components";
import type { EmailNode } from "../src/email/jsx-runtime";
import { deriveEmailText } from "../src/email/text";

const text = (node: EmailNode): string => deriveEmailText(node);

describe("plain-text derivation", () => {
  it("keeps document order and separates blocks", () => {
    expect(
      text(
        <div>
          <h1>Order confirmed</h1>
          <p>
            Thanks, Ada.
            <br />
            Your order ships tomorrow.
          </p>
          <hr />
          <p>Questions?</p>
        </div>,
      ),
    ).toBe("Order confirmed\n\nThanks, Ada.\nYour order ships tomorrow.\n\n---\n\nQuestions?");
  });

  it("drops head metadata and keeps the preheader as the opening line", () => {
    expect(
      text(
        <Email title="Order confirmed">
          {preheaderNode("Ships tomorrow")}
          <p>Thanks, Ada.</p>
        </Email>,
      ),
    ).toBe("Ships tomorrow\n\nThanks, Ada.");
  });

  it("marks unordered, ordered and nested lists", () => {
    expect(
      text(
        <div>
          <ul>
            <li>Book</li>
            <li>
              Pens
              <ul>
                <li>Blue</li>
                <li>Black</li>
              </ul>
            </li>
          </ul>
          <ol start={3}>
            <li>Third</li>
            <li>Fourth</li>
          </ol>
        </div>,
      ),
    ).toBe("- Book\n- Pens\n  - Blue\n  - Black\n\n3. Third\n4. Fourth");
  });

  it("keeps a data table's rows and columns and passes a layout table through", () => {
    expect(
      text(
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Book</td>
              <td>$12</td>
            </tr>
          </tbody>
        </table>,
      ),
    ).toBe("Item | Total\nBook | $12");
    expect(
      text(
        <table>
          <tr>
            <td>
              <img src="https://cdn.example/book.png" alt="" />
            </td>
            <td>Book</td>
            <td>$12</td>
          </tr>
        </table>,
      ),
    ).toBe("Book | $12");
    expect(
      text(
        <table>
          <tr>
            <td>Book</td>
            <td></td>
            <td>$12</td>
          </tr>
        </table>,
      ),
    ).toBe("Book |  | $12");
    expect(
      text(
        <table>
          <tr>
            <td>
              <span>
                <img src="https://cdn.example/book.png" alt="" />
              </span>
            </td>
            <td>Book</td>
          </tr>
        </table>,
      ),
    ).toBe("Book");
    expect(
      text(
        <Columns>
          <Column>Left</Column>
          <Column>Right</Column>
        </Columns>,
      ),
    ).toBe("Left\nRight");
  });

  it("keeps a link's destination and an image's alt text", () => {
    expect(text(<Link href="https://example.com/order">View order</Link>)).toBe(
      "View order (https://example.com/order)",
    );
    expect(text(<a href="https://example.com">https://example.com</a>)).toBe("https://example.com");
    expect(text(<Image src="https://cdn.example.com/a.png" alt="Product photo" />)).toBe(
      "[Product photo]",
    );
    expect(text(<Image src="https://cdn.example.com/a.png" alt="" />)).toBe("");
  });

  it("contributes nothing for spacing scaffolding", () => {
    expect(
      text(
        <Section>
          <p>One</p>
          <Spacer height={24} />
          <Divider />
          <p>Two</p>
        </Section>,
      ),
    ).toBe("One\n\nTwo");
  });

  it("preserves preformatted whitespace and collapses ordinary whitespace", () => {
    expect(text(<pre>{"line one\n  line two"}</pre>)).toBe("line one\n  line two");
    expect(text(<p>{"  spaced    out  "}</p>)).toBe("spaced out");
  });
});
