import type { EmailElementSelection } from "@samva/markup/edit";
import { describe, expect, it } from "vitest";

import { correspondingPath } from "../src/state/target-map";

const selection = (
  instancePath: string,
  tag: string,
  line: number,
  occurrence = 1,
  authored = true,
): EmailElementSelection => ({
  instancePath,
  tag,
  authored,
  occurrence,
  occurrences: 1,
  start: 0,
  end: 0,
  origins: [{ fileName: "issue.md", lineNumber: line, columnNumber: 1 }],
});

describe("correspondingPath", () => {
  const email = [
    selection("0", "table", 1),
    selection("0.0", "td", 3),
    selection("0.1", "td", 3, 2),
  ];
  const page = [selection("0", "main", 1), selection("0.0", "p", 3), selection("0.1", "p", 3, 2)];

  it("matches an authored element by origin and iteration across targets", () => {
    expect(correspondingPath(email, page, "0.1")).toBe("0.1");
    expect(correspondingPath(page, email, "0.0")).toBe("0.0");
  });

  it("returns null when the other render has no such element", () => {
    expect(correspondingPath(email, [selection("0", "main", 1)], "0.0")).toBeNull();
    expect(correspondingPath(email, page, "9")).toBeNull();
  });

  it("returns null for an element with no authoring", () => {
    const generated = { ...selection("0", "div", 1), origins: [] };
    expect(correspondingPath([generated], page, "0")).toBeNull();
  });
});
