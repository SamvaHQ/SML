/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import { applyStylesheet, DARK_CLASS_PREFIX, renderDarkRules } from "../src/email/cascade";
import { parseStylesheet } from "../src/email/css";
import type { EmailNode } from "../src/email/jsx-runtime";
import { compileEmail } from "../src/email/render";

// A theme redefines `--color-card` and `--color-primary` in dark mode; `--color-border` does not change.
const THEME = `
:root{--color-card:#ffffff;--color-primary:#111111;--color-border:#dddddd}
@media (prefers-color-scheme:dark){:root{--color-card:#222222;--color-primary:#eeeeee}}
`;

const styled = (css: string, tree: EmailNode) => {
  const applied = applyStylesheet(tree, parseStylesheet(css, { origin: "theme.css" }));
  return { ...applied, html: compileEmail(applied.tree).html };
};

const darkClass = (html: string): string => {
  const found = new RegExp(`${DARK_CLASS_PREFIX}[a-z0-9]+`).exec(html)?.[0];
  expect(found).toBeDefined();
  return found ?? "";
};

describe("dark classes", () => {
  it("gives a class rule that reads a themed color a generated class and rule", () => {
    const applied = styled(
      `${THEME}.card{background-color:var(--color-card);border:1px solid var(--color-border)}`,
      <div className="card">hi</div>,
    );
    expect(applied.html).toContain("background-color:#ffffff");
    const name = darkClass(applied.html);
    expect(applied.darkRules.get(name)).toContain("background-color:#222222!important");
    // The color the dark theme leaves alone does not change.
    expect(applied.darkRules.get(name)).not.toContain("#dddddd");
  });

  it("keeps an important themed color ahead of a weaker hover rule", () => {
    const applied = styled(
      `${THEME}.card:hover{color:red}`,
      <p className="card" style={{ color: "var(--color-primary) !important" }}>
        hi
      </p>,
    );
    const lock = /sml-lock-[a-z0-9]+/.exec(applied.html)?.[0];
    expect(applied.html).toContain("color:#111111");
    expect(applied.html).not.toContain("color:#111111!important");
    expect(lock).toBeDefined();
    expect(applied.darkRules.get(darkClass(applied.html))).toBe("color:#eeeeee!important");
    expect(applied.headCss).toContain(".card:hover{color:red!important}");
    expect(applied.headCss).toContain(`.card.${lock}:hover{color:#111111!important}`);
    expect(applied.headCss).toContain(
      `@media (prefers-color-scheme:dark){.card.${lock}:hover{color:#eeeeee!important}}`,
    );
  });

  it("lets an important hover win when a weaker hover also guards the color", () => {
    const applied = styled(
      `${THEME}.card{color:var(--color-primary)!important}.card:hover{color:red}.card:hover{color:green!important}`,
      <p className="card">hi</p>,
    );
    const lock = /sml-lock-[a-z0-9]+/.exec(applied.html)?.[0];
    expect(lock).toBeDefined();
    const themeGuard = applied.headCss.indexOf(`.card.${lock}:hover{color:#111111!important}`);
    const greenReplay = applied.headCss.lastIndexOf(`.card.${lock}:hover{color:green!important}`);
    expect(themeGuard).toBeGreaterThanOrEqual(0);
    expect(greenReplay).toBeGreaterThan(themeGuard);
  });

  it("keeps an escaped hover class intact on the lock selector", () => {
    const applied = styled(
      `${THEME}.hover\\:text-red-500:hover{color:red}`,
      <p className="hover:text-red-500" style={{ color: "var(--color-primary) !important" }}>
        hi
      </p>,
    );
    const lock = /sml-lock-[a-z0-9]+/.exec(applied.html)?.[0];
    expect(lock).toBeDefined();
    expect(applied.headCss).toContain(
      `.hover\\:text-red-500.${lock}:hover{color:#111111!important}`,
    );
  });

  it("keeps a stronger inline longhand when an important hover replays a shorthand", () => {
    const applied = styled(
      `${THEME}.card{background:var(--color-card)!important}.card:hover{background:blue}.card:hover{background:green!important}`,
      <div className="card" style={{ backgroundColor: "red !important" }}>
        hi
      </div>,
    );
    const lock = /sml-lock-[a-z0-9]+/.exec(applied.html)?.[0];
    expect(lock).toBeDefined();
    expect(applied.html).toContain("background:#ffffff");
    expect(applied.html).toContain("background-color:red");
    expect(applied.html).not.toContain("background-color:red!important");
    const guarded = applied.headCss.indexOf(
      `.card.${lock}:hover{background:#ffffff!important;background-color:red!important}`,
    );
    const replay = applied.headCss.indexOf(
      `.card.${lock}:hover{background:green!important;background-color:red!important}`,
    );
    expect(guarded).toBeGreaterThanOrEqual(0);
    expect(replay).toBeGreaterThan(guarded);
  });

  it("keeps a themed inline longhand's dark value when a hover replays a shorthand", () => {
    const applied = styled(
      `${THEME}.card{border:1px solid var(--color-border)!important}.card:hover{border:1px solid blue}.card:hover{border:2px solid green!important}`,
      <div className="card" style={{ borderTopColor: "var(--color-primary) !important" }}>
        hi
      </div>,
    );
    const lock = /sml-lock-[a-z0-9]+/.exec(applied.html)?.[0];
    expect(lock).toBeDefined();
    expect(applied.headCss).toContain(
      `.card.${lock}:hover{border:2px solid green!important;border-top-color:#111111!important}`,
    );
    expect(applied.headCss).toContain(
      `@media (prefers-color-scheme:dark){.card.${lock}:hover{border:2px solid green!important;border-top-color:#eeeeee!important}}`,
    );
  });

  it("resolves a replayed shorthand at its dark value", () => {
    const applied = styled(
      `${THEME}.card{background:var(--color-card)!important}.card:hover{background:blue}.card:hover{background:var(--color-primary)!important}`,
      <div className="card" style={{ backgroundColor: "red !important" }}>
        hi
      </div>,
    );
    const lock = /sml-lock-[a-z0-9]+/.exec(applied.html)?.[0];
    expect(lock).toBeDefined();
    expect(applied.headCss).toContain(
      `.card.${lock}:hover{background:#111111!important;background-color:red!important}`,
    );
    expect(applied.headCss).toContain(
      `@media (prefers-color-scheme:dark){.card.${lock}:hover{background:#eeeeee!important;background-color:red!important}}`,
    );
  });

  it("does not copy an important element color onto a pseudo-element", () => {
    const applied = styled(
      `${THEME}.card::before{content:"*";color:red}`,
      <p className="card" style={{ color: "var(--color-primary) !important" }}>
        hi
      </p>,
    );
    expect(applied.html).not.toContain("sml-lock-");
    expect(applied.headCss).toContain('.card::before{content:"*"!important;color:red!important}');
    expect(applied.headCss).not.toContain("sml-lock-");
  });

  it("lets an important hover beat a less specific important themed color", () => {
    const applied = styled(
      `${THEME}.card{color:var(--color-primary)!important}.card:hover{color:red!important}`,
      <p className="card">hi</p>,
    );
    expect(applied.html).not.toContain("sml-lock-");
    expect(applied.headCss).toContain(".card:hover{color:red!important}");
    expect(applied.headCss).not.toContain("sml-lock-");
  });

  it("lets a dark theme override an important themed color", () => {
    const applied = styled(
      `${THEME}.card{color:var(--color-primary)!important;padding:2px!important}`,
      <p className="card">hi</p>,
    );
    expect(applied.html).toContain('style="color:#111111;padding:2px!important"');
    expect(applied.darkRules.get(darkClass(applied.html))).toBe("color:#eeeeee!important");
  });

  it("keeps an important themed shorthand ahead of an overlapping longhand", () => {
    const applied = styled(
      `${THEME}.box{background-color:#ff0000!important;background:var(--color-card)!important}`,
      <div className="box">hi</div>,
    );
    expect(applied.html).toContain('style="background-color:#ff0000;background:#ffffff"');
    expect(applied.darkRules.get(darkClass(applied.html))).toBe(
      "background-color:#ff0000!important;background:#222222!important",
    );
  });

  it("covers an inline var() style too", () => {
    const applied = styled(THEME, <p style={{ color: "var(--color-primary)" }}>hi</p>);
    expect(applied.html).toContain("color:#111111");
    expect(applied.darkRules.get(darkClass(applied.html))).toBe("color:#eeeeee!important");
  });

  it("covers a themed bgcolor attribute", () => {
    const applied = styled(THEME, <table bgcolor="var(--color-card)" />);
    expect(applied.html).toContain('bgcolor="#ffffff"');
    expect(applied.darkRules.get(darkClass(applied.html))).toContain(
      "background-color:#222222!important",
    );
  });

  it("shares one class between elements with equal dark declarations", () => {
    const applied = styled(
      THEME,
      <div>
        <p style={{ color: "var(--color-primary)" }}>one</p>
        <p style={{ color: "var(--color-primary)" }}>two</p>
      </div>,
    );
    expect(applied.darkRules.size).toBe(1);
    expect(applied.html.match(new RegExp(DARK_CLASS_PREFIX, "g"))).toHaveLength(2);
  });

  it("keeps an element's own custom property in both modes", () => {
    const applied = styled(
      THEME,
      <p style={{ "--color-primary": "#ff0000", color: "var(--color-primary)" }}>hi</p>,
    );
    expect(applied.html).toContain("color:#ff0000");
    expect(applied.darkRules.size).toBe(0);
    expect(applied.html).not.toContain(DARK_CLASS_PREFIX);
  });

  it("adds no class for a color the dark theme leaves alone", () => {
    const applied = styled(THEME, <p style={{ color: "var(--color-border)" }}>hi</p>);
    expect(applied.darkRules.size).toBe(0);
    expect(applied.html).not.toContain(DARK_CLASS_PREFIX);
  });

  it("adds none when the sheet has no dark variables", () => {
    const applied = styled(
      ":root{--color-card:#ffffff}.card{background-color:var(--color-card)}",
      <div className="card">hi</div>,
    );
    expect(applied.html).toContain("background-color:#ffffff");
    expect(applied.darkRules.size).toBe(0);
    expect(applied.html).not.toContain(DARK_CLASS_PREFIX);
  });

  it("resolves a retained explicit dark rule at the dark values", () => {
    const applied = styled(
      `${THEME}@media (prefers-color-scheme:dark){.dark\\:card{background-color:var(--color-card)}}`,
      <div className="dark:card">hi</div>,
    );
    expect(applied.headCss).toContain("background-color:#222222");
    expect(applied.headCss).not.toContain("var(--color-card)");
  });

  it("prints the generated classes as one dark-mode block", () => {
    const rules = new Map([
      ["sml-dark-b", "color:#eeeeee!important"],
      ["sml-dark-a", "background-color:#222222!important"],
    ]);
    expect(renderDarkRules(rules)).toBe(
      "@media (prefers-color-scheme:dark){.sml-dark-a{background-color:#222222!important}.sml-dark-b{color:#eeeeee!important}}",
    );
    expect(renderDarkRules(new Map())).toBe("");
  });

  it("keeps an explicit longhand ahead of a themed shorthand it overrides", () => {
    const applied = styled(
      `${THEME}.card{background:var(--color-card)}`,
      <div className="card" style={{ backgroundColor: "#ff0000" }}>
        hi
      </div>,
    );
    const rule = applied.darkRules.get(darkClass(applied.html)) ?? "";
    expect(rule).toBe("background:#222222!important;background-color:#ff0000!important");
  });

  it("resolves a dark rule nested in another query at dark values", () => {
    const applied = styled(
      `${THEME}@media (prefers-color-scheme:dark){@media (min-width:640px){.wide{background-color:var(--color-card)}}}`,
      <div className="wide">hi</div>,
    );
    expect(applied.headCss).toContain(".wide{background-color:#222222!important}");
  });

  it("restates only declarations a changed color can override", () => {
    const applied = styled(
      `${THEME}.box{border-color:var(--color-primary);border-radius:8px;border-top-color:var(--color-primary)}`,
      <div className="box">hi</div>,
    );
    const rule = applied.darkRules.get(darkClass(applied.html)) ?? "";
    expect(rule).toContain("border-color:#eeeeee!important");
    expect(rule).toContain("border-top-color:#eeeeee!important");
    expect(rule).not.toContain("border-radius");
  });

  it("restates a border shorthand that shares a side with a themed border color", () => {
    const applied = styled(
      `${THEME}.box{border-color:var(--color-primary)}`,
      <div className="box" style={{ borderTop: "2px solid #ff0000" }}>
        hi
      </div>,
    );
    const rule = applied.darkRules.get(darkClass(applied.html)) ?? "";
    expect(rule).toBe("border-color:#eeeeee!important;border-top:2px solid #ff0000!important");
  });

  it("keeps the declarations that override a restated shorthand", () => {
    const applied = styled(
      `${THEME}.box{border-color:var(--color-primary);border-top:2px solid #ff0000}`,
      <div className="box" style={{ borderWidth: "8px" }}>
        hi
      </div>,
    );
    const rule = applied.darkRules.get(darkClass(applied.html)) ?? "";
    expect(rule).toBe(
      "border-color:#eeeeee!important;border-top:2px solid #ff0000!important;border-width:8px!important",
    );
  });

  it("keeps a border image a themed border would reset", () => {
    const applied = styled(
      `${THEME}.box{border:1px solid var(--color-primary)}`,
      <div className="box" style={{ borderImage: "linear-gradient(red, blue) 1" }}>
        hi
      </div>,
    );
    const rule = applied.darkRules.get(darkClass(applied.html)) ?? "";
    expect(rule).toContain("border:1px solid #eeeeee!important;border-image:");
  });
});
