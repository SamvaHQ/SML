import { describe, expect, it } from "@effect/vitest";
import { compileTemplate } from "@samva/markup/compiler";
import { previewEmail } from "@samva/markup/edit";

import {
  NIMBUS_ENTRY_FILE,
  NIMBUS_TEMPLATE_TSX,
  NIMBUS_THEME_CSS,
  NIMBUS_THEME_FILE,
} from "../dev/nimbus-template";
import { emailOutline } from "../src/chrome/email-outline";
import {
  authoredAncestry,
  authoredTree,
  friendlyName,
  nearestAuthored,
  propLabel,
  themeColors,
  usedColorTokens,
  type AuthoredNode,
} from "../src/chrome/friendly";

const nimbus = async () => {
  const compiled = await compileTemplate({
    files: { [NIMBUS_ENTRY_FILE]: NIMBUS_TEMPLATE_TSX, [NIMBUS_THEME_FILE]: NIMBUS_THEME_CSS },
    entry: NIMBUS_ENTRY_FILE,
    assetBase: "https://assets.nimbus.example",
    tailwind: { css: NIMBUS_THEME_CSS, cssPath: NIMBUS_THEME_FILE },
  });
  if (compiled.template === undefined) throw new Error("the Nimbus template did not compile");
  const fixture = compiled.fixtures.welcome;
  return emailOutline(previewEmail(compiled.template, fixture).selections);
};

const names = (nodes: ReadonlyArray<AuthoredNode>): unknown =>
  nodes.map((node) => {
    const name = friendlyName(node.selection, NIMBUS_TEMPLATE_TSX);
    const label = node.copies > 1 ? `${name} ×${node.copies}` : name;
    return node.children.length === 0 ? label : { [label]: names(node.children) };
  });

describe("authored layers", () => {
  it("shows what the author wrote, by name, without the compiler's tables", async () => {
    const outline = await nimbus();
    expect(names(authoredTree(outline))).toEqual([
      {
        Email: [
          { Section: ["Image"] },
          {
            Section: [
              "Text",
              "Heading",
              "Text",
              "Spacer",
              "Button",
              "Spacer",
              "Divider",
              "Spacer",
              { Columns: [{ "Column ×3": [{ Box: ["Text"] }] }] },
              "Spacer",
              { Section: ["Text", "Text"] },
            ],
          },
          { Section: [{ Text: ["Link"] }, "Text"] },
        ],
      },
    ]);
  });

  it("lands a click on scaffolding on the authored block, and walks authored ancestors only", async () => {
    const outline = await nimbus();
    const cell = [...outline.index.values()].find(
      (selection) => !selection.authored && selection.tag === "td",
    );
    expect(cell).toBeDefined();
    const block = nearestAuthored(outline, cell!.instancePath);
    expect(block?.authored).toBe(true);
    const heading = [...outline.index.values()].find((selection) => selection.tag === "h1")!;
    expect(
      authoredAncestry(outline, heading.instancePath).map((entry) =>
        friendlyName(entry, NIMBUS_TEMPLATE_TSX),
      ),
    ).toEqual(["Section"]);
  });
});

describe("theme colors", () => {
  it("reads the light colors in declaration order", () => {
    const colors = themeColors(NIMBUS_THEME_CSS);
    expect(colors.slice(0, 3)).toEqual([
      { name: "background", value: "#f4ede3" },
      { name: "foreground", value: "#2b1d14" },
      { name: "card", value: "#ffffff" },
    ]);
    expect(colors.find((color) => color.name === "primary")?.value).toBe("#b4532a");
  });

  it("falls back to the color tokens a template uses, leaving sizes and alignment out", () => {
    expect(usedColorTokens(NIMBUS_TEMPLATE_TSX)).toEqual(
      expect.arrayContaining(["primary", "card-foreground", "accent", "muted-foreground"]),
    );
    expect(usedColorTokens('<p className="text-center text-[14px] text-lg bg-card">')).toEqual([
      "card",
    ]);
  });

  it("names props the way a form would", () => {
    expect(propLabel("paddingX")).toBe("Padding X");
    expect(propLabel("borderRadius")).toBe("Border radius");
  });
});
