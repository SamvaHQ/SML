import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { initWasm, inline } from "@css-inline/css-inline-wasm";
import { beforeAll, describe, expect, it } from "@effect/vitest";

import { applyStylesheet } from "../src/email/cascade";
import { parseStylesheet } from "../src/email/css";
import { EmailNode } from "../src/email/jsx-runtime";
import { compileEmail } from "../src/email/render";

// Samva resolves the cascade against the semantic tree rather than re-parsing
// its own HTML, because the tree is what carries source origins — a finding or a
// preview selection has to name the authoring element, and an HTML round trip
// loses that. This suite keeps that decision honest: for plain CSS, the
// resolution is checked against css-inline, an independent Rust implementation
// with a real selector engine, so "we wrote the cascade ourselves" is a
// verifiable claim rather than an assertion.

const require = createRequire(import.meta.url);

const declarations = (style: string): Record<string, string> =>
  Object.fromEntries(
    style
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const colon = part.indexOf(":");
        return [
          part.slice(0, colon).trim(),
          part
            .slice(colon + 1)
            .trim()
            .replace(/\s+/g, " "),
        ];
      }),
  );

/** Read `style` attributes from HTML in document order. */
const styles = (html: string): Record<string, string>[] =>
  [...html.matchAll(/<(?!\/)[a-z]+[^>]*?\sstyle="([^"]*)"[^>]*>/gi)].map((match) =>
    declarations((match[1] ?? "").replaceAll("&quot;", '"').replaceAll("&#39;", "'")),
  );

/** css-inline always returns a whole document; compare only the fragment we authored. */
const bodyOf = (html: string): string => {
  const open = /<body[^>]*>/i.exec(html);
  const close = html.lastIndexOf("</body>");
  return open === null || close < 0 ? html : html.slice(open.index + open[0].length, close);
};

const cases: readonly { readonly name: string; readonly css: string; readonly body: string }[] = [
  {
    name: "specificity beats source order",
    css: "p{color:#111111}.a{color:#222222}#hero{color:#333333}",
    body: '<p id="hero" class="a">x</p>',
  },
  {
    name: "source order breaks a specificity tie",
    css: ".a{color:#111111}.b{color:#222222}",
    body: '<p class="a b">x</p>',
  },
  {
    name: "an author's inline style outranks a normal rule",
    css: ".a{color:#111111;font-size:10px}",
    body: '<p class="a" style="color:#222222">x</p>',
  },
  {
    name: "an important rule outranks the inline style",
    css: ".a{color:#111111!important}",
    body: '<p class="a" style="color:#222222">x</p>',
  },
  {
    name: "descendant, child and sibling combinators",
    css: ".wrap span{color:#111111}.wrap>p{color:#222222}p+p{font-weight:700}",
    body: '<div class="wrap"><span>a</span><p>b</p><p>c</p></div>',
  },
  {
    name: "attribute selectors",
    css: "[data-role]{color:#111111}[data-role='lead']{font-weight:700}[data-role^='le']{font-style:italic}",
    body: '<p data-role="lead">x</p><p data-role="other">y</p>',
  },
  {
    name: "type and universal selectors",
    css: "*{line-height:1.5}td{padding:8px}",
    body: "<table><tbody><tr><td>x</td></tr></tbody></table>",
  },
  {
    name: "shorthand and longhand in one rule",
    css: ".a{margin:0;margin-top:4px}",
    body: '<p class="a">x</p>',
  },
  {
    name: "high-specificity shorthand against a low-specificity longhand",
    css: "#hero{margin:0}.a{margin-top:4px}",
    body: '<p id="hero" class="a">x</p>',
  },
  {
    name: "high-specificity longhand against a low-specificity shorthand",
    css: "#hero{margin-top:4px}.a{margin:0}",
    body: '<p id="hero" class="a">x</p>',
  },
  {
    // The oracle only ever sees the serialized document, which is the point: a
    // fragment leaves no element behind, so both combinators have to reach
    // across one.
    name: "sibling combinators across a fragment",
    css: ".a + .b{color:#111111}.a ~ .c{font-weight:700}",
    body: '<div class="wrap"><p class="a">a</p><p class="b">b</p><p class="c">c</p></div>',
  },
];

/** Build the same document as a semantic tree, so both lanes see one input. */
const trees: Readonly<Record<string, EmailNode>> = {
  "specificity beats source order": EmailNode.Element({
    tag: "p",
    props: { id: "hero", class: "a" },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "source order breaks a specificity tie": EmailNode.Element({
    tag: "p",
    props: { class: "a b" },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "an author's inline style outranks a normal rule": EmailNode.Element({
    tag: "p",
    props: { class: "a", style: { color: "#222222" } },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "an important rule outranks the inline style": EmailNode.Element({
    tag: "p",
    props: { class: "a", style: { color: "#222222" } },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "descendant, child and sibling combinators": EmailNode.Element({
    tag: "div",
    props: { class: "wrap" },
    children: [
      EmailNode.Element({
        tag: "span",
        props: {},
        children: [EmailNode.Text({ value: "a" })],
        origins: [],
        authored: true,
      }),
      EmailNode.Element({
        tag: "p",
        props: {},
        children: [EmailNode.Text({ value: "b" })],
        origins: [],
        authored: true,
      }),
      EmailNode.Element({
        tag: "p",
        props: {},
        children: [EmailNode.Text({ value: "c" })],
        origins: [],
        authored: true,
      }),
    ],
    origins: [],
    authored: true,
  }),
  "attribute selectors": EmailNode.Fragment({
    children: [
      EmailNode.Element({
        tag: "p",
        props: { "data-role": "lead" },
        children: [EmailNode.Text({ value: "x" })],
        origins: [],
        authored: true,
      }),
      EmailNode.Element({
        tag: "p",
        props: { "data-role": "other" },
        children: [EmailNode.Text({ value: "y" })],
        origins: [],
        authored: true,
      }),
    ],
  }),
  "type and universal selectors": EmailNode.Element({
    tag: "table",
    props: {},
    children: [
      EmailNode.Element({
        tag: "tbody",
        props: {},
        children: [
          EmailNode.Element({
            tag: "tr",
            props: {},
            children: [
              EmailNode.Element({
                tag: "td",
                props: {},
                children: [EmailNode.Text({ value: "x" })],
                origins: [],
                authored: true,
              }),
            ],
            origins: [],
            authored: true,
          }),
        ],
        origins: [],
        authored: true,
      }),
    ],
    origins: [],
    authored: true,
  }),
  "shorthand and longhand in one rule": EmailNode.Element({
    tag: "p",
    props: { class: "a" },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "high-specificity shorthand against a low-specificity longhand": EmailNode.Element({
    tag: "p",
    props: { id: "hero", class: "a" },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "high-specificity longhand against a low-specificity shorthand": EmailNode.Element({
    tag: "p",
    props: { id: "hero", class: "a" },
    children: [EmailNode.Text({ value: "x" })],
    origins: [],
    authored: true,
  }),
  "sibling combinators across a fragment": EmailNode.Element({
    tag: "div",
    props: { class: "wrap" },
    children: [
      EmailNode.Fragment({
        children: [
          EmailNode.Element({
            tag: "p",
            props: { class: "a" },
            children: [EmailNode.Text({ value: "a" })],
            origins: [],
            authored: true,
          }),
        ],
      }),
      EmailNode.Element({
        tag: "p",
        props: { class: "b" },
        children: [EmailNode.Text({ value: "b" })],
        origins: [],
        authored: true,
      }),
      EmailNode.Fragment({
        children: [
          EmailNode.Element({
            tag: "p",
            props: { class: "c" },
            children: [EmailNode.Text({ value: "c" })],
            origins: [],
            authored: true,
          }),
        ],
      }),
    ],
    origins: [],
    authored: true,
  }),
};

describe("cascade agrees with an independent inliner", () => {
  beforeAll(async () => {
    await initWasm(readFileSync(require.resolve("@css-inline/css-inline-wasm/index_bg.wasm")));
  });

  for (const scenario of cases) {
    it(scenario.name, () => {
      const oracle = styles(
        bodyOf(
          inline(
            `<html><head><style>${scenario.css}</style></head><body>${scenario.body}</body></html>`,
            { keepStyleTags: false, inlineStyleTags: true },
          ),
        ),
      );
      const applied = applyStylesheet(
        trees[scenario.name]!,
        parseStylesheet(scenario.css, { origin: "oracle.css" }),
      );
      const ours = styles(compileEmail(applied.tree).html);
      expect(ours).toEqual(oracle);
    });
  }
});
