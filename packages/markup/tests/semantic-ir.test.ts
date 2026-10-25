/* oxlint-disable samva/no-hand-rolled-object-guard, samva/no-unsafe-type-assertion -- Tests inspect internal discriminated IR and deliberately submit malformed artifacts. */
import { describe, expect, it } from "@effect/vitest";

import type { CompiledNode, CompiledTemplate } from "../src/compiled-template";
import { compileTemplate } from "../src/compiler";
import { COMPONENT_DEGRADATIONS } from "../src/ir/degradations";
import { isValueNode, type SemanticComponent } from "../src/ir/nodes";
import { previewEmail } from "../src/preview";
import { render, RenderError } from "../src/render";
import {
  PARITY_COMPILE_OPTIONS,
  PARITY_DIGESTS,
  PARITY_ENTRY,
  PARITY_PROJECT,
  parityDigests,
} from "./support/email-parity";
import { BUILTIN_BASELINES } from "./support/rendered-email-baseline";

const descendants = (node: CompiledNode): CompiledNode[] => {
  if (isValueNode(node)) return [node];
  if ("if" in node)
    return [node, ...node.then.flatMap(descendants), ...(node.else?.flatMap(descendants) ?? [])];
  return [node, ...("children" in node ? (node.children?.flatMap(descendants) ?? []) : [])];
};

const component = (node: CompiledNode): node is SemanticComponent =>
  typeof node === "object" && node !== null && "type" in node && node.type === "component";

const entry = `import { defineTemplate } from "@samva/markup";
import { Email, Section, Link } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { Item } from "./item";
export default defineTemplate({
  id: "semantic", schema: jsonSchema({ type: "object", required: ["items", "show"], properties: {
    items: { type: "array", items: { type: "object", required: ["label"], properties: { label: { type: "string" } } } },
    show: { type: "boolean" },
  } }),
  fixtures: { basic: { items: [{ label: "One" }, { label: "Two" }], show: true } },
  email: { subject: () => "Semantic", preheader: () => "Preview", body: (input) => (
    <Email><Section style={{ padding: 12 }}>
      {input.show && <p>Intro <span>inline</span></p>}
      {input.items.map((item) => <Item label={item.label} />)}
      <Link href="https://example.test">Read</Link>
    </Section></Email>
  ) },
});`;
const partial = `import { Section } from "@samva/markup/email";
export const Item = ({ label }) => <Section><p><span>{label}</span></p></Section>;`;

describe("semantic compiled document", () => {
  it("keeps every built-in identity and authored props without email scaffolding", async () => {
    const names = new Set<string>();
    for (const baseline of BUILTIN_BASELINES) {
      const compiled = await compileTemplate(baseline.options);
      expect(compiled.template).toBeDefined();
      const template = compiled.template!;
      expect(template.sml).toBe(2);
      const nodes = descendants(template.email!.body);
      for (const node of nodes) {
        if (component(node)) names.add(node.name);
        if (typeof node === "object" && node !== null) {
          expect("el" in node || "raw" in node || "preheader" in node).toBe(false);
          if ("type" in node) expect(node.src).toBeDefined();
        }
      }
      const plan = template.email!.presentation!;
      for (const override of Object.values(plan.nodes))
        expect(Object.keys(override).every((key) => ["attrs", "style", "raw"].includes(key))).toBe(
          true,
        );
    }
    expect([...names].sort()).toEqual(Object.keys(COMPONENT_DEGRADATIONS).sort());
  });

  it("preserves block/inline kinds, imported spans, conditionals and iteration instances", async () => {
    const compiled = await compileTemplate({
      files: { "entry.tsx": entry, "item.tsx": partial },
      entry: "entry.tsx",
      assetBase: "/assets",
    });
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const template = compiled.template!;
    const nodes = descendants(template.email!.body);
    expect(nodes).toContainEqual(expect.objectContaining({ type: "block", tag: "p" }));
    expect(nodes).toContainEqual(expect.objectContaining({ type: "inline", tag: "span" }));
    expect(nodes).toContainEqual(
      expect.objectContaining({ each: { bind: "items" }, as: "item", src: expect.any(Array) }),
    );
    expect(nodes).toContainEqual(
      expect.objectContaining({ if: { present: "show" }, src: expect.any(Array) }),
    );
    const sections = nodes.filter(component).filter((node) => node.name === "Section");
    expect(sections[0]!.props).toEqual({ style: { object: { padding: 12 } } });
    expect(sections[1]!.src?.[2]).toBe(template.sources!.indexOf("item.tsx"));
    const preview = previewEmail(template, compiled.fixtures.basic);
    const spans = preview.selections.filter(
      (selection) => selection.tag === "span" && selection.origins[0]?.fileName === "item.tsx",
    );
    expect(spans).toHaveLength(2);
    expect(spans[0]!.origins).toEqual(spans[1]!.origins);
    expect(spans.map((selection) => selection.occurrences)).toEqual([2, 2]);
    expect(spans[0]!.instancePath).not.toBe(spans[1]!.instancePath);
    expect(preview.html).toContain("One</span>");
    expect(preview.html).toContain("Two</span>");
  });

  it("reports root cardinality when a semantic component expands to zero or several nodes", async () => {
    const source = entry
      .replace('import { Item } from "./item";', 'import { BrandLogo } from "samva:brand";')
      .replace(/<Email>[\s\S]*<\/Email>/, "<BrandLogo />");
    for (const assets of [
      {},
      { logoUrl: "https://example.test/light.png", logoDarkUrl: "https://example.test/dark.png" },
    ]) {
      const compiled = await compileTemplate({
        files: { "entry.tsx": source },
        entry: "entry.tsx",
        assetBase: "/assets",
        brand: { slug: "root", css: "", assets },
      });
      expect(compiled.template).toBeUndefined();
      expect(compiled.diagnostics.map((item) => item.code)).toContain("multiple-roots");
    }
  });

  it("keeps the immutable rendered output digests with a semantic artifact", async () => {
    const compiled = await compileTemplate({
      files: PARITY_PROJECT,
      entry: PARITY_ENTRY,
      ...PARITY_COMPILE_OPTIONS,
    });
    expect(compiled.diagnostics).toEqual([]);
    const template = compiled.template!;
    const before = JSON.stringify(template);
    const input = Object.freeze({ ...(compiled.fixtures.basic as object) });
    const first = render(template, input, { channel: "email" });
    expect(await parityDigests(first)).toEqual(PARITY_DIGESTS);
    expect(render(template, input, { channel: "email" })).toEqual(first);
    expect(JSON.stringify(template)).toBe(before);
    expect(render(JSON.parse(before), input, { channel: "email" })).toEqual(first);
  });
});

const artifact = (body: unknown): CompiledTemplate =>
  ({ sml: 2, template: "test", schema: {}, email: { subject: "S", body } }) as CompiledTemplate;

describe("semantic email render boundary", () => {
  it.each([
    { type: "component", name: "Unknown" },
    { type: "component", name: "Email", children: {} },
    { type: "component", name: "BrandLogo" },
    { type: "component", name: "Email", props: { gutter: "invalid" } },
    {
      type: "component",
      name: "Button",
      props: { href: "https://example.test", height: 44 },
      children: [{ bind: "label" }],
    },
    { type: "block", tag: "script" },
    { type: "inline", tag: "span", children: ["0"] },
    {
      type: "component",
      name: "Button",
      props: { href: "javascript:alert(1)" },
      children: ["Click"],
    },
    { type: "block", tag: "p", style: [["color", { bind: "color" }]] },
  ])("rejects malformed or unsafe semantic IR with RenderError: %j", (body) => {
    expect(() =>
      render(artifact(body), { color: "red;display:none" }, { channel: "email" }),
    ).toThrow(RenderError);
  });

  it("bounds cyclic artifacts and preserves the dynamic loop limit", () => {
    const cyclic: { type: "component"; name: "Email"; children: unknown[] } = {
      type: "component",
      name: "Email",
      children: [],
    };
    cyclic.children.push(cyclic);
    expect(() => render(artifact(cyclic), {}, { channel: "email" })).toThrow(RenderError);
    expect(() =>
      render(
        artifact({
          type: "block",
          tag: "p",
          children: [{ each: { bind: "items" }, as: "item", children: [{ bind: "$item" }] }],
        }),
        { items: Array(10_001).fill("x") },
        { channel: "email" },
      ),
    ).toThrow(RenderError);
  });

  it("escapes text, attribute and VML-bound values after lowering", () => {
    const rendered = render(
      artifact({
        type: "component",
        name: "Button",
        props: { href: { bind: "url" }, width: 200, height: 44 },
        children: [{ bind: "label" }],
      }),
      { url: 'https://example.test/?a="&b=2', label: "<&>" },
      { channel: "email" },
    );
    expect(rendered.html).toContain("&lt;&amp;&gt;");
    expect(rendered.html).toContain('href="https://example.test/?a=&quot;&amp;b=2"');
    expect(rendered.html).toContain("<v:roundrect");
  });

  it("does not permit semantic markup in plain channels", () => {
    const body: CompiledNode = { type: "block", tag: "p", children: ["HTML"] };
    expect(() =>
      render(
        { sml: 2, template: "plain", schema: {}, sms: { body: [body] } },
        {},
        { channel: "sms" },
      ),
    ).toThrow(RenderError);
    expect(() =>
      render(
        {
          sml: 2,
          template: "plain",
          schema: {},
          whatsapp: { category: "UTILITY", language: "en", body: [body] },
        },
        {},
        { channel: "whatsapp" },
      ),
    ).toThrow(RenderError);
  });
});
