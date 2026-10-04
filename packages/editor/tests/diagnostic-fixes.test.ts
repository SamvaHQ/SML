import { describe, expect, it } from "@effect/vitest";
import { applySourceReplacements } from "@samva/markup/edit";

import { newWindowTargetFix } from "../src/state/diagnostic-fixes";
import type { CheckItem } from "../src/state/types";

const check: CheckItem = {
  id: "compat:caniemail/target-attribute",
  severity: "warn",
  label: "target attribute",
  detail: "1 finding",
  diagnostics: [
    {
      code: "caniemail/target-attribute",
      severity: "warning",
      message: "Client forces a new window",
      origins: [{ fileName: "email.tsx", lineNumber: 1, columnNumber: 1 }],
    },
  ],
};

describe("deterministic diagnostic fixes", () => {
  it("offers the exact local literal edit and rejects a stale source replacement", () => {
    const source = '<a href="https://example.com" target="_self">Open</a>';
    const edits = newWindowTargetFix(check, source, "email.tsx");
    expect(edits).toHaveLength(1);
    expect(applySourceReplacements(source, edits)).toEqual({
      ok: true,
      source: source.replace('"_self"', '"_blank"'),
    });
    expect(applySourceReplacements(source.replace('"_self"', '"_top"'), edits).ok).toBe(false);
  });

  it.each([
    "<a target={destination}>Open</a>",
    '<a target="_self" {...props}>Open</a>',
    '<Link target="_self">Open</Link>',
    '<a target="_blank">Open</a>',
    '<a target="named-frame">Open</a>',
  ])("does not guess a replacement for %s", (source) => {
    expect(newWindowTargetFix(check, source, "email.tsx")).toEqual([]);
  });

  it("does not edit an origin from a different file", () => {
    expect(newWindowTargetFix(check, '<a target="_self">Open</a>', "another.tsx")).toEqual([]);
  });
});
