import { describe, expect, it } from "@effect/vitest";

import { checkEmailCompatibility, hasBlockingCompatibility } from "../src/email/compatibility";

const finding = (html: string, code: string, client?: string) => {
  const result = checkEmailCompatibility({ html }).find(
    (item) =>
      item.code === `caniemail/${code}` && (client === undefined || item.clients?.includes(client)),
  );
  expect(result).toBeDefined();
  return result!;
};

describe("compatibility assessments", () => {
  it("distinguishes a client observation from a demonstrated source risk", () => {
    const unknown = finding('<p style="overflow-wrap:break-word">Text</p>', "overflow-wrap");
    expect(unknown.severity).toBe("info");
    expect(unknown.compatibility?.assessment).toBe("unverified");
    expect(unknown.message).toContain("does not establish its effect");

    const risk = finding('<p style="overflow:scroll;height:30px">Required content</p>', "overflow");
    expect(risk.severity).toBe("warning");
    expect(risk.compatibility?.title).toBe("Scrollable content may be inaccessible");
    expect(risk.provenance).toContain("caniemail@2.0.2");
  });

  it("keeps percentage image width actionable without calling fixed-size DPI behavior safe", () => {
    const fixed = finding('<img src="https://example.com/a.png" width="120">', "width-attribute");
    expect(fixed.compatibility?.assessment).toBe("unverified");
    expect(fixed.notes).toContain("120 dpi");
    const percent = finding('<img src="https://example.com/a.png" width="50%">', "width-attribute");
    expect(percent.compatibility?.assessment).toBe("risk");
    expect(percent.severity).toBe("warning");
  });

  it("uses emitted element scope when excluding attribute limitations", () => {
    expect(
      finding('<html dir="rtl"><body>Hello</body></html>', "dir-attribute").compatibility
        ?.assessment,
    ).toBe("not-applicable");
    expect(
      finding('<a dir="rtl" href="https://example.com">Hello</a>', "dir-attribute").compatibility
        ?.assessment,
    ).toBe("unverified");
    expect(
      finding('<table role="presentation"><tr><td>Hello</td></tr></table>', "role-attribute")
        .compatibility?.assessment,
    ).toBe("not-applicable");
    expect(
      finding('<div role="presentation">Hello</div>', "role-attribute").compatibility?.assessment,
    ).toBe("unverified");
  });

  it("does not extend safe-value rules to unsupported values", () => {
    expect(
      finding('<p style="text-align:center">Hello</p>', "text-align").compatibility?.assessment,
    ).toBe("not-applicable");
    expect(
      finding('<p style="text-align:start">Hello</p>', "text-align").compatibility?.assessment,
    ).toBe("unverified");
    expect(
      finding('<p style="background:#fff">Hello</p>', "background").compatibility?.assessment,
    ).toBe("not-applicable");
    expect(
      finding('<p style="background:url(https://example.com/a.png)">Hello</p>', "background")
        .compatibility?.assessment,
    ).toBe("unverified");
  });

  it.each([
    '<img style="display:none" src="https://example.com/a.png">',
    '<div style="display:none"><table><tr><td>hidden</td></tr></table></div>',
    '<img style="display:none!important;display:block" src="https://example.com/a.png">',
  ])("blocks demonstrated partial hidden-content failures: %s", (html) => {
    const origin = { fileName: "template.tsx", lineNumber: 4, columnNumber: 3 };
    const result = checkEmailCompatibility({
      html,
      fixture: "hidden-content",
      positions: [
        {
          start: 0,
          end: html.length,
          origins: [origin],
          instancePath: "0",
          tag: html.startsWith("<img") ? "img" : "div",
          authored: true,
        },
      ],
    });
    const blocked = result.filter((item) => item.severity === "error");
    expect(hasBlockingCompatibility(result)).toBe(true);
    expect(blocked.length).toBeGreaterThan(0);
    for (const item of blocked) {
      expect(item.compatibility?.assessment).toBe("risk");
      expect(item.clients).toEqual(["Outlook classic Windows"]);
      expect(item.origins).toEqual([origin]);
      expect(item.fixtures).toEqual(["hidden-content"]);
      expect(item.provenance).toContain("caniemail@2.0.2");
      expect(item.notes).toBeDefined();
    }
  });

  it.each([
    '<img style="display:none;display:block" src="https://example.com/a.png">',
    '<img style="display:block!important;display:none" src="https://example.com/a.png">',
    '<div style="display:none">Preheader</div>',
    '<div style="display:none"><table style="display:none"><tr><td>hidden</td></tr></table></div>',
    '<div style="display:none;mso-hide:all"><table><tr><td>hidden</td></tr></table></div>',
    '<img style="display:none;mso-hide:all" src="https://example.com/a.png">',
    '<img style="display:none;max-height:0;overflow:hidden" src="https://example.com/a.png">',
    '<div style="display:var(--visibility)"><img style="display:none" src="https://example.com/a.png"></div>',
    '<!--[if !mso]><!--><img style="display:none" src="https://example.com/a.png"><!--<![endif]-->',
    '<style>img { display:block!important }</style><img style="display:none" src="https://example.com/a.png">',
  ])("does not block safe or unresolved hidden-content context: %s", (html) => {
    const result = checkEmailCompatibility({ html });
    expect(hasBlockingCompatibility(result)).toBe(false);
    expect(
      result
        .filter((item) => item.code.startsWith("caniemail/display"))
        .every((item) => item.compatibility?.assessment === "unverified"),
    ).toBe(true);
  });

  it.each([
    "opacity:1",
    "opacity:1.0",
    "visibility:visible",
    "height:120px",
    "height:auto",
    "overflow:visible",
    "overflow-y:visible",
    "overflow-x:visible",
    "mso-hide:none",
    "clip:auto",
    "clip-path:none",
    "max-height:none",
    "max-height:120px",
    "opacity:0!important;opacity:1!important",
  ])("does not treat neutral styles as hiding fallbacks: %s", (style) => {
    for (const html of [
      `<img style="display:none;${style}" src="https://example.com/a.png">`,
      `<div style="${style}"><img style="display:none" src="https://example.com/a.png"></div>`,
      `<div style="display:none;${style}"><table><tr><td>hidden</td></tr></table></div>`,
      `<div style="display:none"><table style="${style}"><tr><td>hidden</td></tr></table></div>`,
    ]) {
      const result = checkEmailCompatibility({ html });
      expect(hasBlockingCompatibility(result)).toBe(true);
      expect(
        result.some(
          (item) =>
            item.code.startsWith("caniemail/display") &&
            item.severity === "error" &&
            item.compatibility?.assessment === "risk",
        ),
      ).toBe(true);
    }
  });

  it.each([
    "opacity:0",
    "visibility:hidden",
    "height:0",
    "max-height:0",
    "overflow:hidden",
    "overflow-x:hidden",
    "overflow-x:var(--overflow)",
    "mso-hide:all",
    "clip:rect(0,0,0,0)",
    "clip-path:inset(100%)",
    "opacity:var(--opacity)",
    "height:var(--height)",
    "height:100%",
    "height:1em;font-size:0",
    "opacity:0!important;opacity:1",
  ])("keeps possible or unresolved hiding fallbacks unverified: %s", (style) => {
    for (const html of [
      `<img style="display:none;${style}" src="https://example.com/a.png">`,
      `<div style="${style}"><img style="display:none" src="https://example.com/a.png"></div>`,
      `<div style="display:none;${style}"><table><tr><td>hidden</td></tr></table></div>`,
      `<div style="display:none"><table style="${style}"><tr><td>hidden</td></tr></table></div>`,
    ]) {
      const result = checkEmailCompatibility({ html });
      expect(hasBlockingCompatibility(result)).toBe(false);
      const display = result.filter((item) => item.code.startsWith("caniemail/display"));
      expect(display.length).toBeGreaterThan(0);
      expect(display.every((item) => item.compatibility?.assessment === "unverified")).toBe(true);
    }
  });

  it("leaves hidden content with external CSS unverified", () => {
    const result = checkEmailCompatibility({
      html: '<img style="display:none" src="https://example.com/a.png">',
      css: "img { mso-hide:all }",
    });
    expect(hasBlockingCompatibility(result)).toBe(false);
  });

  it.each([
    {
      html: '<p style="background:#fff;background-image:url(https://example.com/a.png)">Hello</p>',
    },
    {
      html: '<p style="background-color:#fff;background-image:url(https://example.com/a.png)">Hello</p>',
    },
    {
      html: '<p style="background:#fff">Hello</p>',
      css: "p { background-image:url(https://example.com/a.png) }",
    },
  ])("does not call mixed backgrounds colors-only: %s", (input) => {
    const backgrounds = checkEmailCompatibility(input).filter(
      (item) => item.code === "caniemail/background",
    );
    expect(backgrounds.length).toBeGreaterThan(0);
    expect(backgrounds.every((item) => item.compatibility?.assessment === "unverified")).toBe(true);
  });

  it("allows an explicitly absent background image in the colors-only assessment", () => {
    expect(
      finding('<p style="background:#fff;background-image:none">Hello</p>', "background")
        .compatibility?.assessment,
    ).toBe("not-applicable");
  });

  it("keeps known broken navigation blocking", () => {
    const result = checkEmailCompatibility({
      html: '<a href="#section">Jump</a><p id="section">Hello</p>',
    });
    const blocked = result.filter((item) => item.severity === "error");
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((item) => item.compatibility?.assessment === "risk")).toBe(true);
    expect(hasBlockingCompatibility(result)).toBe(true);
  });
});
