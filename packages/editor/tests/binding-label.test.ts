import { describe, expect, it } from "@effect/vitest";

import {
  bindingName,
  bindingPath,
  fixtureSample,
  renderedSamples,
} from "../src/chrome/binding-label";

const FIXTURE = `{
  firstName: "Maya",
  product: { shortName: "Apple Watch", productName: "Apple Watch Series 9", price: 399 },
  items: [{ name: "Strap" }],
  claimUrl: \`https://example.com/claim\`,
} satisfies Input`;

describe("binding names", () => {
  it("reads a plain path, and refuses anything worked out", () => {
    expect(bindingPath("{input.product.shortName}")).toEqual(["input", "product", "shortName"]);
    expect(bindingPath("input?.items[0].name")).toEqual(["input", "items", "0", "name"]);
    expect(bindingPath("input.total.toFixed(2)")).toBeNull();
    expect(bindingPath('input.vip ? "VIP" : ""')).toBeNull();
  });

  it("says the path the way an author would", () => {
    expect(bindingName(["input", "product", "shortName"])).toBe("Product short name");
    expect(bindingName(["input", "firstName"])).toBe("First name");
    expect(bindingName(["props", "claimUrl"])).toBe("Claim URL");
    expect(bindingName(["input", "product", "productName"])).toBe("Product name");
    expect(bindingName(["item", "name"])).toBe("Item name");
    expect(bindingName(["shortName"])).toBe("Short name");
    expect(bindingName(["input", "items", "0", "name"])).toBe("Items name");
  });
});

describe("binding samples", () => {
  it("reads the fixture's literal for a path under the input", () => {
    expect(fixtureSample(FIXTURE, ["input", "product", "shortName"])).toBe("Apple Watch");
    expect(fixtureSample(FIXTURE, ["input", "product", "price"])).toBe("399");
    expect(fixtureSample(FIXTURE, ["input", "items", "0", "name"])).toBe("Strap");
    expect(fixtureSample(FIXTURE, ["input", "claimUrl"])).toBe("https://example.com/claim");
    expect(fixtureSample(FIXTURE, ["input", "product"])).toBeNull();
    expect(fixtureSample(FIXTURE, ["input", "missing"])).toBeNull();
    expect(fixtureSample("{ broken: ", ["input", "broken"])).toBeNull();
  });

  it("reads what a binding rendered as from the element's text", () => {
    expect(
      renderedSamples("Your Apple Watch passed inspection", ["Your ", null, " passed inspection"]),
    ).toEqual(["Apple Watch"]);
    expect(renderedSamples("Hi Maya, order PRV-1", ["Hi ", null, ", order ", null])).toEqual([
      "Maya",
      "PRV-1",
    ]);
    // Two bindings side by side cannot be told apart.
    expect(renderedSamples("MayaLee", [null, null])).toEqual([null, null]);
    expect(renderedSamples("Something else", ["Your ", null, " passed"])).toEqual([null]);
  });
});
