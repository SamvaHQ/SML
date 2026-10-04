/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import {
  checkEmailCompatibility,
  COMPATIBILITY_PROVENANCE,
  EMAIL_CLIENT_MATRIX,
  unknownCoverage,
} from "../src/email/compatibility";
import { serializeEmailHtml } from "../src/email/html";
import { jsxDEV } from "../src/email/jsx-dev-runtime";
import { receipt, receiptFixtures } from "./fixtures/email-corpus";
import { renderEmail } from "./support/email-fixture";

const check = (tree: Parameters<typeof serializeEmailHtml>[0]) => {
  const emitted = serializeEmailHtml(tree);
  return {
    emitted,
    findings: checkEmailCompatibility({ html: emitted.html, positions: emitted.positions }),
  };
};

describe("pinned matrix and provenance", () => {
  it("names exactly the clients Samva makes claims about", () => {
    expect(EMAIL_CLIENT_MATRIX.map((target) => target.id)).toEqual([
      "gmail.desktop-webmail",
      "gmail.ios",
      "gmail.android",
      "apple-mail.macos",
      "apple-mail.ios",
      "yahoo.desktop-webmail",
      "outlook.outlook-com",
      "outlook.windows",
    ]);
  });

  it("pins the rules revision a finding was true against", () => {
    expect(COMPATIBILITY_PROVENANCE.rules).toBe("caniemail@2.0.2");
    expect(COMPATIBILITY_PROVENANCE.apiVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(COMPATIBILITY_PROVENANCE.lastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("puts the revision on every finding, because a claim without a date is not one", () => {
    const { findings } = check(
      <div style={{ borderRadius: "8px" }}>
        <p>Hello</p>
      </div>,
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings)
      expect(finding.provenance).toContain(COMPATIBILITY_PROVENANCE.apiVersion);
  });
});

describe("severity policy", () => {
  it("reports cosmetic degradation separately from source risks", () => {
    const { findings } = check(<div style={{ borderRadius: "8px" }}>Hello</div>);
    const radius = findings.find((finding) => finding.code === "caniemail/border-radius");
    expect(radius?.severity).toBe("info");
    expect(radius?.compatibility?.assessment).toBe("degradation");
    expect(radius?.message).toContain("square");
    expect(radius?.clients).toContain("Outlook classic Windows");
  });

  it("reports partial support with the note that says what is partial", () => {
    const { findings } = check(
      <html lang="en">
        <body>
          <p>Hello</p>
        </body>
      </html>,
    );
    const body = findings.find((finding) => finding.code === "caniemail/body-element");
    expect(body?.severity).toBe("info");
    expect(body?.compatibility?.assessment).toBe("unverified");
    expect(body?.notes).toContain("Partial");
  });

  it("names every affected client on one finding rather than repeating it per client", () => {
    const { findings } = check(<div style={{ borderRadius: "8px" }}>Hello</div>);
    const radius = findings.find((finding) => finding.code === "caniemail/border-radius");
    expect(radius?.clients?.length).toBeGreaterThan(0);
    expect(new Set(radius?.clients).size).toBe(radius?.clients?.length);
  });

  it("says plainly when the pinned rules cover nothing about a construct", () => {
    const [finding] = unknownCoverage(["container-queries"]);
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("no client claim is made");
    expect(unknownCoverage(["border-radius"])).toEqual([]);
  });
});

describe("findings map back to the authoring element", () => {
  it("carries the origin of the element that produced the emitted markup", () => {
    const origin = { fileName: "emails/welcome.tsx", lineNumber: 9, columnNumber: 5 };
    const { findings } = check(
      jsxDEV(
        "div",
        { style: { borderRadius: "8px" }, children: "Hello" },
        undefined,
        false,
        origin,
      ),
    );
    const radius = findings.find((finding) => finding.code === "caniemail/border-radius");
    expect(radius?.origins[0]).toEqual(origin);
  });

  it("checks the document a recipient receives, not the authored source", () => {
    // `Button` emits a VML fallback and an anchor no author wrote; the check
    // still sees them, because it reads what the compiler produced.
    const rendered = renderEmail(receipt, receiptFixtures.typical);
    const emitted = serializeEmailHtml(rendered.tree);
    const findings = checkEmailCompatibility({
      html: emitted.html,
      positions: emitted.positions,
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.code.startsWith("caniemail/"))).toBe(true);
  });
});
