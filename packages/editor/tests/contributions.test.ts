import { describe, expect, it } from "@effect/vitest";

import { resolveContributions } from "../src/chrome/contributions";

const nothing = () => null;

describe("resolveContributions", () => {
  it("orders toolbar actions by `order`, then keeps the unordered ones in list order", () => {
    const slots = resolveContributions([
      { slot: "toolbar.actions", id: "history", render: nothing },
      { slot: "toolbar.actions", id: "publish", order: 2, render: nothing },
      { slot: "toolbar.actions", id: "send", order: 1, render: nothing },
      { slot: "toolbar.actions", id: "share", render: nothing },
    ]);
    expect(slots.all("toolbar.actions").map(({ id }) => id)).toEqual([
      "send",
      "publish",
      "history",
      "share",
    ]);
  });

  it("returns nothing for a region the host leaves empty", () => {
    const slots = resolveContributions([]);
    expect(slots.one("rail.assistant")).toBeUndefined();
    expect(slots.all("canvas.overlay")).toEqual([]);
  });

  it("refuses a second contribution to a region that holds one", () => {
    expect(() =>
      resolveContributions([
        { slot: "rail.assistant", id: "agent", render: nothing },
        { slot: "rail.assistant", id: "other-agent", render: nothing },
      ]),
    ).toThrow(/"rail.assistant" holds one contribution/);
  });

  it("refuses an id used twice, even across regions", () => {
    expect(() =>
      resolveContributions([
        { slot: "toolbar.actions", id: "history", render: nothing },
        { slot: "canvas.overlay", id: "history", render: nothing },
      ]),
    ).toThrow(/"history" is used twice/);
  });
});
