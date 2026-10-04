import { afterEach, describe, expect, it } from "@effect/vitest";

import {
  checkEmailCompatibility,
  ESSENTIAL_CONSTRUCTS,
  hasBlockingCompatibility,
} from "../src/email/compatibility";
import { parseStylesheet } from "../src/email/css";
import { compileTailwind } from "../src/email/tailwind";
import { CAMPAIGN_CLASSES, COMPATIBILITY_CORPUS } from "./fixtures/email-compatibility-corpus";
import { registerStylesheet, resetStylesheets } from "./support/stylesheet-registry";

// The corpus is the compiler's own output. If Samva's primitives produce a
// document Samva then refuses to publish, the policy is wrong or the primitives
// are — either way it has to be caught here rather than by a customer.

// The registry is module state shared by every suite in this worker, so a sheet
// this file registers would otherwise reach a later file's render.
afterEach(resetStylesheets);

const renderCase = async (entry: (typeof COMPATIBILITY_CORPUS)[number]) => {
  resetStylesheets();
  if (entry.id === "campaign-responsive-dark") {
    const compiled = await compileTailwind(CAMPAIGN_CLASSES);
    registerStylesheet(parseStylesheet(compiled.css, { origin: "tailwind" }));
  }
  const input =
    entry.id === "branded-local-asset" ? { name: "Ada", logoUrl: "./assets/abc.png" } : entry.input;
  const rendered = entry.render(input, {
    relativeUrls: !entry.emailable,
  });
  return {
    rendered,
    findings: checkEmailCompatibility({
      html: rendered.html,
      positions: rendered.positions,
    }),
  };
};

describe("the compiler's own output is publishable", () => {
  for (const entry of COMPATIBILITY_CORPUS) {
    it(`${entry.id} carries no blocking finding`, async () => {
      const { findings } = await renderCase(entry);
      const blocking = findings.filter((finding) => finding.severity === "error");
      expect(blocking.map((finding) => `${finding.code}: ${finding.message}`)).toEqual([]);
      expect(hasBlockingCompatibility(findings)).toBe(false);
    });
  }

  it("still reports the degradation an author should know about", async () => {
    const { findings } = await renderCase(COMPATIBILITY_CORPUS[0]!);
    const codes = findings.map((finding) => finding.code);
    // Classic Outlook drops the rounded corner and the anchor's target; both
    // degrade, so both warn rather than refusing the publication.
    expect(codes).toContain("caniemail/target-attribute");
    expect(findings.every((finding) => finding.clients !== undefined)).toBe(true);
  });

  it("keeps Tailwind's responsive and dark rules in the head of the campaign", async () => {
    const entry = COMPATIBILITY_CORPUS.find((item) => item.id === "campaign-responsive-dark")!;
    const { rendered } = await renderCase(entry);
    expect(rendered.html).toContain("@media (min-width:40rem)");
    expect(rendered.html).toContain("@media (prefers-color-scheme:dark)");
    expect(rendered.html).not.toContain("oklch");
  });

  it("marks the one case that cannot be emailed", () => {
    const local = COMPATIBILITY_CORPUS.filter((entry) => !entry.emailable);
    expect(local.map((entry) => entry.id)).toEqual(["branded-local-asset"]);
  });
});

describe("blocking policy", () => {
  it("blocks only on the enumerated essential constructs", () => {
    // The set is small on purpose: the contract is to block known content,
    // order, link and essential-layout failures, not every unsupported
    // property. Spacing units and link targets degrade and must not block.
    expect([...ESSENTIAL_CONSTRUCTS].sort()).toEqual([
      "<div> element",
      "<h1> to <h6> elements",
      "<img> element",
      "<p> element",
      "<span> element",
      "<table> element",
      "<ul>, <ol> and <dl>",
      "HTML5 doctype",
      "Local anchors",
      "align attribute",
      "display",
      "height attribute",
      "mailto: links",
      "valign attribute",
      "width attribute",
    ]);
    for (const degrading of ["rem unit", "target attribute", "border-radius", "overflow"])
      expect(ESSENTIAL_CONSTRUCTS.has(degrading)).toBe(false);
  });
});
