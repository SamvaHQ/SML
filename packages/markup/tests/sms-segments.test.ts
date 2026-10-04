import { describe, expect, it } from "@effect/vitest";

import { smsSegmentInfo } from "../src/sms-segments";

// GSM 03.38 segment math: encoding and how many segments a text costs.
describe("smsSegmentInfo — GSM 03.38 table", () => {
  // [label, text, encoding, segments]
  const cases: ReadonlyArray<readonly [string, string, "gsm7" | "ucs2", number]> = [
    ["empty", "", "gsm7", 1],
    ["single gsm segment at 160", "a".repeat(160), "gsm7", 1],
    ["gsm rolls to 2 segments at 161", "a".repeat(161), "gsm7", 2],
    ["two full multi segments at 306", "a".repeat(306), "gsm7", 2],
    ["third segment at 307", "a".repeat(307), "gsm7", 3],
    ["extension chars cost two septets (80 € = 160)", "€".repeat(80), "gsm7", 1],
    ["81 € overflows to 2 segments", "€".repeat(81), "gsm7", 2],
    ["brackets are extension chars", `${"a".repeat(158)}[]`, "gsm7", 2],
    ["gsm basic set incl. ñ @ £", "señor @ £5", "gsm7", 1],
    ["digits are GSM-7, not UCS-2", "Your code is 482913", "gsm7", 1],
    ["160 digit chars stay a single GSM-7 segment", "1234567890".repeat(16), "gsm7", 1],
    ["161 digit chars roll to 2 GSM-7 segments", `${"1234567890".repeat(16)}7`, "gsm7", 2],
    ["unicode flips to ucs2", "→".repeat(1), "ucs2", 1],
    ["ucs2 single segment at 70", `→${"a".repeat(69)}`, "ucs2", 1],
    ["ucs2 rolls to 2 at 71", `→${"a".repeat(70)}`, "ucs2", 2],
    ["ucs2 code points counted, not UTF-16 units (70 emoji = 1)", "🎉".repeat(70), "ucs2", 1],
    ["71 emoji code points roll to 2 segments", "🎉".repeat(71), "ucs2", 2],
    ["curly quote is non-GSM", "it’s here", "ucs2", 1],
  ];

  it.each(cases)("%s", (_label, text, encoding, segments) => {
    const info = smsSegmentInfo(text);
    expect(info.encoding).toBe(encoding);
    expect(info.segmentCount).toBe(segments);
  });
});
