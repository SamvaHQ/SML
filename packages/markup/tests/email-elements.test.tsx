/* oxlint-disable jsx-a11y/alt-text -- The type-level cases deliberately omit required attributes to prove the intrinsic types reject them. */
/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { serializeEmailHtml } from "../src/email/html";
import { EmailNode } from "../src/email/jsx-runtime";
import { compileEmail } from "../src/email/render";
import { diagnose, diagnosticCodes } from "./fixtures/email-compile";

const element = (
  tag: string,
  props: Record<string, unknown> = {},
  children: EmailNode[] = [],
): EmailNode => EmailNode.Element({ tag, props, children, origins: [], authored: true });

describe("supported HTML subset", () => {
  it("serializes ordinary markup with class, style and data/aria attributes", () => {
    const output = compileEmail(
      <div
        id="hero"
        className="card"
        style={{ backgroundColor: "#ffffff", paddingTop: 12 }}
        data-testid="hero"
        aria-hidden="true"
      >
        <h1 align="center">Welcome</h1>
        <p>
          Hello <strong>Ada</strong>
          <br />
          and friends
        </p>
        <hr />
      </div>,
    );
    expect(output.html).toBe(
      '<div id="hero" class="card" style="background-color:#ffffff;padding-top:12px" data-testid="hero" aria-hidden="true">' +
        '<h1 align="center">Welcome</h1>' +
        "<p>Hello <strong>Ada</strong><br />and friends</p>" +
        "<hr /></div>",
    );
    expect(output.diagnostics).toEqual([]);
  });

  it("accepts the document shell, tables and lists", () => {
    const output = compileEmail(
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Receipt</title>
        </head>
        <body>
          <table role="presentation" width="100%" cellpadding="0">
            <tbody>
              <tr>
                <td align="left" colspan={2}>
                  <ul>
                    <li>One</li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>,
    );
    expect(output.html).toContain('<meta charset="utf-8" />');
    expect(output.html).toContain('<td align="left" colspan="2">');
    expect(output.diagnostics).toEqual([]);
  });

  it("rejects attributes and elements outside the vocabulary at typecheck", () => {
    // @ts-expect-error `script` is not part of the supported vocabulary.
    const script = <script>alert(1)</script>;
    // @ts-expect-error Event handlers are never authorable.
    const handler = <p onClick="steal()">text</p>;
    // @ts-expect-error `alt` is required on every image.
    const image = <img src="https://cdn.example.com/a.png" />;
    // @ts-expect-error `align` is an enumeration, not free text.
    const align = <td align="middle">x</td>;
    // @ts-expect-error `href` is required on every link.
    const link = <a>bare</a>;
    expect([script, handler, image, align, link]).toHaveLength(5);
  });
});

describe("compile diagnostics", () => {
  it("names the unsupported element and keeps its authoring origin", () => {
    const origin = { fileName: "emails/welcome.tsx", lineNumber: 8, columnNumber: 5 };
    const [diagnostic] = diagnose(
      EmailNode.Element({
        tag: "iframe",
        props: {},
        children: [],
        origins: [origin],
        authored: true,
      }),
    );
    expect(diagnostic?.code).toBe("unsupported-element");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("<iframe>");
    expect(diagnostic?.origins).toEqual([origin]);
  });

  it("names the supported attributes when one is not recognized", () => {
    const [diagnostic] = diagnose(element("p", { placeholder: "x" }));
    expect(diagnostic?.code).toBe("unsupported-attribute");
    expect(diagnostic?.message).toContain("data-* and aria-*");
  });

  it.each(["constructor", "toString", "valueOf", "__proto__"])(
    "rejects inherited Object.prototype attribute %s without throwing",
    (name) => {
      const node = element("div", { [name]: "x" });
      expect(() => diagnose(node)).not.toThrow();
      expect(diagnosticCodes(node)).toEqual(["unsupported-attribute"]);
      expect(serializeEmailHtml(node).html).not.toContain(` ${name}=`);
    },
  );

  it("refuses event handlers, unsafe URLs and CSS that leaves the declaration", () => {
    expect(diagnosticCodes(element("p", { onclick: "steal()" }))).toEqual(["event-handler"]);
    expect(diagnosticCodes(element("a", { href: "javascript:steal()" }))).toEqual(["unsafe-url"]);
    expect(diagnosticCodes(element("img", { src: "data:text/html,x", alt: "" }))).toEqual([
      "unsafe-url",
    ]);
    expect(
      diagnosticCodes(element("p", { style: { backgroundImage: "url(javascript:steal())" } })),
    ).toEqual(["unsafe-url"]);
    expect(diagnosticCodes(element("p", { style: { color: "red;position:absolute" } }))).toEqual([
      "unsafe-style-value",
    ]);
  });

  it("accepts a relative reference only for an export, never for delivery", () => {
    const relative = element("img", { src: "./assets/a1b2.png", alt: "" });
    // A delivered message has no directory to resolve a relative path against.
    expect(diagnosticCodes(relative)).toEqual(["unsafe-url"]);
    expect(diagnose(relative)[0]?.message).toContain("only in an export");
    // An export serves its assets from a base beside the file.
    expect(serializeEmailHtml(relative, { relativeUrls: true }).diagnostics).toEqual([]);
    expect(
      serializeEmailHtml(element("img", { src: "/assets/a1b2.png", alt: "" }), {
        relativeUrls: true,
      }).diagnostics,
    ).toEqual([]);
    // Protocol-relative inherits a scheme the message does not control.
    expect(
      serializeEmailHtml(element("img", { src: "//cdn.example.com/a.png", alt: "" }), {
        relativeUrls: true,
      }).diagnostics.map((finding) => finding.code),
    ).toEqual(["unsafe-url"]);
  });

  it("keeps an https background image", () => {
    const output = compileEmail(
      <div style={{ backgroundImage: "url(https://cdn.example.com/hero.png)" }}>x</div>,
    );
    expect(output.html).toContain("background-image:url(https://cdn.example.com/hero.png)");
  });

  it("reports required attributes, void children and enumerations", () => {
    expect(diagnosticCodes(element("a", {}))).toEqual(["missing-attribute"]);
    expect(diagnosticCodes(element("br", {}, [EmailNode.Text({ value: "x" })]))).toEqual([
      "void-element-children",
    ]);
    expect(diagnosticCodes(element("td", { align: "middle" }))).toEqual([
      "invalid-attribute-value",
    ]);
  });

  it("reports a content model an email client would not survive", () => {
    expect(
      diagnosticCodes(
        <ul>
          <p>Loose</p>
        </ul>,
      ),
    ).toEqual(["invalid-content"]);
    expect(diagnosticCodes(element("p", { class: "a", className: "b" }))).toEqual([
      "duplicate-attribute",
    ]);
  });

  it("escapes text, attributes and never treats an input string as markup", () => {
    const output = compileEmail(
      <p title={`quote " and '`}>{"<img src=x onerror=alert(1)> & <b>bold</b>"}</p>,
    );
    expect(output.html).toBe(
      '<p title="quote &quot; and &#39;">&lt;img src=x onerror=alert(1)&gt; &amp; &lt;b&gt;bold&lt;/b&gt;</p>',
    );
  });
});
