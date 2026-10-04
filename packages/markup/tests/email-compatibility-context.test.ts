import { describe, expect, it } from "@effect/vitest";

import { checkEmailCompatibility } from "../src/email/compatibility";

const findings = (style: string, title: string) =>
  checkEmailCompatibility({
    html: `<html><body><p style="${style}">Hello</p></body></html>`,
  }).filter((finding) => finding.code === `caniemail/${title}`);

describe("compatibility applicability", () => {
  it("distinguishes pixel sizes from unsupported rem sizes, including mixed declarations", () => {
    expect(findings("font-size:14px", "font-size").every((item) => item.severity === "info")).toBe(
      true,
    );
    expect(
      findings("font-size:1rem", "font-size").some((item) => item.severity === "warning"),
    ).toBe(true);
    const mixed = checkEmailCompatibility({
      html: '<p style="font-size:14px">One</p><p style="font-size:1rem">Two</p>',
    });
    expect(mixed.find((item) => item.code === "caniemail/font-size")?.severity).toBe("warning");
  });

  it("checks head CSS and separately supplied CSS as well as inline styles", () => {
    for (const input of [
      {
        html: '<style>@media(max-width:600px){p{font-size:1rem}}</style><p style="font-size:14px">Hello</p>',
      },
      { html: '<p style="font-size:14px">Hello</p>', css: "p{font-size:1rem}" },
    ])
      expect(
        checkEmailCompatibility(input).find((item) => item.code === "caniemail/font-size")
          ?.severity,
      ).toBe("warning");
  });

  it("checks features present only in separately supplied retained CSS", () => {
    const result = checkEmailCompatibility({ html: "<p>Hello</p>", css: "p{font-size:1rem}" });
    expect(result.find((item) => item.code === "caniemail/font-size")?.severity).toBe("warning");
  });

  it("does not confuse a circular radius with Yahoo's elliptical limitation or Outlook's missing support", () => {
    const circular = findings("border-radius:50%", "border-radius");
    expect(circular.find((item) => item.clients?.includes("Yahoo web"))?.severity).toBe("info");
    expect(
      circular.find((item) => item.clients?.includes("Outlook classic Windows"))?.compatibility
        ?.assessment,
    ).toBe("degradation");
    expect(
      findings("border-radius:50% / 25%", "border-radius").find((item) =>
        item.clients?.includes("Yahoo web"),
      )?.compatibility?.assessment,
    ).toBe("degradation");
  });

  it("keeps unresolved and computed behavior explicitly unverified", () => {
    expect(
      findings("font-size:var(--size)", "font-size").some(
        (item) => item.compatibility?.assessment === "unverified",
      ),
    ).toBe(true);
    expect(
      findings("overflow-wrap:break-word", "overflow-wrap").some(
        (item) => item.compatibility?.assessment === "unverified",
      ),
    ).toBe(true);
  });

  it("recognizes an intentional new-window target, but keeps a different target actionable", () => {
    for (const [target, severity] of [
      ["_blank", "info"],
      ["_self", "warning"],
    ]) {
      const result = checkEmailCompatibility({
        html: `<a href="https://example.com" target="${target}">Open</a>`,
      });
      const targets = result.filter((item) => item.code === "caniemail/target-attribute");
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.every((item) => item.severity === severity)).toBe(true);
    }
  });

  it("reports a supplied font fallback as informational, without assuming unsupported fonts have one", () => {
    const code = "system-ui-ui-serif-ui-sans-serif-ui-rounded-ui-monospace";
    expect(
      findings("font-family:system-ui,Arial,sans-serif", code).every(
        (item) => item.severity === "info",
      ),
    ).toBe(true);
    expect(
      findings("font-family:system-ui", code).some((item) => item.severity === "warning"),
    ).toBe(true);
  });

  it("retains fixture identity and every located occurrence without matching prose", () => {
    const html =
      '<p>font-size: example</p><p style="font-size:1rem">First</p><p style="font-size:2rem">Second</p>';
    const first = html.indexOf("<p style=");
    const second = html.lastIndexOf("<p style=");
    const origin = (lineNumber: number) => ({
      fileName: "emails/example.tsx",
      lineNumber,
      columnNumber: 3,
    });
    const result = checkEmailCompatibility({
      html,
      fixture: "long-content",
      positions: [
        {
          start: first,
          end: second,
          origins: [origin(10)],
          instancePath: "0",
          tag: "p",
          authored: true,
        },
        {
          start: second,
          end: html.length,
          origins: [origin(20)],
          instancePath: "1",
          tag: "p",
          authored: true,
        },
      ],
    });
    const size = result.find((item) => item.code === "caniemail/font-size");
    expect(size?.fixtures).toEqual(["long-content"]);
    expect(size?.occurrences).toEqual([[origin(10)], [origin(20)]]);
    expect(size?.message).not.toContain("The message still reads without it");
    expect(size?.notes).toContain("rem");
    expect(size?.provenance).toContain("caniemail@2.0.2");
  });
});
