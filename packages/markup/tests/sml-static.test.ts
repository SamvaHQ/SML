import { describe, expect, it } from "@effect/vitest";

import { hasUpgradeRecipe } from "../src/diagnostic-codes";
import type { TemplateDiagnostic } from "../src/email/diagnostics";
import { renderIr } from "../src/render-ir";
import { checkTemplateCompatibility } from "../src/sml/compatibility";
import { compileTemplate } from "../src/sml/compile";

const THEME = "@theme { --color-brand: #123456; }";

const SCHEMA = `jsonSchema<{
  name: string;
  order: { id: string; total: number };
  items: { title: string; qty: number; price: number; note?: string }[];
  trackingUrl?: string;
  vip: boolean;
  currency: string;
  plan: "free" | "pro";
}>({
  type: "object",
  properties: {
    name: { type: "string" },
    order: {
      type: "object",
      properties: { id: { type: "string" }, total: { type: "number" } },
      required: ["id", "total"],
      additionalProperties: false,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          qty: { type: "number" },
          price: { type: "number" },
          note: { type: "string" },
        },
        required: ["title", "qty", "price"],
        additionalProperties: false,
      },
    },
    trackingUrl: { type: "string" },
    vip: { type: "boolean" },
    currency: { type: "string" },
    plan: { enum: ["free", "pro"] },
  },
  required: ["name", "order", "items", "vip", "currency", "plan"],
  additionalProperties: false,
})`;

const FIXTURE = `{
  name: "Ada",
  order: { id: "A-1", total: 84 },
  items: [{ title: "Shirt", qty: 2, price: 42 }, { title: "Hat", qty: 1, price: 10, note: "Gift" }],
  vip: true,
  currency: "USD",
  plan: "pro",
  trackingUrl: "https://track.example/A-1",
}`;

interface Sources {
  readonly body: string;
  readonly subject?: string;
  readonly preheader?: string;
  readonly imports?: string;
  readonly fixtures?: string;
  readonly schema?: string;
  readonly extra?: Readonly<Record<string, string>>;
  readonly id?: string;
}

const entry = ({
  body,
  subject = "(input) => `Hi ${input.name}`",
  preheader,
  imports = "",
  fixtures = `{ default: ${FIXTURE} }`,
  schema = SCHEMA,
  id = "order-shipped",
}: Sources): string => `
import { defineTemplate } from "@samva/markup";
import { fmt } from "@samva/markup/fmt";
import { Email, Section, Button, Columns, Column } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
${imports}

export default defineTemplate({
  id: ${JSON.stringify(id)},
  schema: ${schema},
  fixtures: ${fixtures},
  email: {
    subject: ${subject},
    ${preheader === undefined ? "" : `preheader: ${preheader},`}
    body: ${body},
  },
});
`;

const compile = async (sources: Sources) =>
  compileTemplate({
    files: {
      "templates/entry.tsx": entry(sources),
      "theme.css": THEME,
      ...sources.extra,
    },
    entry: "templates/entry.tsx",
    assetBase: "https://assets.example",
    tailwind: { css: THEME, cssPath: "theme.css" },
  });

const errors = (diagnostics: readonly TemplateDiagnostic[]) =>
  diagnostics.filter((item) => item.severity === "error");

const render = async (sources: Sources, fixture = "default") => {
  const compiled = await compile(sources);
  expect(errors(compiled.diagnostics)).toEqual([]);
  return renderIr(compiled.ir!, compiled.fixtures[fixture]);
};

const codes = async (sources: Sources) =>
  (await compile(sources)).diagnostics.map((item) => item.code);

describe("the static profile accepts", () => {
  it("text and attribute bindings, template strings, conditionals and formatters", async () => {
    const rendered = await render({
      subject: "(input) => `Order ${input.order.id} for ${input.name}`",
      preheader:
        "(input) => `${input.items.length} items, ${fmt.money(input.order.total, input.currency)}`",
      body: `(input) => (
        <Email>
          <p className={input.vip ? "font-bold" : "font-normal"}>Hi {input.name}</p>
          {input.trackingUrl && <a href={input.trackingUrl}>Track</a>}
          {input.plan === "pro" ? <p>Pro</p> : <p>Free</p>}
          {!input.vip && <p>Not vip</p>}
          {input.items.length > 1 && <p>Many</p>}
          {input.items.map((item, i) => (
            <p key={i}>{item.title} {fmt.money(item.price * item.qty, input.currency)}</p>
          ))}
        </Email>
      )`,
    });
    expect(rendered.subject).toBe("Order A-1 for Ada");
    expect(rendered.preheader).toBe("2 items, $84.00");
    expect(rendered.html).toContain("Hi Ada");
    expect(rendered.html).toContain('href="https://track.example/A-1"');
    expect(rendered.html).toContain("<p>Pro</p>");
    expect(rendered.html).not.toContain("Not vip");
    expect(rendered.html).toContain("Many");
    expect(rendered.html).toContain("Shirt $84.00");
    expect(rendered.html).toContain("Hat $10.00");
  });

  it("partials with props and children, and destructured parameters", async () => {
    const rendered = await render({
      imports: 'import { Card, Row } from "./partials";',
      body: `({ name, items }) => (
        <Email>
          <Card title="Your order">
            <p>{name}</p>
            {items.map((item) => (
              <Row item={item} />
            ))}
          </Card>
        </Email>
      )`,
      extra: {
        "templates/partials.tsx": `
          export const Card = ({ title, children }) => (
            <section className="card"><h2>{title}</h2>{children}</section>
          );
          export const Row = ({ item }) => <p>{item.title} x {item.qty}</p>;
        `,
      },
    });
    expect(rendered.html).toContain("<h2>Your order</h2>");
    expect(rendered.html).toContain("<p>Ada</p>");
    expect(rendered.html).toContain("Shirt x 2");
  });

  it("resolves a conditional class to a conditional style", async () => {
    const compiled = await compile({
      body: `(input) => (
        <Email>
          <p className={input.vip ? "font-bold" : "font-normal"}>Hi</p>
        </Email>
      )`,
    });
    expect(errors(compiled.diagnostics)).toEqual([]);
    const vip = renderIr(compiled.ir!, compiled.fixtures.default);
    const plain = renderIr(compiled.ir!, { ...(compiled.fixtures.default as object), vip: false });
    expect(vip.html).toContain('class="font-bold" style="font-weight:700"');
    expect(plain.html).toContain('class="font-normal" style="font-weight:400"');
  });

  it("lets a partial forward a class it was given", async () => {
    const rendered = await render({
      imports: 'import { Note } from "./note";',
      body: `() => (
        <Email>
          <Note className="font-bold" />
        </Email>
      )`,
      extra: {
        "templates/note.tsx":
          "export const Note = ({ className }) => <p className={className}>x</p>;",
      },
    });
    expect(rendered.html).toContain('class="font-bold" style="font-weight:700"');
  });

  it("stamps every element with its source", async () => {
    const compiled = await compile({ body: "() => <Email><p>Hi</p></Email>" });
    expect(JSON.stringify(compiled.ir)).toContain('"src":[');
  });
});

describe("the static profile rejects with a code, a location and a fix", () => {
  const rejected = async (sources: Sources, code: string) => {
    const compiled = await compile(sources);
    const found = compiled.diagnostics.find((item) => item.code === code);
    expect(
      found,
      `${code} in ${compiled.diagnostics.map((item) => item.code).join(", ")}`,
    ).toBeDefined();
    expect(compiled.ir).toBeUndefined();
    expect(found!.origins[0]?.fileName).toMatch(/^templates\//);
    expect(found!.origins[0]?.lineNumber).toBeGreaterThan(0);
    expect(found!.message.length).toBeGreaterThan(0);
    return found!;
  };

  it("calls other than fmt.* and .map", async () => {
    const found = await rejected(
      {
        body: "(input) => <Email><p>{input.items.reduce((sum, item) => sum + item.price, 0)}</p></Email>",
      },
      "dynamic-expression",
    );
    expect(found.fix).toBeDefined();
    await rejected({ body: "() => <Email><p>{Date.now()}</p></Email>" }, "dynamic-expression");
    await rejected({ body: "() => <Email><p>{Math.random()}</p></Email>" }, "dynamic-expression");
  });

  it("statements in a body", async () => {
    await rejected(
      { body: "(input) => { const n = input.name; return <Email>{n}</Email>; }" },
      "statement-in-body",
    );
  });

  it("imports other than @samva/markup and project files", async () => {
    const found = await rejected(
      { imports: 'import pad from "left-pad";', body: "() => <Email>x</Email>" },
      "non-project-import",
    );
    expect(found.message).toContain("left-pad");
  });

  it("hooks", async () => {
    await rejected({ body: "() => <Email><p>{useState(0)}</p></Email>" }, "hook-call");
  });

  it("event handlers and dangerouslySetInnerHTML", async () => {
    await rejected({ body: "() => <Email><p onClick={() => 1}>x</p></Email>" }, "event-handler");
    await rejected(
      { body: "(input) => <Email><p dangerouslySetInnerHTML={{ __html: input.name }} /></Email>" },
      "dangerous-html",
    );
  });

  it("class names built at run time", async () => {
    await rejected(
      { body: "(input) => <Email><p className={`text-${input.plan}`}>x</p></Email>" },
      "dynamic-class",
    );
  });

  it("a class read from the input", async () => {
    await rejected(
      { body: "(input) => <Email><p className={input.name}>x</p></Email>" },
      "dynamic-class",
    );
  });

  it("recursion", async () => {
    await rejected(
      {
        imports: 'import { Loop } from "./loop";',
        body: "() => <Email><Loop /></Email>",
        extra: { "templates/loop.tsx": "export const Loop = () => <p><Loop /></p>;" },
      },
      "recursive-partial",
    );
  });

  it("unsupported elements and attributes", async () => {
    const element = await rejected(
      { body: "() => <Email><blink>x</blink></Email>" },
      "unsupported-element",
    );
    expect(element.message).toContain("<blink>");
    expect(element.fix).toContain("Use one of");
    await rejected({ body: '() => <Email><p foo="x">x</p></Email>' }, "unsupported-attribute");
  });

  it("nullish coalescing, which is not one of the conditions", async () => {
    const found = await rejected(
      { body: '(input) => <Email><p>{input.trackingUrl ?? "none"}</p></Email>' },
      "dynamic-expression",
    );
    expect(found.message).toContain("??");
  });

  it("ids that are not lowercase kebab-case", async () => {
    await rejected({ id: "Order_Shipped", body: "() => <Email>x</Email>" }, "invalid-template-id");
  });
});

describe("the binding checker", () => {
  const finding = async (sources: Sources, code: string) => {
    const compiled = await compile(sources);
    const found = compiled.diagnostics.find((item) => item.code === code);
    expect(
      found,
      compiled.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
    ).toBeDefined();
    return found!;
  };

  it("reports an unknown field with a did-you-mean", async () => {
    const found = await finding(
      { body: "(input) => <Email><p>{input.ordr.id}</p></Email>" },
      "unknown-field",
    );
    expect(found.message).toContain("ordr");
    expect(found.fix).toContain("order");
    const nested = await finding(
      { body: "(input) => <Email><p>{input.order.idd}</p></Email>" },
      "unknown-field",
    );
    expect(nested.fix).toContain("input.order.id");
  });

  it("reports an unguarded optional field and accepts a guarded one", async () => {
    const found = await finding(
      { body: "(input) => <Email><a href={input.trackingUrl}>Track</a></Email>" },
      "unguarded-optional",
    );
    expect(found.message).toContain("trackingUrl");
    expect(
      (
        await codes({
          body: "(input) => <Email>{input.trackingUrl && <a href={input.trackingUrl}>T</a>}</Email>",
        })
      ).includes("unguarded-optional"),
    ).toBe(false);
    // Optional fields inside a loop are checked per item.
    await finding(
      { body: "(input) => <Email>{input.items.map((item) => <p>{item.note}</p>)}</Email>" },
      "unguarded-optional",
    );
    expect(
      (
        await codes({
          body: "(input) => <Email>{input.items.map((item) => <div>{item.note && <p>{item.note}</p>}</div>)}</Email>",
        })
      ).includes("unguarded-optional"),
    ).toBe(false);
  });

  it("does not treat a true !== against a literal as proof the field exists", async () => {
    await finding(
      {
        body: '(input) => <Email>{input.trackingUrl !== "x" && <a href={input.trackingUrl}>T</a>}</Email>',
      },
      "unguarded-optional",
    );
    const guarded = await codes({
      body: '(input) => <Email>{input.trackingUrl === "x" && <a href={input.trackingUrl}>T</a>}{input.trackingUrl !== undefined && <a href={input.trackingUrl}>U</a>}</Email>',
    });
    expect(guarded).not.toContain("unguarded-optional");
  });

  it("does not treat a comparison of two fields as proof that either exists", async () => {
    await finding(
      {
        body: "(input) => <Email>{!(input.trackingUrl !== input.name) && <a href={input.trackingUrl}>T</a>}</Email>",
      },
      "unguarded-optional",
    );
  });

  it("counts a comparison with computed text as a guard", async () => {
    const found = await codes({
      body: "(input) => <Email>{input.trackingUrl === `${input.name}/x` && <a href={input.trackingUrl}>T</a>}</Email>",
    });
    expect(found).not.toContain("unguarded-optional");
  });

  it("orders two strings and still requires numbers otherwise", async () => {
    expect(
      await codes({
        body: "(input) => <Email>{input.name < input.currency && <p>x</p>}</Email>",
      }),
    ).not.toContain("invalid-binding-type");
    await finding(
      { body: "(input) => <Email>{input.name < 3 && <p>x</p>}</Email>" },
      "invalid-binding-type",
    );
  });

  it("reports a fixture that does not match the schema, per fixture", async () => {
    const compiled = await compile({
      body: "() => <Email>x</Email>",
      fixtures: `{ default: ${FIXTURE}, broken: { ...${FIXTURE}, items: [{ title: "Hat", qty: "2", price: 1 }] } }`,
    });
    const found = compiled.diagnostics.filter((item) => item.code === "fixture-invalid");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('"broken"');
  });

  it("checks value types", async () => {
    await finding(
      { body: "(input) => <Email><p>{input.items}</p></Email>" },
      "invalid-binding-type",
    );
    await finding(
      { body: "(input) => <Email><p>{fmt.money(input.name, input.currency)}</p></Email>" },
      "invalid-binding-type",
    );
  });
});

describe("fixtures", () => {
  it("read constants and imported assets without evaluating them", async () => {
    const compiled = await compileTemplate({
      files: {
        "templates/entry.tsx": entry({
          body: "() => <Email>x</Email>",
          imports: 'import logo from "./logo.png";\nconst shared = { plan: "pro" } as const;',
          fixtures: `{ default: { ...${FIXTURE}, ...shared, name: logo } }`,
        }),
        "templates/logo.png": new Uint8Array([1, 2, 3]),
        "theme.css": THEME,
      },
      entry: "templates/entry.tsx",
      assetBase: "https://assets.example",
      tailwind: { css: THEME, cssPath: "theme.css" },
    });
    expect(errors(compiled.diagnostics)).toEqual([]);
    expect(String((compiled.fixtures.default as { name: string }).name)).toMatch(
      /^https:\/\/assets\.example\/[0-9a-f]{64}\.png$/,
    );
  });
});

describe("compatibility", () => {
  it("locates a client finding at the source that produced it", async () => {
    const compiled = await compile({
      body: `() => (
        <Email>
          <div className="flex">
            <p>Side by side</p>
          </div>
        </Email>
      )`,
    });
    expect(errors(compiled.diagnostics)).toEqual([]);
    const findings = checkTemplateCompatibility(compiled.ir!, compiled.fixtures);
    const located = findings.filter((item) => item.origins.length > 0);
    expect(located.length, findings.map((item) => item.code).join(", ")).toBeGreaterThan(0);
    for (const item of located) {
      expect(item.origins[0]?.fileName).toBe("templates/entry.tsx");
      expect(item.origins[0]?.lineNumber).toBeGreaterThan(0);
      expect(item.fixtures).toEqual(["default"]);
    }
  });
});

describe("a project the compiler cannot read", () => {
  const compileFiles = (files: Record<string, string>, entryPath = "templates/entry.tsx") =>
    compileTemplate({
      files: { "theme.css": THEME, ...files },
      entry: entryPath,
      assetBase: "https://assets.example",
      tailwind: { css: THEME, cssPath: "theme.css" },
    });

  it("reports a syntax error at the line it stopped on", async () => {
    const compiled = await compileFiles({
      "templates/entry.tsx": "export default defineTemplate({\n  id: ,",
    });
    expect(compiled.ir).toBeUndefined();
    expect(compiled.diagnostics[0]?.code).toBe("syntax-error");
    expect(compiled.diagnostics[0]?.origins[0]?.lineNumber).toBe(2);
  });

  it("requires the entry to default-export defineTemplate", async () => {
    const compiled = await compileFiles({ "templates/entry.tsx": "export const x = 1;" });
    expect(compiled.diagnostics.map((item) => item.code)).toContain("no-template");
    const legacy = await compileFiles({
      "templates/entry.tsx":
        'import { defineEmail } from "@samva/markup/template";\nexport default defineEmail({ id: "a" });',
    });
    expect(legacy.diagnostics.map((item) => item.code)).toContain("legacy-definition");
  });

  it("reports a moved @samva/markup entry with its replacement and an upgrade recipe", async () => {
    const compiled = await compileFiles({
      "templates/entry.tsx": entry({ body: "() => <Email><p>x</p></Email>" }).replace(
        'from "@samva/markup/email";',
        'from "@samva/markup/email/components";',
      ),
    });
    const moved = compiled.diagnostics.filter((item) => item.code === "moved-import");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.message).toContain("`@samva/markup/email`");
    expect(moved[0]?.origins[0]?.lineNumber).toBe(4);
    expect(hasUpgradeRecipe("moved-import")).toBe(true);
  });

  it("survives import cycles between project files", async () => {
    const compiled = await compileFiles({
      "templates/entry.tsx": entry({
        imports: 'import { A } from "./a";',
        body: "() => <Email><A /></Email>",
      }),
      "templates/a.tsx": 'import { B } from "./b";\nexport const A = () => <B />;',
      "templates/b.tsx": 'import { A } from "./a";\nexport const B = () => <p>x</p>;',
    });
    expect(errors(compiled.diagnostics)).toEqual([]);
  });

  it("refuses a file the entry imports that is not in the project", async () => {
    const compiled = await compileFiles({
      "templates/entry.tsx": entry({
        imports: 'import { A } from "./missing";',
        body: "() => <Email><A /></Email>",
      }),
    });
    expect(compiled.diagnostics.map((item) => item.code)).toContain("unresolved-import");
  });

  it("reads a self-referencing fixture constant without looping", async () => {
    const compiled = await compileFiles({
      "templates/entry.tsx": entry({
        imports: "const loop = { next: loop };",
        body: "() => <Email>x</Email>",
        fixtures: "{ default: loop }",
      }),
    });
    expect(compiled.diagnostics.map((item) => item.code)).toContain("fixtures-not-static");
  });
});

describe("chunked columns", () => {
  const grid = (attributes: string) => `(input) => (
    <Email>
      <Columns ${attributes}>
        {(item, i) => (
          <Column className="cell" valign="top">
            <p>{item.title} {i}</p>
          </Column>
        )}
      </Columns>
    </Email>
  )`;
  const items = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ title: `T${index}`, qty: 1, price: 1 }));
  const withItems = (count: number) => ({
    ...(JSON.parse(
      JSON.stringify({
        name: "Ada",
        order: { id: "A", total: 1 },
        vip: false,
        currency: "USD",
        plan: "pro",
      }),
    ) as object),
    items: items(count),
  });

  it("makes one Columns table per chunk and keeps the last partial row's cell width", async () => {
    const compiled = await compile({ body: grid("each={input.items} per={2}") });
    expect(errors(compiled.diagnostics)).toEqual([]);
    const html = renderIr(compiled.ir!, withItems(3)).html;
    expect(html.match(/<td class="cell"/g)).toHaveLength(3);
    expect(html.match(/width="50%"/g)).toHaveLength(3);
    // Index restarts in each row.
    expect(html).toContain("T0 0");
    expect(html).toContain("T1 1");
    expect(html).toContain("T2 0");
    expect(renderIr(compiled.ir!, withItems(0)).html).not.toContain('class="cell"');
  });

  it("splits a single row equally, rounded down, for any count", async () => {
    const compiled = await compile({ body: grid("each={input.items}") });
    expect(errors(compiled.diagnostics)).toEqual([]);
    for (const [count, width] of [
      [1, 100],
      [2, 50],
      [3, 33],
      [4, 25],
      [6, 16],
      [7, 14],
    ] as const)
      expect(
        renderIr(compiled.ir!, withItems(count)).html.match(
          new RegExp(`class="cell" valign="top" width="${width}%"`, "g"),
        ),
      ).toHaveLength(count);
  });

  it("refuses a Columns each without a function child", async () => {
    const found = await compile({
      body: "(input) => <Email><Columns each={input.items}><Column>x</Column></Columns></Email>",
    });
    expect(found.diagnostics.map((item) => item.code)).toContain("invalid-columns-each");
  });
});

describe("filter", () => {
  it("filters before .map and counts before .length", async () => {
    const rendered = await render({
      body: `(input) => (
        <Email>
          <p>{input.items.filter((item) => item.qty > 1).length} of {input.items.length} bulk</p>
          {input.items.filter((item) => item.qty > 1 && item.price > 0).map((item) => (
            <p>{item.title}</p>
          ))}
          {input.items.filter((item) => item.note).filter((item) => item.qty === 1).map((item) => (
            <p>{item.note}</p>
          ))}
        </Email>
      )`,
    });
    expect(rendered.html).toContain("1 of 2 bulk");
    expect(rendered.html).toContain("<p>Shirt</p>");
    expect(rendered.html).not.toContain("<p>Hat</p>");
    expect(rendered.html).toContain("<p>Gift</p>");
  });

  it("checks the predicate's bindings and refuses non-static predicates", async () => {
    const unknown = await compile({
      body: "(input) => <Email>{input.items.filter((item) => item.qtty > 1).map((item) => <p>{item.title}</p>)}</Email>",
    });
    expect(unknown.diagnostics.map((item) => item.code)).toContain("unknown-field");
    const dynamic = await compile({
      body: "(input) => <Email>{input.items.filter((item) => item.title.includes('a')).length}</Email>",
    });
    expect(dynamic.diagnostics.map((item) => item.code)).toContain("dynamic-expression");
    const alone = await compile({
      body: "(input) => <Email>{input.items.filter((item) => item.qty > 1)}</Email>",
    });
    expect(alone.diagnostics.map((item) => item.code)).toContain("dynamic-expression");
    const indexed = await compile({
      body: "(input) => <Email>{input.items.filter((item, i) => i > 0).length}</Email>",
    });
    expect(indexed.diagnostics.map((item) => item.code)).toContain("dynamic-expression");
  });
});
