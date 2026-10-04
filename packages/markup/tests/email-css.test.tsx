/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { applyStylesheet } from "../src/email/cascade";
import { parseStylesheet } from "../src/email/css";
import { downlevelColors, formatColor, parseColor } from "../src/email/css-color";
import { downlevelMediaQuery, resolveVariables } from "../src/email/css-values";
import type { EmailNode } from "../src/email/jsx-runtime";
import { compileEmail } from "../src/email/render";
import { compileTailwind } from "../src/email/tailwind";

const styled = (css: string, tree: EmailNode) => {
  const applied = applyStylesheet(tree, parseStylesheet(css, { origin: "styles.css" }));
  return { ...applied, html: compileEmail(applied.tree).html };
};

describe("modern colors", () => {
  it("lowers the oklch palette Tailwind emits to sRGB hex", () => {
    // tailwindcss v4 --color-red-500
    expect(downlevelColors("oklch(63.7% 0.237 25.331)")).toBe("#fb2c36");
    // --color-blue-600
    expect(downlevelColors("oklch(54.6% 0.245 262.881)")).toBe("#155dfc");
    expect(downlevelColors("color: oklch(0 0 0); border: 1px solid oklch(1 0 0)")).toBe(
      "color: #000000; border: 1px solid #ffffff",
    );
  });

  it("mixes with transparent as an alpha change, which is what an opacity modifier means", () => {
    expect(downlevelColors("color-mix(in oklab, #ff0000 50%, transparent)")).toBe(
      "rgba(255,0,0,0.5)",
    );
    expect(downlevelColors("color-mix(in srgb, #000000 50%, #ffffff)")).toBe("#808080");
  });

  it("leaves colors every client already understands alone", () => {
    for (const value of ["#fff", "rgb(1 2 3)", "red", "currentColor", "inherit"])
      expect(downlevelColors(value)).toBe(value);
    expect(formatColor(parseColor("#11223344")!)).toBe("rgba(17,34,51,0.267)");
  });
});

describe("stylesheet model", () => {
  it("collects custom properties and resolves them into declarations", () => {
    const sheet = parseStylesheet(":root{--brand:#123456;--pad:8px}.card{color:var(--brand)}");
    expect(sheet.variables["--brand"]).toBe("#123456");
    expect(resolveVariables("calc(var(--pad) * 2)", sheet.variables)).toBe("calc(8px * 2)");
    expect(resolveVariables("var(--missing, 4px)", sheet.variables)).toBe("4px");
  });

  it("refuses exponential custom-property expansion", () => {
    const references = (index: number): string =>
      Array.from({ length: 6 }, () => `var(--a${index + 1})`).join("");
    const variables = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `--a${index}`,
        index === 7 ? "x" : references(index),
      ]),
    );

    expect(resolveVariables("var(--a0)", variables)).toBe("var(--a0)");
  });

  it("bounds resolution work when repeated variables collapse to empty output", () => {
    const value = Array.from({ length: 4_000 }, () => "var(--empty)").join("");
    const authored = Array.from({ length: 16 }, () => "var(--large)").join("");

    expect(resolveVariables(authored, { "--large": value, "--empty": "" })).toBe(authored);
  });

  it("scopes compiled selector memoization to one stylesheet", () => {
    const first = parseStylesheet(".card{color:red}.card{background:white}");
    const second = parseStylesheet(".card{color:blue}");

    expect(first.rules[0]?.matcher).toBe(first.rules[1]?.matcher);
    expect(first.rules[0]?.matcher).not.toBe(second.rules[0]?.matcher);
  });

  it("un-nests the at-rules Tailwind writes inside a utility rule", () => {
    const sheet = parseStylesheet(".sm\\:p-8{@media (width >= 40rem){padding:2rem}}");
    const rule = sheet.rules.find((entry) => entry.conditions.length > 0);
    expect(rule?.conditions).toEqual(["@media (width>=40rem)"]);
    expect(rule?.inlinable).toBe(false);
    expect(rule?.declarations).toEqual([{ property: "padding", value: "2rem", important: false }]);
    expect(downlevelMediaQuery("@media (width>=40rem)")).toBe("@media (min-width:40rem)");
  });

  it("orders layers and reports an at-rule it cannot honor", () => {
    const sheet = parseStylesheet(
      "@layer theme, utilities; @layer theme{.a{color:red}} @layer utilities{.a{color:blue}} @font-face{font-family:X;src:url(https://x.test/f.woff2)} @page{margin:0}",
    );
    expect(sheet.rules.map((rule) => rule.layer)).toEqual([0, 1]);
    expect(sheet.headAtRules.join("")).toBe("@page{margin:0}");
    expect(sheet.fontFaces.map((face) => face.family)).toEqual(["X"]);
    expect(sheet.diagnostics.map((entry) => entry.code)).toEqual([]);
    expect(parseStylesheet("@viewport{width:1px}").diagnostics[0]?.code).toBe(
      "css-unsupported-at-rule",
    );
  });
});

describe("cascade", () => {
  it("inlines by specificity, then source order, then the author's own style object", () => {
    const applied = styled(
      "p{color:#111111}.a{color:#222222}#hero{color:#333333}",
      <p id="hero" className="a" style={{ fontSize: 12 }}>
        x
      </p>,
    );
    expect(applied.html).toContain("color:#333333");
    expect(applied.html).toContain("font-size:12px");
  });

  it("lets an author's inline style beat a normal rule and an important rule beat the inline style", () => {
    expect(styled(".a{color:red}", <p className="a" style={{ color: "blue" }} />).html).toContain(
      "color:blue",
    );
    expect(
      styled(".a{color:red!important}", <p className="a" style={{ color: "blue" }} />).html,
    ).toContain("color:red");
  });

  it("lets an author's important inline value beat an important stylesheet declaration", () => {
    // The cascade compares element-attached declarations before layers and
    // specificity, so importance alone never hands a stylesheet the element.
    expect(
      styled(".a{color:red!important}", <p className="a" style={{ color: "blue !important" }} />)
        .html,
    ).toContain("color:blue");
    expect(
      styled(
        "@layer base;@layer base{.a{color:red!important}}",
        <p className="a" style={{ color: "blue !important" }} />,
      ).html,
    ).toContain("color:blue");
  });

  it("orders layers below unlayered declarations and reverses them for important ones", () => {
    expect(
      styled("@layer base;@layer base{.a{color:red}} .a{color:blue}", <p className="a" />).html,
    ).toContain("color:blue");
    expect(
      styled(
        "@layer base;@layer base{.a{color:red!important}} .a{color:blue!important}",
        <p className="a" />,
      ).html,
    ).toContain("color:red");
  });

  it("resolves var() from the element's own cascaded custom properties, then its ancestors, then the root", () => {
    const applied = styled(
      ":root{--brand:#000000}.card{--brand:#123456}.card{color:var(--brand)}.title{color:var(--brand)}.plain{color:var(--brand)}.gap{padding:var(--pad, 4px)}",
      <div>
        <div className="card">
          <p className="title">scoped</p>
        </div>
        <p className="plain">root</p>
        <p className="gap">fallback</p>
      </div>,
    );
    expect(applied.html).toContain('<div class="card" style="color:#123456">');
    expect(applied.html).toContain('<p class="title" style="color:#123456">');
    expect(applied.html).toContain('<p class="plain" style="color:#000000">');
    expect(applied.html).toContain('<p class="gap" style="padding:4px">');
  });

  it("emits a shorthand and a longhand in the order the cascade ranks them", () => {
    // `margin` and `margin-top` are separate properties, so both survive the
    // cascade; the order they are written in is what decides which one the
    // client applies to the top edge.
    expect(
      styled("#hero{margin:0}.a{margin-top:4px}", <p id="hero" className="a" />).html,
    ).toContain('style="margin-top:4px;margin:0"');
    expect(
      styled("#hero{margin-top:4px}.a{margin:0}", <p id="hero" className="a" />).html,
    ).toContain('style="margin:0;margin-top:4px"');
    expect(styled(".a{margin-top:4px;margin:0}", <p className="a" />).html).toContain(
      'style="margin-top:4px;margin:0"',
    );
    expect(styled(".a{margin:0;margin-top:4px}", <p className="a" />).html).toContain(
      'style="margin:0;margin-top:4px"',
    );
  });

  it("lowers Gmail-stripped card axis padding onto physical edges", async () => {
    const generated = await compileTailwind(["px-8", "py-6"]);
    const result = styled(generated.css, <td className="px-8 py-6" />);
    expect(result.html).toContain(
      "padding-left:2rem;padding-right:2rem;padding-top:1.5rem;padding-bottom:1.5rem",
    );
    expect(result.html).not.toContain("padding-inline");
    expect(result.html).not.toContain("padding-block");
  });

  it("preserves physical shorthand precedence when logical edges reclaim a side", () => {
    expect(
      styled(
        ".card{padding-left:1px;padding:2px;padding-inline-start:3px}",
        <td className="card" />,
      ).html,
    ).toContain('style="padding:2px;padding-left:3px"');
    expect(
      styled(".card{padding-inline:3px 4px;padding:2px}", <td className="card" />).html,
    ).toContain('style="padding-left:3px;padding-right:4px;padding:2px"');
    expect(
      styled(
        ".card{padding-inline-start:3px!important;padding:2px}",
        <td className="card" style={{ paddingLeft: "5px" }} />,
      ).html,
    ).toContain('style="padding:2px;padding-left:3px"');
  });

  it("uses inherited RTL, child direction overrides, and resolved custom values", () => {
    const result = styled(
      ".card{--pad:3px;padding-inline:var(--pad) 4px;padding-block-start:5px;padding-inline-end:6px}",
      <div dir="rtl">
        <td className="card" />
        <td className="card" style={{ direction: "ltr" }} />
      </div>,
    );
    expect(result.html).toContain("padding-right:3px;padding-top:5px;padding-left:6px");
    expect(result.html).toContain(
      "padding-left:3px;padding-top:5px;padding-right:6px;direction:ltr",
    );
  });

  it("inherits stylesheet direction and honors explicit CSS inheritance over dir", () => {
    const result = styled(
      ".parent{direction:rtl}.card{padding-inline-start:3px;direction:inherit}",
      <div className="parent">
        <td dir="ltr" className="card" />
      </div>,
    );
    expect(result.html).toContain("padding-right:3px;direction:inherit");
    expect(
      styled(".card{padding-inline:calc(100% - 2px) 4px}", <td className="card" />).html,
    ).toContain("padding-left:calc(100% - 2px);padding-right:4px");
  });

  it("preserves logical padding when writing context is unresolved or vertical", () => {
    expect(
      styled(
        ".card{padding-inline:3px}",
        <div style={{ writingMode: "vertical-rl" }}>
          <td className="card" />
        </div>,
      ).html,
    ).toContain("padding-inline:3px");
    expect(styled(".card{padding-inline:3px}", <td dir="auto" className="card" />).html).toContain(
      "padding-inline:3px",
    );
    const conditional = styled(
      ".card{padding-inline:3px}@media(max-width:600px){.card{direction:rtl}}",
      <td className="card" />,
    );
    expect(conditional.html).toContain("padding-inline:3px");
    expect(styled(".card{padding-inline:inherit}", <td className="card" />).html).toContain(
      "padding-inline:inherit",
    );
  });

  it.each(["direction:rtl", "writing-mode:vertical-rl", "all:initial"])(
    "limits conditional %s to matching elements and their descendants",
    (declaration) => {
      const result = styled(
        `.card{padding-inline-start:3px}@media(max-width:600px){.affected{${declaration}}}`,
        <div className="card">
          <div className="affected card">
            <p className="card">Inherited context</p>
          </div>
          <p className="card">Unrelated sibling</p>
        </div>,
      );
      expect(result.html).toContain('<div class="card" style="padding-left:3px">');
      expect(result.html).toContain('<div class="affected card" style="padding-inline-start:3px">');
      expect(result.html).toContain('style="padding-inline-start:3px">Inherited context');
      expect(result.html).toContain('style="padding-left:3px">Unrelated sibling');
      expect(result.headCss).toContain(declaration);
    },
  );

  it("matches conditional ancestor selectors in their original tree position", () => {
    const result = styled(
      ".card{padding-inline-start:3px}@media(max-width:600px){.lead + .affected{direction:rtl}}",
      <div>
        <p className="lead" />
        <div className="affected">
          <p className="card">Affected</p>
        </div>
        <div className="affected">
          <p className="card">Unaffected</p>
        </div>
      </div>,
    );
    expect(result.html).toContain('style="padding-inline-start:3px">Affected');
    expect(result.html).toContain('style="padding-left:3px">Unaffected');
  });

  it("keeps logical padding when a retained writing selector cannot be resolved", () => {
    const result = styled(
      ".card{padding-inline-start:3px}.other:hover{direction:rtl}",
      <p className="card" />,
    );
    expect(result.html).toContain('style="padding-inline-start:3px"');
    expect(result.headCss).toContain(".other:hover{direction:rtl!important}");
  });

  it("matches descendant, child, sibling and attribute selectors", () => {
    const tree = (
      <div className="wrap">
        <span data-role="lead">one</span>
        <span>two</span>
        <p>three</p>
      </div>
    );
    const applied = styled(
      ".wrap > span{color:#aaaaaa}[data-role='lead']{font-weight:700}span + span{font-style:italic}div p{color:#cccccc}",
      tree,
    );
    // Declarations come out in cascade order, so the lower-ranked rule is written first.
    expect(applied.html).toContain('<span data-role="lead" style="font-weight:700;color:#aaaaaa">');
    // `.wrap > span` outranks `span + span`, so the sibling rule contributes only its own property.
    expect(applied.html).toContain('<span style="font-style:italic;color:#aaaaaa">two</span>');
    expect(applied.html).toContain('<p style="color:#cccccc">three</p>');
  });
});

describe("retained head rules", () => {
  it("keeps media, dark-scheme and pseudo rules for <head> and marks them important", () => {
    const applied = styled(
      "@media (width >= 40rem){.a{padding:2rem}}@media (prefers-color-scheme: dark){.a{background:#000000}}.a:hover{color:red}.a{color:blue}",
      <p className="a" />,
    );
    expect(applied.html).toContain("color:blue");
    expect(applied.headCss).toContain("@media (min-width:40rem){.a{padding:2rem!important}}");
    expect(applied.headCss).toContain(
      "@media (prefers-color-scheme:dark){.a{background:#000000!important}}",
    );
    expect(applied.headCss).toContain(".a:hover{color:red!important}");
  });

  it("nests conditional at-rules rather than joining their preludes", () => {
    // `@media (...) and @supports (...)` is not a query a client can parse, and
    // two media preludes cannot be folded with `and` without deriving one new
    // query from both. Nesting is the shape CSS already defines.
    expect(
      styled(
        "@supports (display:grid){@media (width >= 40rem){.a{padding:2rem}}}",
        <p className="a" />,
      ).headCss,
    ).toBe("@supports (display:grid){@media (min-width:40rem){.a{padding:2rem!important}}}");
    expect(
      styled(
        "@media (width >= 40rem){@supports (display:grid){.a{padding:2rem}}}",
        <p className="a" />,
      ).headCss,
    ).toBe("@media (min-width:40rem){@supports (display:grid){.a{padding:2rem!important}}}");
    expect(
      styled(
        "@media (width >= 40rem){@media (width <= 80rem){.a{padding:2rem}}}",
        <p className="a" />,
      ).headCss,
    ).toBe("@media (min-width:40rem){@media (max-width:80rem){.a{padding:2rem!important}}}");
  });

  it("keeps the class attribute so a retained rule can still find the element", () => {
    expect(styled("@media (min-width:1px){.a{color:red}}", <p className="a" />).html).toContain(
      'class="a"',
    );
  });

  it("warns when a class produced no styles at all", () => {
    const applied = styled(".known{color:red}", <p className="known composed-at-runtime" />);
    const finding = applied.diagnostics.find((entry) => entry.code === "unmatched-class");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("composed-at-runtime");
  });

  it("recognizes compiled escaped utilities and retained variants while warning for unknown classes", async () => {
    const generated = await compileTailwind(
      ["dark:bg-brand", "md:p-4", "hover:text-red-500", "w-1/2", "w-[123px]"],
      { css: "@theme { --color-brand: #123456; }" },
    );
    const applied = styled(
      generated.css,
      <p className="dark:bg-brand composed-at-runtime w-1/2 w-[123px] hover:text-red-500 md:p-4" />,
    );
    expect(applied.headCss).toContain("prefers-color-scheme:dark");
    expect(applied.headCss).toContain(".dark\\:bg-brand");
    expect(applied.headCss).toContain(".md\\:p-4");
    expect(applied.headCss).toContain(".hover\\:text-red-500:hover");
    expect(applied.html).toContain("width:123px");
    const findings = applied.diagnostics.filter((finding) => finding.code === "unmatched-class");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("composed-at-runtime");
  });

  it("recognizes escaped identifiers and classes inside retained pseudo selectors", () => {
    const applied = styled(
      String.raw`.\32 xl\:card { width: 50%; } :is(.active\:card) { color: red; }`,
      <p className="2xl:card active:card unknown" />,
    );
    expect(applied.html).toContain("width:50%");
    expect(applied.headCss).toContain(":is(.active\\:card)");
    const findings = applied.diagnostics.filter((finding) => finding.code === "unmatched-class");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("unknown");
  });

  it("warns when a custom property is only overridden inside a conditional block", () => {
    const sheet = parseStylesheet(
      ":root{--brand:#ffffff}@media (prefers-color-scheme: dark){:root{--brand:#000000}}",
    );
    expect(sheet.diagnostics.map((entry) => entry.code)).toEqual(["css-conditional-variable"]);
  });
});
