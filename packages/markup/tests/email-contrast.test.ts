import { describe, expect, it } from "@effect/vitest";

import { checkEmailCompatibility } from "../src/email/compatibility";
import { checkEmailContrast } from "../src/email/contrast";

const DARK = (rules: string): string =>
  `<style>@media (prefers-color-scheme: dark){${rules}}</style>`;

const page = (head: string, body: string): string =>
  `<!doctype html><html><head>${head}</head><body style="margin:0">${body}</body></html>`;

const codes = (html: string) => checkEmailContrast({ html });

describe("email contrast", () => {
  it("reports a button that disappears into its card in dark mode only", () => {
    const html = page(
      DARK(".card{background-color:#1d1a14!important}"),
      `<table><tr><td class="card" style="background-color:#ffffff;color:#17140f"><a class="btn" href="https://example.com" style="background-color:#17140f;color:#ffffff">Open review</a></td></tr></table>`,
    );
    const findings = codes(html);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.code).toBe("email-contrast");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("Dark mode");
    expect(finding?.message).toContain("#17140f");
    expect(finding?.message).toContain("#1d1a14");
    expect(finding?.message).toContain("1.06:1");
    expect(finding?.message).toContain("button");
  });

  it("reports text that keeps its light color on a dark background", () => {
    const html = page(
      DARK(".card{background-color:#1d1a14!important}"),
      `<div class="card" style="background-color:#ffffff"><p style="color:#17140f">Hello there</p></div>`,
    );
    const findings = codes(html);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("Dark mode: text #17140f on #1d1a14");
  });

  it("accepts a document that passes in both modes", () => {
    const html = page(
      DARK(".card{background-color:#1d1a14!important}.copy{color:#f4f1ea!important}"),
      `<div class="card" style="background-color:#ffffff"><p class="copy" style="color:#17140f">Hello there</p><a href="https://example.com" style="background-color:#2563eb;color:#ffffff">Go</a></div>`,
    );
    expect(codes(html)).toEqual([]);
  });

  it("warns on normal text between 3:1 and 4.5:1 and accepts the same color as large text", () => {
    const small = page("", `<p style="color:#8a8a8a;background-color:#ffffff">Quiet text</p>`);
    const [warning] = codes(small);
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("Light mode");
    expect(warning?.message).toContain("4.5:1");
    const large = page(
      "",
      `<p style="color:#8a8a8a;background-color:#ffffff;font-size:24px">Quiet text</p>`,
    );
    expect(codes(large)).toEqual([]);
    const bold = page(
      "",
      `<p style="color:#8a8a8a;background-color:#ffffff;font-size:19px;font-weight:700">Quiet text</p>`,
    );
    expect(codes(bold)).toEqual([]);
  });

  it("skips what is hidden in the mode being checked", () => {
    const html = page(
      DARK(".logo-light{display:none!important}.logo-dark{display:block!important}"),
      `<div data-samva-preheader="x" style="display:none;color:#ffffff;background-color:#ffffff">Preview text</div>
       <div class="logo-dark" style="display:none;color:#f4f1ea;background-color:#1d1a14">Dark logo</div>
       <div class="logo-light" style="color:#17140f;background-color:#ffffff">Light logo</div>`,
    );
    expect(codes(html)).toEqual([]);
  });

  it("shows the logo's dark element in dark mode", () => {
    const html = page(
      DARK(".logo-dark{display:block!important}"),
      `<div class="logo-dark" style="display:none;color:#17140f;background-color:#1d1a14">Dark logo</div>`,
    );
    const findings = codes(html);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("Dark mode");
  });

  it("skips colors it cannot evaluate", () => {
    const html = page(
      "",
      `<p style="color:var(--x);background-color:#ffffff">A</p>
       <p style="color:currentColor;background-color:#ffffff">B</p>
       <div style="background-color:var(--y)"><p style="color:#ffffff">C</p></div>
       <div style="background-image:linear-gradient(#000,#fff)"><p style="color:#ffffff">D</p></div>`,
    );
    expect(codes(html)).toEqual([]);
  });

  it("keeps a button shape that a visible border carries", () => {
    const html = page(
      DARK(".card{background-color:#1d1a14!important}"),
      `<div class="card" style="background-color:#ffffff"><a href="https://example.com" style="background-color:#17140f;color:#ffffff;border:1px solid #ffffff">Open</a></div>`,
    );
    expect(codes(html)).toEqual([]);
  });

  it("groups repeated identical findings", () => {
    const html = page(
      "",
      `<p style="color:#8a8a8a;background-color:#ffffff">A</p><p style="color:#8a8a8a;background-color:#ffffff">B</p>`,
    );
    const findings = codes(html);
    expect(findings.map((finding) => finding.message.split(":")[0])).toEqual([
      "Light mode",
      "Dark mode",
    ]);
  });

  it("appears through the compatibility check", () => {
    const html = page(
      DARK(".card{background-color:#1d1a14!important}"),
      `<div class="card" style="background-color:#ffffff"><p style="color:#17140f">Hello</p></div>`,
    );
    const found = checkEmailCompatibility({ html }).filter(
      (finding) => finding.code === "email-contrast",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
  });
});
