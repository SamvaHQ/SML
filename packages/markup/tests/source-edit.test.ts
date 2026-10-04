import { describe, expect, it } from "@effect/vitest";

import { buildLineMap, lineColumn } from "../src/diagnostics";
import {
  applySourceReplacements,
  classNameEdit,
  expressionReplacement,
  inspectSourceElement,
  inspectSourceFixtures,
  literalReplacement,
  structuralReplacements,
  type SourceReplacement,
} from "../src/source-edit";

const source = `const body = <div><a href="https://example.com" className="text-red-500">{user.name}</a><p>{price * 2}</p><span>Hello</span></div>;`;
const at = (text: string) =>
  inspectSourceElement(source, "src/Email.tsx", {
    fileName: "src/Email.tsx",
    lineNumber: 1,
    columnNumber: source.indexOf(text) + 1,
  });

describe("source-aware edits", () => {
  it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
    "resolves compiler origins across %j line breaks",
    (newline) => {
      const input = ["const heading = 'Hello';", "const body = (", "  <p>Hello</p>", ");"].join(
        newline,
      );
      const start = input.indexOf("<p>");
      const position = lineColumn(buildLineMap(input), start);
      const element = inspectSourceElement(input, "a.tsx", {
        fileName: "a.tsx",
        lineNumber: position.line,
        columnNumber: position.column,
      })!;
      expect(element).not.toBeNull();
      expect(
        applySourceReplacements(input, [
          literalReplacement(input, element.properties[0]!, "World")!,
        ]),
      ).toEqual({ ok: true, source: input.replace("Hello</p>", "World</p>") });
    },
  );
  it("edits a literal style value while preserving computed sibling styles", () => {
    const input = 'const body = <p style={{color: "red", padding: amount * 2}}>Hi</p>;';
    const element = inspectSourceElement(input, "a.tsx", {
      fileName: "a.tsx",
      lineNumber: 1,
      columnNumber: input.indexOf("<p") + 1,
    })!;
    const color = element.properties.find((field) => field.name === "style.color")!;
    expect(element.properties.find((field) => field.name === "style.padding")?.kind).toBe(
      "computed",
    );
    expect(applySourceReplacements(input, [literalReplacement(input, color, "blue")!])).toEqual({
      ok: true,
      source: input.replace('"red"', '"blue"'),
    });
  });

  it("keeps bindings and computed expressions distinct from literal attributes", () => {
    const link = at("<a");
    expect(link?.properties.map(({ name, kind }) => [name, kind])).toEqual([
      ["children", "binding"],
      ["href", "literal"],
      ["className", "literal"],
    ]);
    expect(at("<p")?.properties[0]?.kind).toBe("computed");
    const field = link!.properties[0]!;
    expect(literalReplacement(source, field, "Someone")).toBeNull();
    const edit = expressionReplacement(source, field, "user.displayName");
    const result = applySourceReplacements(source, [edit]);
    expect(result).toEqual({ ok: true, source: source.replace("user.name", "user.displayName") });
  });
  it("escapes text as a string and does not turn markup-shaped text into JSX", () => {
    const field = at("<span")!.properties[0]!;
    const edit = literalReplacement(source, field, '<img src="x">')!;
    expect(applySourceReplacements(source, [edit])).toEqual({
      ok: true,
      source: source.replace("Hello", '{"<img src=\\"x\\">"}'),
    });
  });
  it("refuses stale ranges and invalid expression changes without touching source", () => {
    const field = at("<a")!.properties[0]!;
    expect(
      applySourceReplacements(`// concurrent\n${source}`, [
        expressionReplacement(source, field, "user.email"),
      ]).ok,
    ).toBe(false);
    expect(
      applySourceReplacements(source, [expressionReplacement(source, field, "user.")]).ok,
    ).toBe(false);
  });
  it("moves whole sibling blocks and refuses deleting a conditional branch", () => {
    const element = at("<span")!;
    const container = at("<div")!;
    expect(
      applySourceReplacements(source, structuralReplacements(source, element, { kind: "delete" })!),
    ).toEqual({ ok: true, source: source.replace("<span>Hello</span>", "") });
    expect(structuralReplacements(source, container, { kind: "delete" })).toBeNull();
    expect(
      structuralReplacements(source, container, { kind: "move", destination: element }),
    ).toBeNull();
    const conditional = "const body = ok ? <p>Yes</p> : null;";
    const branch = inspectSourceElement(conditional, "a.tsx", {
      fileName: "a.tsx",
      lineNumber: 1,
      columnNumber: conditional.indexOf("<p") + 1,
    })!;
    expect(structuralReplacements(conditional, branch, { kind: "delete" })).toBeNull();
  });
  it("discovers declared fixture source separately from rendered bindings", () => {
    const input =
      'export default defineTemplate({fixtures: {sample: {name: "Ada"}, other: {name: "Lin"}}, email: {subject: () => "s", body: (data) => <p>{data.name}</p>}});';
    const fixture = inspectSourceFixtures(input)[0]!;
    expect(fixture.name).toBe("sample");
    const result = applySourceReplacements(input, [
      { start: fixture.start, end: fixture.end, before: fixture.source, after: '{name: "Grace"}' },
    ]);
    expect(result).toEqual({ ok: true, source: input.replace('name: "Ada"', 'name: "Grace"') });
  });
});

const ORDER = `import { defineTemplate } from "@samva/markup";
import { Email, Section } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

const fixture = { name: "Ada", items: ["Shirt", "Hat"], url: "https://a.example" };

export default defineTemplate({
  id: "order-shipped",
  schema: jsonSchema<{ name: string; items: string[]; url: string; vip?: boolean }>({
    type: "object",
    properties: {
      name: { type: "string" },
      items: { type: "array", items: { type: "string" } },
      url: { type: "string" },
      vip: { type: "boolean" },
    },
    required: ["name", "items", "url"],
    additionalProperties: false,
  }),
  fixtures: { default: fixture },
  email: {
    subject: (input) => \`Hi \${input.name}\`,
    body: (input) => (
      <Email>
        <Section>
          <h1   className="text-lg font-bold">Hello {input.name}</h1>
          <p className={input.vip ? "text-red-500" : "text-sm"}>Thanks</p>
          <a href="https://example.com/a" title='One'>Open</a>
          <img src="https://example.com/a.png" alt="Logo" />
          <ul>
            {input.items.map((item) => (
              <li>{item}</li>
            ))}
          </ul>
        </Section>
      </Email>
    ),
  },
});
`;
const ENTRY = "templates/order.tsx";
const guard = { profile: { entry: ENTRY } } as const;
const find = (tag: string, nth = 0) => {
  let from = -1;
  for (let index = 0; index <= nth; index += 1) from = ORDER.indexOf(`<${tag}`, from + 1);
  const { line, column } = lineColumn(buildLineMap(ORDER), from);
  const element = inspectSourceElement(ORDER, ENTRY, {
    fileName: ENTRY,
    lineNumber: line,
    columnNumber: column,
  });
  expect(element).not.toBeNull();
  return element!;
};
const applied = (edits: readonly SourceReplacement[] | null, options = guard) => {
  expect(edits).not.toBeNull();
  const result = applySourceReplacements(ORDER, edits!, options);
  expect(result.ok).toBe(true);
  return result.ok ? result.source : "";
};

describe("static-profile source edits", () => {
  it("edits static text in place and keeps every other byte", () => {
    const heading = find("h1");
    const text = heading.properties.find((field) => field.name === "text.0")!;
    expect(text.value).toBe("Hello");
    expect(applied([literalReplacement(ORDER, text, "Welcome")!])).toBe(
      ORDER.replace("Hello {input.name}", "Welcome {input.name}"),
    );
    const paragraph = find("p");
    const thanks = paragraph.properties.find((field) => field.name === "children")!;
    expect(thanks.kind).toBe("literal");
    const next = applied([literalReplacement(ORDER, thanks, "Thank you")!]);
    expect(next).toBe(ORDER.replace(">Thanks<", ">Thank you<"));
  });

  it("edits a literal attribute and preserves the quote-free text around it", () => {
    const link = find("a");
    const href = link.properties.find((field) => field.name === "href")!;
    const next = applied([literalReplacement(ORDER, href, "https://example.com/b")!]);
    expect(next).toBe(ORDER.replace('"https://example.com/a"', '"https://example.com/b"'));
    const image = find("img");
    const alt = image.properties.find((field) => field.name === "alt")!;
    expect(applied([literalReplacement(ORDER, alt, "Mark")!])).toBe(
      ORDER.replace('alt="Logo"', 'alt="Mark"'),
    );
  });

  it("replaces, extends and trims a literal className", () => {
    const heading = find("h1");
    const set = classNameEdit(ORDER, heading, { kind: "set", value: "text-xl" });
    expect(set.ok && applied(set.edits)).toBe(ORDER.replace('"text-lg font-bold"', '"text-xl"'));
    const add = classNameEdit(ORDER, heading, { kind: "add", tokens: "italic font-bold" });
    expect(add.ok && applied(add.edits)).toBe(
      ORDER.replace('"text-lg font-bold"', '"text-lg font-bold italic"'),
    );
    const remove = classNameEdit(ORDER, heading, { kind: "remove", tokens: "font-bold" });
    expect(remove.ok && applied(remove.edits)).toBe(
      ORDER.replace('"text-lg font-bold"', '"text-lg"'),
    );
  });

  it("adds a className where there is none and refuses a spread", () => {
    const image = find("img");
    const added = classNameEdit(ORDER, image, { kind: "add", tokens: "w-full" });
    expect(added.ok && applied(added.edits)).toBe(
      ORDER.replace('alt="Logo" />', 'alt="Logo" className="w-full" />'),
    );
    const spread = "const body = <p {...rest}>x</p>;";
    const element = inspectSourceElement(spread, "a.tsx", {
      fileName: "a.tsx",
      lineNumber: 1,
      columnNumber: spread.indexOf("<p") + 1,
    })!;
    expect(classNameEdit(spread, element, { kind: "add", tokens: "a" }).ok).toBe(false);
  });

  it("refuses to clobber a conditional className", () => {
    const paragraph = find("p");
    const result = classNameEdit(ORDER, paragraph, { kind: "set", value: "text-xs" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("input.vip");
  });

  it("deletes, duplicates and reorders whole sibling blocks", () => {
    const image = find("img");
    expect(applied(structuralReplacements(ORDER, image, { kind: "delete" }))).toBe(
      ORDER.replace('          <img src="https://example.com/a.png" alt="Logo" />\n', ""),
    );
    const duplicated = applied(structuralReplacements(ORDER, image, { kind: "duplicate" }));
    expect(duplicated).toBe(
      ORDER.replace(
        '<img src="https://example.com/a.png" alt="Logo" />\n',
        '<img src="https://example.com/a.png" alt="Logo" />\n          <img src="https://example.com/a.png" alt="Logo" />\n',
      ),
    );
    const link = find("a");
    const moved = applied(
      structuralReplacements(ORDER, link, { kind: "reorder", direction: "after" }),
    );
    expect(moved).toBe(
      ORDER.replace(
        '<a href="https://example.com/a" title=\'One\'>Open</a>\n          <img src="https://example.com/a.png" alt="Logo" />',
        '<img src="https://example.com/a.png" alt="Logo" />\n          <a href="https://example.com/a" title=\'One\'>Open</a>',
      ),
    );
    expect(
      structuralReplacements(ORDER, find("h1"), { kind: "reorder", direction: "before" }),
    ).toBeNull();
  });

  it("inserts a child block before the closing tag", () => {
    const section = find("Section");
    const next = applied(structuralReplacements(ORDER, section, { kind: "insert", tsx: "<hr />" }));
    expect(next).toContain("<hr /></Section>");
  });

  it("refuses an edit that leaves the static profile and reports why", () => {
    const field = find("p").properties.find((item) => item.name === "children")!;
    const call = applySourceReplacements(
      ORDER,
      [expressionReplacement(ORDER, field, "input.name.toUpperCase()")],
      guard,
    );
    expect(call.ok).toBe(false);
    expect(!call.ok && call.reason).toContain("static profile");
    const typo = applySourceReplacements(
      ORDER,
      [expressionReplacement(ORDER, field, "input.nmae")],
      guard,
    );
    expect(typo.ok).toBe(false);
    const bind = applySourceReplacements(
      ORDER,
      [expressionReplacement(ORDER, field, "input.name")],
      guard,
    );
    expect(bind).toEqual({ ok: true, source: ORDER.replace(">Thanks<", ">{input.name}<") });
  });

  it("does not let an unrelated pre-existing error block an edit", () => {
    const broken = ORDER.replace("<p className", "<p>{input.nmae}</p>\n<p className");
    const link = inspectSourceElement(broken, ENTRY, {
      fileName: ENTRY,
      ...(({ line, column }) => ({ lineNumber: line, columnNumber: column }))(
        lineColumn(buildLineMap(broken), broken.indexOf("<a ")),
      ),
    })!;
    const href = link.properties.find((field) => field.name === "href")!;
    expect(
      applySourceReplacements(
        broken,
        [literalReplacement(broken, href, "https://x.example")!],
        guard,
      ).ok,
    ).toBe(true);
  });

  it("checks a partial edit against the entry that uses it", () => {
    const entry = ORDER.replace(
      "import { jsonSchema }",
      'import { Card } from "./card";\nimport { jsonSchema }',
    ).replace("<Section>", "<Section>\n<Card name={input.name} />");
    const partial = "export const Card = ({ name }: { name: string }) => <p>{name}</p>;";
    const from = partial.indexOf("<p>");
    const element = inspectSourceElement(partial, "templates/card.tsx", {
      fileName: "templates/card.tsx",
      lineNumber: 1,
      columnNumber: from + 1,
    })!;
    const field = element.properties[0]!;
    const options = {
      profile: { entry: ENTRY, file: "templates/card.tsx", files: { [ENTRY]: entry } },
    };
    expect(
      applySourceReplacements(partial, [expressionReplacement(partial, field, "name")], options).ok,
    ).toBe(true);
    const refused = applySourceReplacements(
      partial,
      [expressionReplacement(partial, field, "name.trim()")],
      options,
    );
    expect(refused.ok).toBe(false);
  });

  it("edits a fixture declared as a named constant where the constant lives", () => {
    const fixture = inspectSourceFixtures(ORDER)[0]!;
    expect(fixture.name).toBe("default");
    expect(fixture.source).toContain('name: "Ada"');
    const next = applied([
      {
        start: fixture.start,
        end: fixture.end,
        before: fixture.source,
        after: fixture.source.replace("Ada", "Grace"),
      },
    ]);
    expect(next).toBe(ORDER.replace('name: "Ada"', 'name: "Grace"'));
  });
});
