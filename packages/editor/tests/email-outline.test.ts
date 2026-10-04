import { describe, expect, it } from "@effect/vitest";
import type { JsxSourceLocation } from "@samva/markup/edit";
import { emailSelections, type EmittedPosition } from "@samva/markup/render";

import {
  authoringOrigin,
  defaultExpanded,
  emailOutline,
  formatOrigin,
  outlineAncestry,
  outlineBreadcrumb,
  outlineEntries,
  selectionComponentLabel,
  selectionKindLabel,
  selectionLabel,
  selectionTextExcerpt,
} from "../src/chrome/email-outline";

const at = (lineNumber: number, columnNumber: number): JsxSourceLocation => ({
  fileName: "src/Welcome.tsx",
  lineNumber,
  columnNumber,
});

const EMAIL_CALL = at(17, 5);
const CONTAINER_CALL = at(18, 7);
const ROW_CALL = at(28, 13);

/**
 * Positions as a serializer emits them: innermost-first, with `start`/`end`
 * describing where each element sits in the rendered HTML. `emailSelections`
 * is what puts them back into document order.
 */
const POSITIONS: ReadonlyArray<EmittedPosition> = [
  {
    instancePath: "0.0.0",
    tag: "h1",
    authored: true,
    origins: [at(20, 9), CONTAINER_CALL],
    start: 40,
    end: 70,
  },
  {
    instancePath: "0.0.1.0",
    tag: "tr",
    authored: true,
    origins: [ROW_CALL, CONTAINER_CALL],
    start: 90,
    end: 110,
  },
  {
    instancePath: "0.0.1.1",
    tag: "tr",
    authored: true,
    origins: [ROW_CALL, CONTAINER_CALL],
    start: 110,
    end: 130,
  },
  {
    instancePath: "0.0.1",
    tag: "table",
    authored: true,
    origins: [at(26, 9), CONTAINER_CALL],
    start: 80,
    end: 140,
  },
  {
    instancePath: "0.0",
    tag: "div",
    authored: true,
    origins: [CONTAINER_CALL, EMAIL_CALL],
    start: 30,
    end: 150,
  },
  { instancePath: "0", tag: "body", authored: false, origins: [EMAIL_CALL], start: 20, end: 160 },
];

const outline = emailOutline(emailSelections(POSITIONS));

describe("emailOutline", () => {
  it("builds the tree from parentPath, in document order", () => {
    expect(outline.roots.map((root) => root.instancePath)).toStrictEqual(["0"]);
    expect(outline.roots[0]?.children.map((child) => child.instancePath)).toStrictEqual(["0.0"]);
    const container = outline.nodes.get("0.0");
    expect(container?.children.map((child) => child.instancePath)).toStrictEqual([
      "0.0.0",
      "0.0.1",
    ]);
    expect(outline.nodes.get("0.0.1")?.children.map((child) => child.instancePath)).toStrictEqual([
      "0.0.1.0",
      "0.0.1.1",
    ]);
  });

  it("indexes every rendered element and resolves the node the walk found", () => {
    expect([...outline.index.keys()]).toStrictEqual([
      "0",
      "0.0",
      "0.0.0",
      "0.0.1",
      "0.0.1.0",
      "0.0.1.1",
    ]);
    expect(outline.nodes.get("0.0.0")?.selection).toBe(outline.index.get("0.0.0"));
  });

  it("treats an element whose parent is absent from this render as a root", () => {
    const orphaned = emailOutline(
      emailSelections([
        { instancePath: "3.1", tag: "p", authored: true, origins: [at(21, 9)], start: 0, end: 10 },
      ]),
    );
    expect(orphaned.roots.map((root) => root.instancePath)).toStrictEqual(["3.1"]);
  });

  it("flattens every rendered layer with its hierarchy depth", () => {
    expect(outlineEntries(outline).map(({ depth, node }) => [node.instancePath, depth])).toEqual([
      ["0", 0],
      ["0.0", 1],
      ["0.0.0", 2],
      ["0.0.1", 2],
      ["0.0.1.0", 3],
      ["0.0.1.1", 3],
    ]);
  });
});

describe("Assistant layer labels", () => {
  it("uses the authored component and a bounded recipient-text excerpt", () => {
    const selection = outline.index.get("0.0.0");
    if (selection === undefined) throw new Error("missing heading selection");
    const source = Array.from({ length: 19 }, () => "")
      .concat("        <Heading>Welcome</Heading>")
      .join("\n");
    const html = `${" ".repeat(40)}<h1>Welcome to Nimbus</h1>${" ".repeat(80)}`;

    expect(selectionComponentLabel(selection, source)).toBe("Heading");
    expect(selectionTextExcerpt(selection, html)).toBe("Welcome to Nimbus");
  });
});

describe("outlineAncestry + outlineBreadcrumb", () => {
  it("walks ancestors outermost-first, excluding the element itself", () => {
    expect(outlineAncestry(outline, "0.0.1.0")).toStrictEqual(["0", "0.0", "0.0.1"]);
    expect(outlineAncestry(outline, "0")).toStrictEqual([]);
  });

  it("builds a breadcrumb that ends at the element", () => {
    expect(outlineBreadcrumb(outline, "0.0.1.0")).toStrictEqual([
      { instancePath: "0", label: "body" },
      { instancePath: "0.0", label: "div" },
      { instancePath: "0.0.1", label: "table" },
      { instancePath: "0.0.1.0", label: "tr 1 of 2" },
    ]);
  });

  it("has nothing to say about a path outside this render", () => {
    expect(outlineAncestry(outline, "9.9")).toStrictEqual([]);
    expect(outlineBreadcrumb(outline, "9.9")).toStrictEqual([]);
  });
});

describe("defaultExpanded", () => {
  it("opens the root and every child of it that holds children", () => {
    const expanded = defaultExpanded(outline);
    expect([...expanded].toSorted()).toStrictEqual(["0", "0.0"]);
  });

  it("is empty without an outline", () => {
    expect(defaultExpanded(null).size).toBe(0);
  });
});

describe("selection labels", () => {
  it("names which iteration of a repeated authoring an element is", () => {
    expect(selectionLabel(outline.index.get("0.0.0")!)).toBe("h1");
    expect(selectionLabel(outline.index.get("0.0.1.1")!)).toBe("tr 2 of 2");
  });

  it("says outright when the renderer generated an element", () => {
    expect(selectionKindLabel(outline.index.get("0")!)).toBe("Generated");
    expect(selectionKindLabel(outline.index.get("0.0")!)).toBe("Authored");
  });

  it("points at the authoring that produced an element", () => {
    expect(authoringOrigin(outline.index.get("0.0.1.0")!)).toStrictEqual(ROW_CALL);
    expect(formatOrigin(ROW_CALL)).toBe("src/Welcome.tsx:28:13");
  });
});
