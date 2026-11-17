import { describe, expect, it } from "@effect/vitest";
import type { EmailElementSelection } from "@samva/markup/edit";

import { elementRole, humanizeName, roleCrumbs, type RoleSource } from "../src/chrome/element-role";
import { friendlyName } from "../src/chrome/friendly";

const FILE = "src/Order.tsx";

/** The origin of the first `snippet` in `source`, as the compiler records it (1-based line and column). */
const originOf = (source: string, snippet: string) => {
  const offset = source.indexOf(snippet);
  expect(offset, `${snippet} is in the source`).toBeGreaterThanOrEqual(0);
  const before = source.slice(0, offset).split("\n");
  return { fileName: FILE, lineNumber: before.length, columnNumber: before.at(-1)!.length + 1 };
};

let counter = 0;
const selection = (
  source: string,
  snippet: string,
  tag = "table",
  calls: ReadonlyArray<string> = [],
): EmailElementSelection => {
  counter += 1;
  return {
    instancePath: `0.${counter}`,
    tag,
    authored: true,
    origins: [snippet, ...calls].map((entry) => originOf(source, entry)),
    occurrence: 1,
    occurrences: 1,
    start: 0,
    end: 0,
  } as EmailElementSelection;
};

const roleOf = (source: string, snippet: string, tag?: string, calls?: ReadonlyArray<string>) =>
  elementRole(selection(source, snippet, tag, calls), { file: FILE, source });

describe("elementRole", () => {
  it("names a custom component by what it is", () => {
    const source = `<Email>\n  <OrderCard total={3}>\n    <Heading>Hi</Heading>\n  </OrderCard>\n</Email>`;
    expect(roleOf(source, "<OrderCard")).toEqual({ label: "Order card", named: true });
    // An element rendered inside the component is named after the component that placed it.
    expect(roleOf(source, "<Heading", "h1", ["<OrderCard"])).toEqual({
      label: "Order card",
      named: true,
    });
  });

  it("does not count the markup components as names", () => {
    const source = `<Email>\n  <Section>\n    <Heading>Hi</Heading>\n  </Section>\n</Email>`;
    expect(roleOf(source, "<Section")).toEqual({ label: "Section", named: false });
    expect(roleOf(source, "<Heading", "h1")).toEqual({ label: "Heading", named: false });
  });

  it("prefers a comment the author wrote right before the element", () => {
    const source = `<Email>\n  {/* Order summary */}\n  <Section className="bg-card rounded-lg">x</Section>\n</Email>`;
    expect(roleOf(source, "<Section")).toEqual({ label: "Order summary", named: true });
  });

  it("reads aria-label, title, id and data-name, humanising ids", () => {
    const source = `<>\n${[
      `<Section aria-label="Shipping details">a</Section>`,
      `<Section id="order-card">b</Section>`,
      `<Section data-name="priceRow">c</Section>`,
      `<Section id={dynamic}>d</Section>`,
    ].join("\n")}\n</>`;
    expect(roleOf(source, `<Section aria-label`).label).toBe("Shipping details");
    expect(roleOf(source, `<Section id="order-card"`).label).toBe("Order card");
    expect(roleOf(source, `<Section data-name`).label).toBe("Price row");
    expect(roleOf(source, `<Section id={dynamic}`)).toEqual({ label: "Section", named: false });
  });

  it("gives a coloured block with rounded corners or a border the role of a card", () => {
    const source = `<>\n${[
      `<Section className="bg-card rounded-lg p-4">a</Section>`,
      `<Section className="bg-muted border p-4">b</Section>`,
      `<Section className="rounded-lg p-4">c</Section>`,
      `<Section className="bg-card rounded-none">d</Section>`,
    ].join("\n")}\n</>`;
    expect(roleOf(source, `<Section className="bg-card rounded-lg`)).toEqual({
      label: "Card",
      named: true,
    });
    expect(roleOf(source, `<Section className="bg-muted border`).label).toBe("Card");
    // A radius or border alone does not make a card, and a square block is not one.
    expect(roleOf(source, `<Section className="rounded-lg`).named).toBe(false);
    expect(roleOf(source, `<Section className="bg-card rounded-none`).named).toBe(false);
  });

  it("calls a full-width coloured block a band", () => {
    const source = `<Section className="bg-primary w-full py-6">a</Section>`;
    expect(roleOf(source, "<Section")).toEqual({ label: "Band", named: true });
  });

  it("calls a block holding only an image an image, and Columns columns", () => {
    const source = `<>\n${[
      `<Section className="p-4">\n  <Image src="/logo.png" alt="Logo" />\n</Section>`,
      `<Section className="p-4">\n  <Image src="/a.png" />\n  <Text>hi</Text>\n</Section>`,
      `<Columns items={rows}>{(row) => <Column>{row}</Column>}</Columns>`,
    ].join("\n")}\n</>`;
    expect(roleOf(source, `<Section className="p-4">\n  <Image src="/logo`).label).toBe("Image");
    expect(roleOf(source, `<Section className="p-4">\n  <Image src="/a`).named).toBe(false);
    expect(roleOf(source, "<Columns", "table").label).toBe("Columns");
  });

  it("falls back to the friendly tag name when the source cannot be read", () => {
    const source = `<Email></Email>`;
    const unreadable = selection(source, "<Email", "table");
    expect(elementRole(unreadable, { file: "other.tsx", source })).toEqual({
      label: friendlyName(unreadable, source),
      named: false,
    });
  });
});

describe("roleCrumbs", () => {
  const authored = (source: string): RoleSource => ({ file: FILE, source });

  it("drops a plain block when a named one is in the chain", () => {
    const source = `<>\n${[
      `<Section>`,
      `{/* Order card */}`,
      `<Section>`,
      `<Heading>Hi</Heading>`,
      `</Section>`,
      `</Section>`,
    ].join("\n")}\n</>`;
    const outer = selection(source, "<Section>");
    const card = selection(source, "<Section>\n<Heading");
    expect(roleCrumbs([outer, card], authored(source), "Heading")).toEqual([
      { instancePath: card.instancePath, label: "Order card" },
    ]);
  });

  it("never shows the same name twice in a row", () => {
    const source = `<Section>\n<Section>\n<Heading>Hi</Heading>\n</Section>\n</Section>`;
    const outer = selection(source, "<Section>\n<Section");
    const inner = selection(source, "<Section>\n<Heading");
    const crumbs = roleCrumbs([outer, inner], authored(source), "Heading");
    expect(crumbs.map((crumb) => crumb.label)).toEqual(["Section"]);
    // The nearer one stays, so the crumb selects the block closest to the element.
    expect(crumbs[0]?.instancePath).toBe(inner.instancePath);
  });

  it("drops a block named like the selected element", () => {
    const source = `<Section>\n<Section>x</Section>\n</Section>`;
    const outer = selection(source, "<Section>\n<Section");
    expect(roleCrumbs([outer], authored(source), "Section")).toEqual([]);
  });

  it("keeps at most the nearest two", () => {
    const source = `<>\n${[
      `<OrderCard>a</OrderCard>`,
      `<Section id="top-band">b</Section>`,
      `<Section className="bg-card border">c</Section>`,
    ].join("\n")}\n</>`;
    const crumbs = roleCrumbs(
      [
        selection(source, "<OrderCard"),
        selection(source, `<Section id="top-band"`),
        selection(source, `<Section className`),
      ],
      authored(source),
      "Heading",
    );
    expect(crumbs.map((crumb) => crumb.label)).toEqual(["Top band", "Card"]);
  });
});

describe("humanizeName", () => {
  it("reads kebab, snake and camel case as a sentence", () => {
    expect(humanizeName("order-card")).toBe("Order card");
    expect(humanizeName("OrderCard")).toBe("Order card");
    expect(humanizeName("price_row")).toBe("Price row");
  });
});
