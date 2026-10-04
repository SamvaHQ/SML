import { describe, expect, it } from "@effect/vitest";

import { callFormatter, createFmt, fmt, FORMATTER_NAMES, withFormatContext } from "../src/fmt";

describe("fmt", () => {
  const f = createFmt();
  // ICU versions differ on U+202F vs a plain space before AM/PM.
  const ws = (text: string) => text.replace(/\s/g, " ");

  it("formats money with the context or explicit locale", () => {
    expect(f.money(84, "USD")).toBe("$84.00");
    expect(f.money(84, "EUR", "de")).toBe("84,00 €");
    expect(createFmt({ locale: "de" }).money(84, "EUR")).toBe("84,00 €");
    expect(createFmt({ locale: "de" }).money(84, "EUR", "en-US")).toBe("€84.00");
  });

  it("formats numbers", () => {
    expect(f.number(1234.5, { maximumFractionDigits: 0 })).toBe("1,235");
    expect(f.number(1234.5)).toBe("1,234.5");
  });

  it("formats dates and times in the context time zone", () => {
    const iso = "2026-09-29T23:30:00Z";
    expect(f.date(iso)).toBe("Sep 29, 2026");
    expect(ws(f.time(iso))).toBe("11:30 PM");
    const la = createFmt({ timeZone: "America/Los_Angeles" });
    expect(la.date("2026-09-30T02:30:00Z")).toBe("Sep 29, 2026");
    expect(f.date("2026-09-30T02:30:00Z")).toBe("Sep 30, 2026");
    expect(ws(la.time("2026-09-29T22:30:00Z"))).toBe("3:30 PM");
    expect(f.date(iso, "full")).toContain("Tuesday");
  });

  it("treats date-only ISO as UTC midnight and honors offsets", () => {
    expect(createFmt({ timeZone: "America/Los_Angeles" }).date("2026-09-29")).toBe("Sep 28, 2026");
    expect(f.date("2026-09-29")).toBe("Sep 29, 2026");
    expect(f.date("2026-09-29T23:30:00-05:00")).toBe("Sep 30, 2026");
  });

  it("throws RangeError for unparsable dates and invalid Intl inputs", () => {
    expect(() => f.date("nope")).toThrow(RangeError);
    expect(() => f.money(1, "NOTACURRENCY")).toThrow(RangeError);
    expect(() => f.list(["a"], "not a locale")).toThrow(RangeError);
    expect(() => createFmt({ timeZone: "Mars/Base" }).date("2026-09-29")).toThrow(RangeError);
  });

  it("selects plural forms", () => {
    const forms = { one: "item", other: "items" };
    expect(f.plural(1, forms)).toBe("item");
    expect(f.plural(2, forms)).toBe("items");
    const ru = { one: "файл", few: "файла", many: "файлов", other: "файла" };
    expect(f.plural(1, ru, "ru")).toBe("файл");
    expect(f.plural(3, ru, "ru")).toBe("файла");
    expect(f.plural(5, ru, "ru")).toBe("файлов");
    expect(f.plural(3, { one: "a", other: "b" }, "ru")).toBe("b");
  });

  it("formats lists", () => {
    expect(f.list(["Ada", "Grace"])).toBe("Ada and Grace");
    expect(f.list(["Ada", "Grace", "Linus"])).toBe("Ada, Grace, and Linus");
  });

  it("rejects non-finite numbers", () => {
    expect(() => f.money(Number.NaN, "USD")).toThrow(TypeError);
    expect(() => f.number(Infinity)).toThrow(TypeError);
    expect(() => f.plural(Number.NaN, { other: "x" })).toThrow(TypeError);
  });

  it("uses the ambient context, nests, and restores after a throw", () => {
    expect(fmt.date("2026-09-29T23:30:00Z")).toBe("Sep 29, 2026");
    withFormatContext({ timeZone: "Asia/Tokyo" }, () => {
      expect(fmt.date("2026-09-29T23:30:00Z")).toBe("Sep 30, 2026");
      withFormatContext({ locale: "de" }, () => {
        expect(fmt.money(1, "EUR")).toBe("1,00 €");
        expect(fmt.date("2026-09-29T23:30:00Z")).toBe("29.09.2026");
      });
      expect(fmt.money(1, "EUR")).toBe("€1.00");
    });
    expect(() =>
      withFormatContext({ locale: "de" }, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(fmt.money(1, "EUR")).toBe("€1.00");
  });

  it("dispatches and validates through callFormatter", () => {
    expect(FORMATTER_NAMES).toEqual(["money", "number", "date", "time", "plural", "list"]);
    expect(callFormatter(f, "money", [84, "EUR", "de"])).toBe("84,00 €");
    expect(callFormatter(f, "number", [1234.5, { maximumFractionDigits: 0 }])).toBe("1,235");
    expect(callFormatter(f, "date", ["2026-09-29", "long"])).toBe("September 29, 2026");
    expect(ws(callFormatter(f, "time", ["2026-09-29T15:30:00Z"]))).toBe("3:30 PM");
    expect(callFormatter(f, "plural", [2, { one: "a", other: "b" }])).toBe("b");
    expect(callFormatter(f, "list", [["a", "b"]])).toBe("a and b");
    expect(() => callFormatter(f, "money", ["84", "EUR"])).toThrow(/money argument 1/);
    expect(() => callFormatter(f, "money", [84])).toThrow(/money takes 2 to 3/);
    expect(() => callFormatter(f, "date", ["2026-09-29", "tiny"])).toThrow(/date argument 2/);
    expect(() => callFormatter(f, "plural", [1, { one: "x" }])).toThrow(/plural argument 2/);
    expect(() => callFormatter(f, "list", ["a"])).toThrow(/list argument 1/);
    expect(() => callFormatter(f, "number", [Infinity])).toThrow(TypeError);
    expect(() => callFormatter(f, "nope", [])).toThrow(/Unknown formatter "nope"/);
  });
});
