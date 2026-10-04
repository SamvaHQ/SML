/* oxlint-disable samva/no-try-catch-or-throw, samva/no-hand-rolled-object-guard, samva/no-unsafe-type-assertion -- The helpers observe IrRenderError diagnostics, and adversarial cases deliberately feed malformed IR. */
import { describe, expect, it } from "@effect/vitest";

import type { BrandPlugin } from "../src/email/brand-plugin";
import { serializeEmailHtml } from "../src/email/html";
import { jsx, type EmailChild } from "../src/email/jsx-runtime";
import { renderEmailContent } from "../src/email/render";
import { deriveEmailText } from "../src/email/text";
import { createFmt } from "../src/fmt";
import type {
  IrElement,
  IrEmail,
  IrNode,
  IrPredicate,
  IrStyle,
  IrValue,
  TemplateIr,
} from "../src/ir";
import { IrRenderError, renderIr, renderIrSms } from "../src/render-ir";

// ── Helpers ───────────────────────────────────────────────────────────────────

const tpl = (
  body: IrNode,
  email: Partial<IrEmail> = {},
  extra: Partial<TemplateIr> = {},
): TemplateIr => ({
  sml: 1,
  template: "t",
  schema: {},
  email: { subject: "S", body, ...email },
  ...extra,
});

const html = (body: IrNode, input: unknown = {}, options = {}): string =>
  renderIr(tpl(body), input, options).html;

const el = (
  tag: string,
  attrs: Record<string, IrValue> = {},
  ...children: IrNode[]
): IrElement => ({ el: tag, attrs, children });

const bind = (path: string): IrValue => ({ bind: path });

const codes = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof IrRenderError) return error.diagnostics.map((item) => item.code);
    throw error;
  }
  return [];
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

// ── Basics ────────────────────────────────────────────────────────────────────

describe("renderIr basics", () => {
  it("reads bound values and escapes them as text", () => {
    expect(html(el("p", {}, bind("name")), { name: "Ada <b>&" })).toBe("<p>Ada &lt;b&gt;&amp;</p>");
    expect(
      html(el("p", {}, bind("order.customer.name")), { order: { customer: { name: "X" } } }),
    ).toBe("<p>X</p>");
    expect(html(el("p", {}, bind("items.1")), { items: ["a", "b"] })).toBe("<p>b</p>");
    expect(html(el("p", {}, bind("missing.deeper")), {})).toBe("<p></p>");
  });

  it("renders bare values by type", () => {
    expect(html(el("p", {}, "a", 3, 1.5, true, false, null, bind("n")), { n: 0 })).toBe(
      "<p>a31.50</p>",
    );
  });

  it("concatenates text and skips null, undefined and booleans", () => {
    const value: IrValue = { concat: ["Hi ", bind("name"), null, true, bind("nope"), " #", 7] };
    expect(html(el("p", {}, value), { name: "Ada" })).toBe("<p>Hi Ada #7</p>");
  });

  it("selects with if/else nodes and value-ifs", () => {
    const node: IrNode = {
      if: { present: "vip" },
      then: [el("b", {}, "VIP")],
      else: [el("i", {}, "regular")],
    };
    expect(html(el("p", {}, node), { vip: true })).toBe("<p><b>VIP</b></p>");
    expect(html(el("p", {}, node), { vip: "" })).toBe("<p><i>regular</i></p>");
    expect(html(el("p", {}, { if: { present: "vip" }, then: [] }), {})).toBe("<p></p>");
    const value: IrValue = { if: { present: "vip" }, then: "yes", else: "no" };
    expect(html(el("p", {}, value), { vip: 1 })).toBe("<p>yes</p>");
    expect(html(el("p", {}, value), {})).toBe("<p>no</p>");
  });

  it("repeats each with an item and an index", () => {
    const body = el(
      "ul",
      {},
      {
        each: bind("items"),
        as: "item",
        index: "i",
        children: [
          el("li", {}, { concat: [{ op: "+", args: [bind("$i"), 1] }, ". ", bind("$item.title")] }),
        ],
      },
    );
    expect(html(body, { items: [{ title: "A" }, { title: "B<" }] })).toBe(
      "<ul><li>1. A</li><li>2. B&lt;</li></ul>",
    );
    expect(html(body, { items: [] })).toBe("<ul></ul>");
  });

  it("accepts loop names written with the $ prefix", () => {
    const body = el(
      "p",
      {},
      {
        each: bind("xs"),
        as: "$x",
        index: "$n",
        children: [bind("$x"), bind("$n")],
      },
    );
    expect(html(body, { xs: ["a", "b"] })).toBe("<p>a0b1</p>");
  });

  it("scopes nested each and lets inner code read the outer variable", () => {
    const body = el(
      "div",
      {},
      {
        each: bind("rows"),
        as: "row",
        children: [
          el(
            "p",
            {},
            {
              each: bind("$row.cells"),
              as: "cell",
              children: [{ concat: [bind("$row.name"), ":", bind("$cell")] }, ","],
            },
          ),
        ],
      },
    );
    expect(
      html(body, {
        rows: [
          { name: "r1", cells: [1, 2] },
          { name: "r2", cells: [3] },
        ],
      }),
    ).toBe("<div><p>r1:1,r1:2,</p><p>r2:3,</p></div>");
  });

  it("does not leak loop variables outside the loop", () => {
    const body = el("p", {}, { each: bind("xs"), as: "x", children: ["."] }, bind("$x"));
    expect(html(body, { xs: [1] })).toBe("<p>.</p>");
  });

  it("evaluates arithmetic, length and comparisons", () => {
    const text = (value: IrValue, input: unknown = {}) => html(el("p", {}, value), input);
    expect(text({ op: "+", args: [2, 3] })).toBe("<p>5</p>");
    expect(text({ op: "-", args: [2, 3] })).toBe("<p>-1</p>");
    expect(text({ op: "*", args: [bind("n"), 4] }, { n: 2.5 })).toBe("<p>10</p>");
    expect(text({ op: "/", args: [9, 2] })).toBe("<p>4.5</p>");
    expect(text({ op: "%", args: [9, 4] })).toBe("<p>1</p>");
    expect(text({ length: bind("s") }, { s: "héllo" })).toBe("<p>5</p>");
    expect(text({ length: bind("a") }, { a: [1, 2, 3] })).toBe("<p>3</p>");
    const cmp = (op: "eq" | "ne" | "lt" | "gt" | "le" | "ge", a: IrValue, b: IrValue, input = {}) =>
      text({ if: { cmp: op, args: [a, b] }, then: "T", else: "F" }, input);
    expect(cmp("eq", 1, 1)).toBe("<p>T</p>");
    expect(cmp("eq", 1, "1")).toBe("<p>F</p>");
    expect(cmp("eq", bind("missing"), null)).toBe("<p>T</p>");
    expect(cmp("ne", bind("missing"), null)).toBe("<p>F</p>");
    expect(cmp("ne", "a", "b")).toBe("<p>T</p>");
    expect(cmp("lt", 1, 2)).toBe("<p>T</p>");
    expect(cmp("gt", "b", "a")).toBe("<p>T</p>");
    expect(cmp("le", 2, 2)).toBe("<p>T</p>");
    expect(cmp("ge", 1, 2)).toBe("<p>F</p>");
    expect(cmp("lt", 1, "2")).toBe("<p>F</p>");
    expect(cmp("ge", null, null)).toBe("<p>F</p>");
    expect(cmp("lt", bind("a"), 5, { a: [1] })).toBe("<p>F</p>");
  });

  it("evaluates every predicate form with short-circuiting", () => {
    const test = (predicate: IrPredicate, input: unknown = {}) =>
      html(el("p", {}, { if: predicate, then: ["T"], else: ["F"] }), input);
    expect(test({ present: "a" }, { a: "x" })).toBe("<p>T</p>");
    expect(test({ present: "a" }, { a: 0 })).toBe("<p>F</p>");
    expect(test({ truthy: bind("a") }, { a: [] })).toBe("<p>T</p>");
    expect(test({ truthy: "" })).toBe("<p>F</p>");
    expect(test({ not: { present: "a" } })).toBe("<p>T</p>");
    expect(test({ and: [{ present: "a" }, { present: "b" }] }, { a: 1, b: 1 })).toBe("<p>T</p>");
    expect(test({ and: [{ present: "a" }, { present: "b" }] }, { a: 1 })).toBe("<p>F</p>");
    expect(test({ or: [{ present: "a" }, { present: "b" }] }, { b: 1 })).toBe("<p>T</p>");
    expect(test({ and: [] })).toBe("<p>T</p>");
    expect(test({ or: [] })).toBe("<p>F</p>");
    // The failing right operand is never evaluated.
    expect(test({ or: [{ present: "a" }, { truthy: { op: "/", args: [1, 0] } }] }, { a: 1 })).toBe(
      "<p>T</p>",
    );
    expect(test({ and: [{ present: "a" }, { truthy: { op: "/", args: [1, 0] } }] }, {})).toBe(
      "<p>F</p>",
    );
  });

  it("renders attributes, class conditionals and boolean attributes", () => {
    const body = el(
      "div",
      {
        id: bind("id"),
        class: { if: { present: "vip" }, then: "gold", else: "basic" },
        "data-x": true,
        "data-y": false,
        "aria-label": bind("label"),
        title: null,
        lang: bind("absent"),
      },
      "x",
    );
    expect(html(body, { id: "a\"b'c", vip: true, label: "L&" })).toBe(
      '<div id="a&quot;b&#39;c" class="gold" data-x="" aria-label="L&amp;">x</div>',
    );
    expect(html(body, {})).toContain('class="basic"');
    expect(html(el("div", { className: "c" }), {})).toBe('<div class="c"></div>');
  });

  it("renders style as a static string, a list, or a conditional after attributes", () => {
    const at = (style: IrStyle, input: unknown = {}) =>
      html({ el: "div", attrs: { id: "a" }, style, children: ["x"] }, input);
    expect(at("color:red")).toBe('<div id="a" style="color:red">x</div>');
    expect(at('font-family:"A", B')).toBe(
      '<div id="a" style="font-family:&quot;A&quot;, B">x</div>',
    );
    expect(
      at(
        [
          ["backgroundColor", bind("bg")],
          ["fontSize", 14],
          ["lineHeight", 1.5],
          ["margin", 0],
          ["--brand", "red"],
          ["color", null],
          ["padding", bind("nothing")],
        ],
        { bg: "#fff" },
      ),
    ).toBe(
      '<div id="a" style="background-color:#fff;font-size:14px;line-height:1.5;margin:0;--brand:red">x</div>',
    );
    const conditional: IrStyle = {
      if: { present: "on" },
      then: [["color", "red"]],
      else: "color:blue",
    };
    expect(at(conditional, { on: 1 })).toContain('style="color:red"');
    expect(at(conditional, {})).toContain('style="color:blue"');
    expect(at([["color", bind("nothing")]])).toBe('<div id="a">x</div>');
    expect(at("")).toBe('<div id="a">x</div>');
  });

  it("closes void elements and emits raw style text", () => {
    expect(html(el("br"))).toBe("<br />");
    expect(html(el("img", { src: "https://x.test/a.png", alt: "A" }))).toBe(
      '<img src="https://x.test/a.png" alt="A" />',
    );
    expect(html(el("style", {}, "p{color:red}>a"))).toBe("<style>p{color:red}>a</style>");
    expect(html(el("style"))).toBe("");
  });

  it("keeps the unsubscribe placeholder only as a static href on a", () => {
    expect(html(el("a", { href: "%samva:unsubscribe-url%" }, "Unsubscribe"))).toBe(
      '<a href="%samva:unsubscribe-url%" data-samva-no-track>Unsubscribe</a>',
    );
    expect(
      codes(() => html(el("a", { href: bind("u") }, "x"), { u: "%samva:unsubscribe-url%" })),
    ).toContain("unsafe-url");
    expect(
      codes(() => html(el("a", { href: { concat: ["%samva:unsubscribe-url%"] } }, "x"))),
    ).toContain("unsafe-url");
    expect(codes(() => html(el("img", { src: "%samva:unsubscribe-url%", alt: "" })))).toContain(
      "unsafe-url",
    );
  });

  it("reads the unsubscribe placeholder and footer markers from the brand plugin", () => {
    const brandPlugin: BrandPlugin = {
      specifier: "acme:brand",
      footerAttribute: "data-acme-footer",
      unsubscribeRowAttribute: "data-acme-unsubscribe",
      unsubscribeUrlPlaceholder: "{{acme.unsubscribe}}",
      noTrackAttribute: "data-acme-no-track",
    };
    expect(html(el("a", { href: "{{acme.unsubscribe}}" }, "Out"), {}, { brandPlugin })).toBe(
      '<a href="{{acme.unsubscribe}}" data-acme-no-track>Out</a>',
    );
    expect(
      html({ el: "div", attrs: { "data-acme-footer": "" }, reserved: true }, {}, { brandPlugin }),
    ).toBe('<div data-acme-footer=""></div>');
    expect(codes(() => html(el("p", { "data-acme-footer": "" }), {}, { brandPlugin }))).toContain(
      "reserved-attribute",
    );
    // Another plugin's placeholder and markers are ordinary values.
    expect(
      codes(() => html(el("a", { href: "%samva:unsubscribe-url%" }, "x"), {}, { brandPlugin })),
    ).toContain("unsafe-url");
    expect(html(el("p", { "data-samva-footer": "" }), {}, { brandPlugin })).toBe(
      '<p data-samva-footer=""></p>',
    );
  });

  it("renders raw parts with per-context escaping", () => {
    const node: IrNode = {
      raw: ['<v:rect fillcolor="', { attr: bind("c") }, '"><b>', { text: bind("t") }, "</b>"],
      text: bind("t"),
    };
    const out = renderIr(tpl(el("div", {}, node, "!")), { c: '"><script>', t: "<i>&" }, {});
    expect(out.html).toBe(
      '<div><v:rect fillcolor="&quot;&gt;&lt;script&gt;"><b>&lt;i&gt;&amp;</b>!</div>',
    );
    expect(out.text).toBe("<i>&!");
    expect(renderIr(tpl(el("div", {}, { raw: ["<!--x-->"] })), {}).text).toBe("");
  });
});

describe("subject, preheader and document assembly", () => {
  it("renders the subject from values", () => {
    const out = renderIr(tpl(el("p"), { subject: { concat: ["Order ", bind("id")] } }), { id: 12 });
    expect(out.subject).toBe("Order 12");
    expect(out.preheader).toBeUndefined();
  });

  it("prefixes the doctype only for a document root", () => {
    const document = el(
      "html",
      {},
      el("head", {}, el("title", {}, "T")),
      el("body", {}, el("p", {}, "x")),
    );
    const out = renderIr(tpl(document), {});
    expect(out.html.startsWith("<!DOCTYPE html PUBLIC")).toBe(true);
    expect(out.html).toContain("<html><head><title>T</title></head><body><p>x</p></body></html>");
    expect(html(el("p"))).toBe("<p></p>");
  });

  const shell = (children: IrNode[] = [el("p", {}, "Body")]): IrElement =>
    el("html", {}, el("head", {}, el("title", {}, "T")), el("body", {}, ...children));

  const jsxShell = (children: EmailChild[] = [jsx("p", { children: "Body" })]) =>
    jsx("html", {
      children: [
        jsx("head", { children: jsx("title", { children: "T" }) }),
        jsx("body", { children }),
      ],
    });

  it("inserts the preheader first in the body, matching the JSX pipeline", () => {
    for (const preheader of ["Preview <text> & more", "", "x".repeat(250)]) {
      const mine = renderIr(tpl(shell(), { preheader }), {});
      const old = renderEmailContent(undefined, () => ({
        subject: "S",
        preheader,
        body: jsxShell(),
      }));
      expect(mine.html).toBe(old.html);
      expect(mine.text).toBe(old.text);
      expect(mine.preheader).toBe(preheader);
    }
  });

  it("honors the marker position and consumes only the first marker", () => {
    const body = el("body", {}, el("p", {}, "A"), { preheader: true }, el("p", {}, "B"), {
      preheader: true,
    });
    const out = renderIr(tpl(body, { preheader: "Hi" }), {});
    expect(out.html.match(/data-samva-preheader=/g)?.length).toBe(1);
    expect(out.html.indexOf("<p>A</p>")).toBeLessThan(out.html.indexOf("data-samva-preheader="));
    expect(out.html.indexOf("data-samva-preheader=")).toBeLessThan(out.html.indexOf("<p>B</p>"));
  });

  it("puts the preheader first overall when there is no body", () => {
    const out = renderIr(tpl(el("p", {}, "x"), { preheader: "Hi" }), {});
    const old = renderEmailContent(undefined, () => ({
      subject: "S",
      preheader: "Hi",
      body: jsx("p", { children: "x" }),
    }));
    expect(out.html).toBe(old.html);
    expect(out.html.startsWith("<div data-samva-preheader=")).toBe(true);
  });

  it("renders nothing for a marker without a preheader value, and for an unbound one", () => {
    expect(renderIr(tpl(el("body", {}, { preheader: true }, "x")), {}).html).toBe("<body>x</body>");
    const out = renderIr(
      tpl(el("body", {}, { preheader: true }, "x"), { preheader: bind("p") }),
      {},
    );
    expect(out.html).toBe("<body>x</body>");
    expect(out.preheader).toBeUndefined();
  });

  it("emits the exact hidden block", () => {
    const out = renderIr(tpl(el("body"), { preheader: "Hi" }), {});
    expect(out.html).toBe(
      '<body><div data-samva-preheader="Hi" style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Hi<div data-samva-preheader-padding="">' +
        " ‌​‍‎‏﻿".repeat(29) +
        "</div></div></body>",
    );
  });

  it.each([
    ["line feed", "a\nb"],
    ["carriage return", "a\rb"],
    ["nul", "a\u0000b"],
  ])("rejects a subject with a %s", (_name, subject) => {
    expect(codes(() => renderIr(tpl(el("p"), { subject }), {}))).toContain("invalid-subject");
    expect(codes(() => renderIr(tpl(el("p"), { subject: bind("s") }), { s: subject }))).toContain(
      "invalid-subject",
    );
    expect(
      codes(() =>
        renderIr(tpl(el("p"), { subject: { concat: ["x", bind("s")] } }), { s: subject }),
      ),
    ).toContain("invalid-subject");
  });

  it("requires the channel", () => {
    expect(codes(() => renderIr({ sml: 1, template: "t", schema: {} }, {}))).toEqual([
      "missing-channel",
    ]);
    expect(codes(() => renderIrSms(tpl(el("p")), {}))).toEqual(["missing-channel"]);
  });
});

// ── Formatting, options, determinism ──────────────────────────────────────────

describe("format nodes and options", () => {
  const money = (amount: IrValue): IrValue => ({ format: "money", args: [amount, "EUR"] });
  const text = (value: IrValue, ir: Partial<TemplateIr>, options = {}, input: unknown = {}) =>
    renderIr(tpl(el("p", {}, value), {}, ir), input, options).html;

  it("formats through the fmt module", () => {
    expect(text(money(bind("a")), {}, {}, { a: 1234.5 })).toBe(
      `<p>${createFmt().money(1234.5, "EUR")}</p>`,
    );
    expect(
      text({ format: "plural", args: [2, { lit: { one: "item", other: "items" } }] }, {}),
    ).toBe("<p>items</p>");
    expect(text({ format: "list", args: [{ lit: ["a", "b"] }] }, {})).toBe("<p>a and b</p>");
    expect(
      text(
        { format: "number", args: [bind("n"), { lit: { maximumFractionDigits: 0 } }] },
        {},
        {},
        { n: 1234.5 },
      ),
    ).toBe("<p>1,235</p>");
  });

  it("prefers the option locale over the template locale over the default", () => {
    const de = createFmt({ locale: "de" }).money(1234.5, "EUR");
    const us = createFmt().money(1234.5, "EUR");
    const input = { a: 1234.5 };
    expect(text(money(bind("a")), { locale: "de" }, {}, input)).toBe(`<p>${de}</p>`);
    expect(text(money(bind("a")), { locale: "de" }, { locale: "en-US" }, input)).toBe(
      `<p>${us}</p>`,
    );
    expect(text(money(bind("a")), {}, { locale: "de" }, input)).toBe(`<p>${de}</p>`);
    expect(text(money(bind("a")), {}, {}, input)).toBe(`<p>${us}</p>`);
  });

  it("applies the time zone option and defaults to UTC", () => {
    const date: IrValue = { format: "date", args: ["2026-09-30T02:30:00Z"] };
    expect(text(date, {})).toBe("<p>Sep 30, 2026</p>");
    expect(text(date, {}, { timeZone: "America/Los_Angeles" })).toBe("<p>Sep 29, 2026</p>");
  });

  it("wraps formatter failures", () => {
    expect(codes(() => text({ format: "date", args: ["nope"] }, {}))).toEqual(["format-error"]);
    expect(codes(() => text({ format: "money", args: [1, "NOTACURRENCY"] }, {}))).toEqual([
      "format-error",
    ]);
    expect(
      codes(() => text({ format: "money", args: [bind("x"), "USD"] }, {}, {}, { x: "1" })),
    ).toEqual(["format-error"]);
    expect(codes(() => text({ format: "bogus" as never, args: [] }, {}))).toEqual(["format-error"]);
    expect(codes(() => text({ format: "date", args: [1] }, {}, { timeZone: "Not/AZone" }))).toEqual(
      ["format-error"],
    );
  });

  it("is deterministic and never mutates the input", () => {
    const input = deepFreeze({ items: [{ t: "a" }, { t: "b" }], name: "N" });
    const ir = tpl(
      el("div", {}, bind("name"), { each: bind("items"), as: "i", children: [bind("$i.t")] }),
      { preheader: "P" },
    );
    const before = JSON.stringify(input);
    const first = renderIr(ir, input);
    const second = renderIr(ir, input);
    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(ir)).toBe(JSON.stringify(deepFreeze(JSON.parse(JSON.stringify(ir)))));
  });
});

// ── SMS ───────────────────────────────────────────────────────────────────────

describe("renderIrSms", () => {
  const sms = (body: IrNode[], input: unknown = {}) =>
    renderIrSms({ sml: 1, template: "t", schema: {}, sms: { body } }, input);

  it("renders values, conditionals, loops and formats as plain text", () => {
    expect(
      sms(
        [
          "Hi ",
          bind("name"),
          " <&> ",
          { if: { present: "code" }, then: ["code ", bind("code")], else: ["no code"] },
          ":",
          { each: bind("xs"), as: "x", children: [bind("$x"), ","] },
          { format: "money", args: [5, "USD"] },
        ],
        { name: "Ada", code: 7, xs: ["a", "b"] },
      ),
    ).toBe("Hi Ada <&> code 7:a,b,$5.00");
  });

  it("rejects elements and unsafe values", () => {
    expect(codes(() => sms([el("p")]))).toContain("unsupported-element");
    expect(codes(() => sms([bind("o")], { o: {} }))).toEqual(["invalid-value"]);
  });
});

// ── Differential against the JSX serializer and text derivation ───────────────

type Spec =
  | string
  | {
      readonly tag: string;
      readonly attrs?: Record<string, string | number | boolean>;
      readonly style?: Record<string, string | number>;
      readonly kids?: readonly Spec[];
    };

const t = (
  tag: string,
  attrs?: Record<string, string | number | boolean>,
  kids?: readonly Spec[],
  style?: Record<string, string | number>,
): Spec => ({
  tag,
  ...(attrs ? { attrs } : {}),
  ...(kids ? { kids } : {}),
  ...(style ? { style } : {}),
});

const toJsx = (spec: Spec): EmailChild =>
  typeof spec === "string"
    ? spec
    : jsx(spec.tag, {
        ...spec.attrs,
        ...(spec.style ? { style: spec.style } : {}),
        ...(spec.kids ? { children: spec.kids.map(toJsx) } : {}),
      });

const toIr = (spec: Spec): IrNode =>
  typeof spec === "string"
    ? spec
    : {
        el: spec.tag,
        ...(spec.attrs ? { attrs: spec.attrs } : {}),
        ...(spec.style ? { style: Object.entries(spec.style) as [string, IrValue][] } : {}),
        ...(spec.kids ? { children: spec.kids.map(toIr) } : {}),
      };

const layout = (kids: Spec[], attrs = {}): Spec =>
  t("table", { role: "presentation", border: 0, cellpadding: 0, cellspacing: 0, ...attrs }, [
    t("tbody", {}, [t("tr", {}, kids)]),
  ]);

const battery: readonly (readonly [string, Spec])[] = [
  [
    "nested layout tables",
    layout([
      t("td", { align: "center", width: "50%", bgcolor: "#fff" }, [
        layout([t("td", { valign: "top" }, [t("p", {}, ["Hello ", t("strong", {}, ["World"])])])]),
      ]),
      t("td", {}, [t("p", {}, ["Right column"])]),
    ]),
  ],
  [
    "nested lists",
    t("div", {}, [
      t("ul", {}, [
        t("li", {}, ["One"]),
        t("li", {}, [
          "Two",
          t("ol", { start: 3 }, [t("li", {}, ["Three"]), t("li", {}, ["Four"])]),
        ]),
        t("li", {}, [t("p", {}, ["Para"]), t("p", {}, ["Second"])]),
      ]),
    ]),
  ],
  [
    "links with equal and different labels",
    t("p", {}, [
      t("a", { href: "https://example.com/a?x=1&y=2" }, ["Read"]),
      " ",
      t("a", { href: "https://example.com" }, ["https://example.com"]),
      " ",
      t("a", { href: "mailto:a@b.co", target: "_blank", rel: "noopener" }, []),
      " ",
      t("a", { href: "#top" }, [t("em", {}, ["Top"]), " ", t("b", {}, ["now"])]),
      t("a", { href: "tel:+15551234" }, ["Call"]),
      t("a", { href: "cid:logo" }, ["Logo"]),
    ]),
  ],
  [
    "images",
    t("div", {}, [
      t("img", { src: "https://x.test/a.png", alt: "Logo", width: 120, height: "40", border: 0 }),
      t("img", { src: "https://x.test/b.png", alt: "" }),
      t("a", { href: "https://x.test" }, [t("img", { src: "cid:hero", alt: "  Hero  " })]),
    ]),
  ],
  [
    "hr and br",
    t("div", {}, ["a", t("hr", { width: "100%", size: 1, align: "left" }), "b", t("br"), "c"]),
  ],
  [
    "preformatted",
    t("div", {}, [
      t("pre", {}, ["  line 1\n\n   line 2  ", t("code", {}, ["x < y"])]),
      t("p", {}, ["after"]),
    ]),
  ],
  [
    "data table",
    t("table", { border: 1, width: "100%" }, [
      t("caption", {}, ["Totals"]),
      t("thead", {}, [t("tr", {}, [t("th", {}, ["Item"]), t("th", {}, ["Price"])])]),
      t("tbody", {}, [
        t("tr", {}, [t("td", { colspan: 1 }, ["Book"]), t("td", {}, ["$5"])]),
        t("tr", {}, [
          t("td", {}, [t("img", { src: "https://x.test/s.png", alt: "" })]),
          t("td", {}, ["  spaced   out\n text  "]),
        ]),
        t("tr", {}, [t("td", {}, []), t("td", {}, ["only"])]),
      ]),
      t("tfoot", {}, [t("tr", {}, [t("td", {}, ["Sum"]), t("td", {}, ["$5"])])]),
    ]),
  ],
  [
    "entities and quotes",
    t("p", { title: `a"b'c<d>&e`, "data-x": "1&2", "aria-label": "<x>" }, [
      `"quoted" 'single' & <tag> &amp; &lt;`,
    ]),
  ],
  [
    "unicode",
    t("div", {}, [
      t("p", {}, ["héllo wörld 日本語 🎉 ‮⁦ rtl ​zero‍width nbsp"]),
      t("p", { dir: "rtl", lang: "ar" }, ["مرحبا بالعالم"]),
    ]),
  ],
  [
    "style objects",
    t("div", { class: "card", id: "c1" }, ["Styled"], {
      backgroundColor: "#fff",
      fontSize: 14,
      opacity: 0.5,
      lineHeight: 1.5,
      margin: 0,
      paddingTop: 8,
      "--brand-color": "red",
      zIndex: 3,
      fontWeight: 700,
      backgroundImage: "url(https://x.test/a.png)",
      border: "1px solid #ccc",
    }),
  ],
  [
    "nested inline",
    t("p", {}, [
      t("strong", {}, [
        t("em", {}, [t("span", {}, ["deep ", t("a", { href: "https://a.test" }, ["link"])])]),
      ]),
      " ",
      t("small", {}, ["s"]),
      t("u", {}, ["u"]),
      t("s", {}, ["s"]),
      t("i", {}, ["i"]),
      t("b", {}, ["b"]),
    ]),
  ],
  [
    "headings blockquote center",
    t("div", {}, [
      t("h1", { align: "center" }, ["H1"]),
      t("h2", {}, ["H2"]),
      t("blockquote", {}, [t("p", {}, ["Quote"])]),
      t("center", {}, ["Centered"]),
      t("section", {}, [
        t("article", {}, [t("header", {}, ["hd"]), t("main", {}, ["mn"]), t("footer", {}, ["ft"])]),
      ]),
    ]),
  ],
  ["whitespace text", t("p", {}, ["  leading\t\ttabs   and\n\n\n\nnewlines  "])],
  [
    "colgroup and cells",
    t("table", { role: "none" }, [
      t("colgroup", {}, [t("col", { span: 2, width: 10 })]),
      t("tr", {}, [t("td", { rowspan: 2, height: 20 }, ["a"]), t("td", {}, ["b"])]),
    ]),
  ],
  ["empty things", t("div", {}, [t("p", {}, []), t("span", {}, [""]), t("ul", {}, [])])],
];

describe("differential parity with the JSX pipeline", () => {
  it.each(battery)("%s", (_name, spec) => {
    const node = toJsx(spec);
    if (typeof node === "string") throw new Error("root must be an element");
    const mine = renderIr(tpl(toIr(spec)), {});
    expect(mine.html).toBe(serializeEmailHtml(node as never).html);
    expect(mine.text).toBe(deriveEmailText(node as never));
  });

  it("matches bound content escaped the same way as the literal", () => {
    const literal = 'Ada <script>alert(1)</script> & "q"';
    const bound = renderIr(tpl(el("p", {}, bind("v"))), { v: literal });
    const node = jsx("p", { children: literal });
    expect(bound.html).toBe(serializeEmailHtml(node).html);
    expect(bound.text).toBe(deriveEmailText(node));
  });

  it("matches a whole document with head, style and preheader", () => {
    const css = "p{color:red}";
    const ir = tpl(
      el(
        "html",
        { lang: "en" },
        el(
          "head",
          {},
          el("title", {}, "T"),
          el("meta", { charset: "utf-8" }),
          el("style", {}, css),
        ),
        el("body", { bgcolor: "#eee" }, el("p", {}, "Body")),
      ),
      { preheader: "Pre" },
    );
    const old = renderEmailContent(undefined, () => ({
      subject: "S",
      preheader: "Pre",
      body: jsx("html", {
        lang: "en",
        children: [
          jsx("head", {
            children: [
              jsx("title", { children: "T" }),
              jsx("meta", { charset: "utf-8" }),
              jsx("style", { children: css }),
            ],
          }),
          jsx("body", { bgcolor: "#eee", children: jsx("p", { children: "Body" }) }),
        ],
      }),
    }));
    const mine = renderIr(ir, {});
    expect(mine.html).toBe(old.html);
    expect(mine.text).toBe(old.text);
  });
});

// ── Adversarial ───────────────────────────────────────────────────────────────

describe("adversarial: attribute and text breakout", () => {
  it("escapes hostile attribute values in every attribute kind", () => {
    const hostile = `" onmouseover="x' onfocus='y <script> &amp;`;
    const out = html(
      el("div", {
        title: bind("v"),
        "data-v": bind("v"),
        "aria-label": bind("v"),
        class: bind("v"),
      }),
      { v: hostile },
    );
    expect(out).toBe(
      `<div title="&quot; onmouseover=&quot;x&#39; onfocus=&#39;y &lt;script&gt; &amp;amp;" data-v="&quot; onmouseover=&quot;x&#39; onfocus=&#39;y &lt;script&gt; &amp;amp;" aria-label="&quot; onmouseover=&quot;x&#39; onfocus=&#39;y &lt;script&gt; &amp;amp;" class="&quot; onmouseover=&quot;x&#39; onfocus=&#39;y &lt;script&gt; &amp;amp;"></div>`,
    );
  });

  it("escapes markup in text and attribute-context raw parts differently", () => {
    expect(html(el("p", {}, bind("v")), { v: "<script>alert(1)</script>" })).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    const raw = html(
      { raw: ['<a x="', { attr: bind("v") }, '">', { text: bind("v") }, "</a>"] },
      {
        v: `"'<>&`,
      },
    );
    expect(raw).toBe(`<a x="&quot;&#39;&lt;&gt;&amp;">"'&lt;&gt;&amp;</a>`);
  });

  it("passes bidirectional and unicode text through unchanged", () => {
    const value = "‮evil‬ ⁦x⁩ ‏ mixed עברית 🎉";
    const out = renderIr(tpl(el("p", {}, bind("v"))), { v: value });
    expect(out.html).toBe(`<p>${value}</p>`);
  });

  it("rejects event handlers however they are spelled or bound", () => {
    for (const name of ["onclick", "onmouseover", "OnLoad", "ONERROR", "onanything"]) {
      expect(codes(() => html(el("div", { [name]: "alert(1)" })))).toContain("event-handler");
      expect(codes(() => html(el("div", { [name]: bind("v") }), { v: "x" }))).toContain(
        "event-handler",
      );
    }
  });

  it("rejects unknown, malformed and inherited-looking attribute names", () => {
    for (const name of [
      "foo",
      "srcdoc",
      "formaction",
      'x" onclick="y',
      "data-",
      "DATA-x",
      "aria_x",
      "toString",
      "__proto__",
      "constructor",
    ]) {
      expect(codes(() => html(el("div", { [name]: "1" })))).toContain("unsupported-attribute");
    }
  });

  it("rejects attributes the element does not take, and bad values", () => {
    expect(codes(() => html(el("p", { href: "https://x.test" })))).toContain(
      "unsupported-attribute",
    );
    expect(codes(() => html(el("td", { colspan: "x" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("td", { colspan: "1.5" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("td", { width: "10em" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("p", { dir: "sideways" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("p", { align: "justify" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("p", { id: "a\nb" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("p", { id: "a\u0000b" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("p", { class: "a\u0007b" })))).toContain("invalid-attribute-value");
    expect(codes(() => html(el("p", { id: bind("o") }), { o: { x: 1 } }))).toContain(
      "invalid-attribute-value",
    );
    expect(codes(() => html(el("p", { id: bind("a") }), { a: [1] }))).toContain(
      "invalid-attribute-value",
    );
    expect(codes(() => html(el("p", { class: bind("n") }), { n: 5 }))).toContain(
      "invalid-attribute-value",
    );
    expect(codes(() => html(el("p", { class: "a", className: "b" })))).toContain(
      "duplicate-attribute",
    );
    expect(codes(() => html(el("p", { "data-samva-footer": true })))).toContain(
      "reserved-attribute",
    );
    expect(codes(() => html(el("p", { style: "color:red" })))).toContain("invalid-style");
  });

  it("requires mandatory attributes", () => {
    expect(codes(() => html(el("a", {}, "x")))).toContain("missing-attribute");
    expect(codes(() => html(el("img", { src: "https://x.test/a.png" })))).toContain(
      "missing-attribute",
    );
    expect(html(el("img", { src: "https://x.test/a.png", alt: "" }))).toContain('alt=""');
  });

  it("rejects elements outside the vocabulary, however named", () => {
    for (const tag of [
      "script",
      "iframe",
      "object",
      "form",
      "input",
      "svg",
      "SCRIPT",
      "toString",
      "constructor",
      "__proto__",
      "",
      "p onclick=1",
    ]) {
      expect(codes(() => html(el(tag)))).toContain("unsupported-element");
    }
    expect(codes(() => html({ el: 5 as unknown as string }))).toContain("unsupported-element");
  });

  it("enforces the content model on the rendered tree", () => {
    expect(codes(() => html(el("table", {}, "loose text")))).toContain("invalid-content");
    expect(codes(() => html(el("table", {}, el("p"))))).toContain("invalid-content");
    expect(codes(() => html(el("ul", {}, el("p"))))).toContain("invalid-content");
    expect(codes(() => html(el("tr", {}, el("p"))))).toContain("invalid-content");
    expect(codes(() => html(el("title", {}, el("b"))))).toContain("invalid-content");
    expect(codes(() => html(el("html", {}, el("div"))))).toContain("invalid-content");
    expect(codes(() => html(el("br", {}, "x")))).toContain("void-element-children");
    expect(codes(() => html(el("img", { src: "cid:a", alt: "" }, el("b"))))).toContain(
      "void-element-children",
    );
    // A conditional child that resolves to an element is checked after it renders.
    const body = el(
      "ul",
      {},
      { if: { present: "x" }, then: [el("li", {}, "ok")], else: [el("p")] },
    );
    expect(html(body, { x: 1 })).toBe("<ul><li>ok</li></ul>");
    expect(codes(() => html(body, {}))).toContain("invalid-content");
    expect(html(el("table", {}, "  \n ", el("tbody")))).toBe("<table>  \n <tbody></tbody></table>");
  });

  it("collects several diagnostics in one error", () => {
    try {
      html(el("div", { onclick: "x", foo: "y" }, el("script")));
    } catch (error) {
      expect(error).toBeInstanceOf(IrRenderError);
      expect((error as IrRenderError).name).toBe("IrRenderError");
      expect((error as IrRenderError).diagnostics.map((item) => item.code).sort()).toEqual([
        "event-handler",
        "unsupported-attribute",
        "unsupported-element",
      ]);
      return;
    }
    throw new Error("expected a rejection");
  });
});

describe("adversarial: URLs", () => {
  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:image/png;base64,AAAA",
    "vbscript:msgbox(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "\njavascript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "\u0000https://example.com",
    "https://example.com/\u0000",
    "https://example.com/\n",
    "//evil.example/x",
    "\\\\evil.example",
    "https:\\\\evil.example",
    "https://example.com\\@evil.example",
    "/relative/path",
    "./relative",
    "../up",
    "relative.png",
    "http://insecure.example",
    "ftp://x.example",
    "file:///etc/passwd",
    "",
    "https:example.com",
  ];
  const good = [
    "https://example.com/a?b=1&c=2#frag",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@b.co",
    "MAILTO:a@b.co",
    "tel:+15551234567",
    "cid:logo",
    "#top",
  ];

  // A control character is refused as an invalid attribute value before the URL check runs.
  const rejects = (run: () => unknown) => {
    const found = codes(run);
    expect(found.some((code) => code === "unsafe-url" || code === "invalid-attribute-value")).toBe(
      true,
    );
  };

  it.each(bad)("rejects %j as an href, literal or bound", (url) => {
    rejects(() => html(el("a", { href: url }, "x")));
    rejects(() => html(el("a", { href: bind("u") }, "x"), { u: url }));
    rejects(() => html(el("a", { href: { concat: ["", bind("u")] } }, "x"), { u: url }));
  });

  it.each(bad.filter((url) => url !== ""))("rejects %j as an img src", (url) => {
    rejects(() => html(el("img", { src: bind("u"), alt: "" }), { u: url }));
  });

  it("names unsafe-url for scheme and shape violations", () => {
    for (const url of [
      "javascript:alert(1)",
      " javascript:x",
      "//evil.example",
      "\\\\evil",
      "/rel",
    ]) {
      expect(codes(() => html(el("a", { href: url }, "x")))).toContain("unsafe-url");
    }
  });

  it.each(good)("allows %j", (url) => {
    const out = html(el("a", { href: bind("u") }, "x"), { u: url });
    expect(out.startsWith('<a href="')).toBe(true);
  });

  it("escapes what it allows", () => {
    expect(html(el("a", { href: bind("u") }, "x"), { u: 'https://e.test/?a="b"&c=<d>' })).toBe(
      '<a href="https://e.test/?a=&quot;b&quot;&amp;c=&lt;d&gt;">x</a>',
    );
  });

  it("checks urls inside style values", () => {
    const at = (value: IrValue, input: unknown = {}) =>
      html({ el: "div", style: [["backgroundImage", value]] }, input);
    expect(at('url("https://x.test/a.png")')).toContain("url(&quot;https://x.test/a.png&quot;)");
    expect(codes(() => at(bind("u"), { u: "url(javascript:alert(1))" }))).toContain("unsafe-url");
    expect(codes(() => at(bind("u"), { u: "url('//evil.example/a.png')" }))).toContain(
      "unsafe-url",
    );
    expect(codes(() => at(bind("u"), { u: "url(data:image/png,AAA)" }))).toContain("unsafe-url");
    // The declaration separator in a data URL is refused before the URL check.
    expect(codes(() => at(bind("u"), { u: "url(data:image/png;base64,AAA)" }))).toContain(
      "unsafe-style-value",
    );
    expect(codes(() => at(bind("u"), { u: "url(/a.png)" }))).toContain("unsafe-url");
  });
});

describe("adversarial: style", () => {
  const style = (value: IrValue, input: unknown = {}, property = "color") =>
    html({ el: "div", style: [[property, value]] }, input);

  it.each([
    "red; background:url(x)",
    "red}",
    "red{",
    "expression(alert(1))",
    "EXPRESSION (alert(1))",
    "red /* c */",
    "@import 'x'",
    "@IMPORT url(x)",
    "</style><script>",
    "red<",
    "red>",
    "red\\",
    "red\u0000",
    "red\n",
    "red\u007f",
  ])("rejects the value %j", (value) => {
    expect(codes(() => style(bind("v"), { v: value }))).toContain("unsafe-style-value");
    expect(codes(() => style({ concat: ["a", bind("v")] }, { v: value }))).toContain(
      "unsafe-style-value",
    );
  });

  it("rejects url() that is not a safe url", () => {
    expect(codes(() => style(bind("v"), { v: "url(javascript:alert(1))" }))).toContain(
      "unsafe-url",
    );
  });

  it.each(["color:red;x", "a b", "1x", 'co"lor', "", "color}", "-x", "é"])(
    "rejects the property name %j",
    (property) => {
      expect(codes(() => style("red", {}, property))).toContain("unsupported-style-property");
    },
  );

  it("rejects non-scalar and non-finite values", () => {
    expect(codes(() => style(bind("v"), { v: { a: 1 } }))).toContain("invalid-style-value");
    expect(codes(() => style(bind("v"), { v: [1] }))).toContain("invalid-style-value");
    expect(codes(() => style(true))).toContain("invalid-style-value");
    expect(codes(() => style(bind("v"), { v: Number.NaN }))).toContain("invalid-style-value");
    expect(codes(() => style(bind("v"), { v: Infinity }))).toContain("invalid-style-value");
  });

  it("rejects a control character in a static style string and malformed styles", () => {
    expect(codes(() => html({ el: "div", style: "color:red\n" }))).toContain("unsafe-style-value");
    expect(codes(() => html({ el: "div", style: 5 as unknown as string }))).toContain(
      "invalid-style",
    );
    expect(codes(() => html({ el: "div", style: [["color"]] as never }))).toContain(
      "invalid-style",
    );
  });

  it("refuses markup in raw style text", () => {
    for (const css of ["a{}</style><script>alert(1)</script>", "a{}<!-- x", "a{}</STYLE>", "</"]) {
      expect(codes(() => html(el("style", {}, css)))).toContain("unsafe-raw-text");
      expect(codes(() => html(el("style", {}, bind("css")), { css }))).toContain("unsafe-raw-text");
    }
    expect(codes(() => html(el("style", {}, el("b"))))).toContain("invalid-content");
  });
});

describe("adversarial: bindings and values", () => {
  const text = (path: string, input: unknown) => html(el("p", {}, bind(path)), input);

  it("never reads inherited or forbidden properties", () => {
    const withProto = Object.create({ inherited: "leak" }) as Record<string, unknown>;
    withProto.own = "ok";
    for (const path of [
      "__proto__",
      "constructor",
      "prototype",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "__proto__.polluted",
      "constructor.name",
      "constructor.prototype",
      "a.__proto__",
      "a.constructor",
      "a.toString",
      "a.hasOwnProperty",
      "arr.length",
      "arr.constructor",
      "arr.map",
      "s.length",
      "s.constructor",
      "inherited",
      "$x.__proto__",
      "$x.constructor",
      ".",
      "",
      "a..b",
    ]) {
      expect(text(path, { a: { b: 1 }, arr: [1], s: "str", ...withProto })).toBe("<p></p>");
    }
    expect(text("own", withProto)).toBe("<p>ok</p>");
    expect(text("inherited", withProto)).toBe("<p></p>");
    expect(text("a", "not an object")).toBe("<p></p>");
    expect(text("a", null)).toBe("<p></p>");
    expect(text("a", [1, 2])).toBe("<p></p>");
    expect(text("0", [1, 2])).toBe("<p>1</p>");
  });

  it("does not expose own __proto__ keys from parsed JSON", () => {
    const input = JSON.parse('{"__proto__":{"x":"p"},"safe":"s"}') as unknown;
    expect(text("__proto__.x", input)).toBe("<p></p>");
    expect(text("safe", input)).toBe("<p>s</p>");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("does not resolve array indexes out of range or with odd spellings", () => {
    const input = { a: ["x", "y"] };
    for (const path of ["a.2", "a.-1", "a.01", "a.1.5", "a.+1", "a.1e0", "a. 1"]) {
      expect(text(path, input)).toBe("<p></p>");
    }
  });

  it("uses loop scope only for $ paths", () => {
    const body = el(
      "p",
      {},
      { each: bind("xs"), as: "x", children: [bind("$x.a"), bind("x.a"), bind("$y")] },
    );
    expect(html(body, { xs: [{ a: 1 }], x: { a: "input" } })).toBe("<p>1input</p>");
  });

  it("rejects non-finite numbers and objects where text is expected", () => {
    expect(codes(() => text("n", { n: Number.NaN }))).toEqual(["invalid-value"]);
    expect(codes(() => text("n", { n: Infinity }))).toEqual(["invalid-value"]);
    expect(codes(() => text("o", { o: { a: 1 } }))).toEqual(["invalid-value"]);
    expect(codes(() => text("o", { o: [1] }))).toEqual(["invalid-value"]);
    expect(codes(() => html(el("p", {}, { concat: [bind("o")] }), { o: {} }))).toEqual([
      "invalid-value",
    ]);
    expect(codes(() => html(el("p", {}, { concat: [bind("n")] }), { n: Number.NaN }))).toEqual([
      "invalid-value",
    ]);
    expect(codes(() => html(el("p", {}, { lit: { a: 1 } })))).toEqual(["invalid-value"]);
    expect(codes(() => html(el("p", {}, { lit: [1] })))).toEqual(["invalid-value"]);
    expect(codes(() => html([1] as unknown as IrNode))).toEqual(["invalid-value"]);
    expect(codes(() => html(el("p", {}, { nonsense: 1 } as unknown as IrNode)))).toEqual([
      "invalid-value",
    ]);
    expect(codes(() => renderIr(tpl(el("p"), { subject: bind("o") }), { o: {} }))).toEqual([
      "invalid-value",
    ]);
  });

  it("rejects bad arithmetic", () => {
    const op = (o: "+" | "-" | "*" | "/" | "%", a: IrValue, b: IrValue, input: unknown = {}) =>
      codes(() => html(el("p", {}, { op: o, args: [a, b] }), input));
    expect(op("+", bind("n"), 1, { n: Number.NaN })).toEqual(["invalid-value"]);
    expect(op("+", bind("n"), 1, { n: Infinity })).toEqual(["invalid-value"]);
    expect(op("+", "1", 1)).toEqual(["invalid-value"]);
    expect(op("+", bind("missing"), 1)).toEqual(["invalid-value"]);
    expect(op("+", null, 1)).toEqual(["invalid-value"]);
    expect(op("+", true, 1)).toEqual(["invalid-value"]);
    expect(op("-", bind("o"), 1, { o: {} })).toEqual(["invalid-value"]);
    expect(op("/", 1, 0)).toEqual(["invalid-value"]);
    expect(op("%", 1, 0)).toEqual(["invalid-value"]);
    expect(op("/", 0, 0)).toEqual(["invalid-value"]);
    expect(op("*", 1e308, 10)).toEqual(["invalid-value"]);
    expect(op("^" as never, 1, 1)).toEqual(["invalid-value"]);
    expect(html(el("p", {}, { op: "-", args: [0, 0] }))).toBe("<p>0</p>");
  });

  it("rejects length of other things and each over non-arrays", () => {
    expect(codes(() => html(el("p", {}, { length: 5 })))).toEqual(["invalid-value"]);
    expect(codes(() => html(el("p", {}, { length: bind("o") }), { o: { length: 3 } }))).toEqual([
      "invalid-value",
    ]);
    expect(codes(() => html(el("p", {}, { length: null })))).toEqual(["invalid-value"]);
    for (const value of [null, "abc", 3, { a: 1 }, undefined]) {
      expect(
        codes(() => html(el("p", {}, { each: bind("v"), as: "x", children: ["."] }), { v: value })),
      ).toEqual(["invalid-value"]);
    }
  });

  it("rejects malformed nodes", () => {
    expect(
      codes(() => html(el("p", {}, { if: { nope: 1 } as unknown as IrPredicate, then: [] }))),
    ).toEqual(["invalid-value"]);
    expect(codes(() => html({ raw: [{ nope: 1 } as never] }))).toEqual(["invalid-value"]);
    expect(codes(() => html({ raw: "x" as never }))).toEqual(["invalid-value"]);
    expect(
      codes(() => html(el("p", {}, { if: { and: "x" } as unknown as IrPredicate, then: [] }))),
    ).toEqual(["invalid-value"]);
  });
});

describe("adversarial: resource limits", () => {
  const loop = (count: number): IrNode =>
    el("p", {}, { each: bind("xs"), as: "x", children: ["."] });

  it("caps total iterations per render", () => {
    const ok = renderIr(tpl(loop(0)), { xs: new Array(10_000).fill(1) });
    expect(ok.html.length).toBe("<p></p>".length + 10_000);
    expect(codes(() => renderIr(tpl(loop(0)), { xs: new Array(10_001).fill(1) }))).toEqual([
      "render-limit",
    ]);
  });

  it("counts nested loops together", () => {
    const nested = el(
      "p",
      {},
      {
        each: bind("xs"),
        as: "x",
        children: [{ each: bind("xs"), as: "y", children: ["."] }],
      },
    );
    expect(codes(() => renderIr(tpl(nested), { xs: new Array(101).fill(1) }))).toEqual([
      "render-limit",
    ]);
    expect(renderIr(tpl(nested), { xs: new Array(9).fill(1) }).html).toContain(".");
  });

  it("caps nesting depth", () => {
    const nest = (depth: number): IrNode => {
      let node: IrNode = "x";
      for (let index = 0; index < depth; index++) node = el("div", {}, node);
      return node;
    };
    expect(html(nest(30)).startsWith("<div>")).toBe(true);
    expect(codes(() => html(nest(200)))).toEqual(["render-limit"]);
    expect(codes(() => html(nest(5000)))).toEqual(["render-limit"]);
  });

  it("caps nested values and predicates", () => {
    let value: IrValue = "x";
    for (let index = 0; index < 500; index++) value = { concat: [value] };
    expect(codes(() => html(el("p", {}, value)))).toEqual(["render-limit"]);
    let predicate: IrPredicate = { present: "a" };
    for (let index = 0; index < 500; index++) predicate = { not: predicate };
    expect(codes(() => html(el("p", {}, { if: predicate, then: [], else: [] })))).toEqual([
      "render-limit",
    ]);
  });
});

describe("each with where, chunk and count", () => {
  const list = { bind: "n" };
  const input = { n: [1, 2, 3, 4, 5] };
  const ul = (each: IrNode) => el("p", {}, each);

  it("keeps only the items whose condition holds", () => {
    const body = ul({
      each: list,
      as: "x",
      where: { cmp: "gt", args: [{ bind: "$x" }, 2] },
      children: [{ bind: "$x" }, ","],
    });
    expect(html(body, input)).toBe("<p>3,4,5,</p>");
  });

  it("groups the items into slices whose last may be shorter", () => {
    const body = ul({
      each: list,
      as: "row",
      chunk: 2,
      children: [{ each: { bind: "$row" }, as: "x", children: [{ bind: "$x" }] }, "|"],
    });
    expect(html(body, input)).toBe("<p>12|34|5|</p>");
  });

  it("filters first, then chunks", () => {
    const body = ul({
      each: list,
      as: "x",
      chunk: 2,
      where: { cmp: "ne", args: [{ bind: "$x" }, 3] },
      children: [{ each: { bind: "$x" }, as: "y", children: [{ bind: "$y" }] }, "|"],
    });
    // The condition tests each item; the loop variable is then the slice.
    expect(html(body, input)).toBe("<p>12|45|</p>");
  });

  it("counts the items that satisfy a condition", () => {
    const body = ul({
      count: list,
      as: "x",
      where: { cmp: "ge", args: [{ bind: "$x" }, 4] },
    });
    expect(html(body, input)).toBe("<p>2</p>");
  });

  it("rejects a chunk that is not a positive integer and a count of a non-array", () => {
    const bad = ul({ each: list, as: "x", chunk: 0, children: [] });
    expect(() => html(bad, input)).toThrow(IrRenderError);
    expect(() =>
      html(ul({ count: { bind: "s" }, as: "x", where: { present: "$x" } }), { s: "text" }),
    ).toThrow(IrRenderError);
  });
});
