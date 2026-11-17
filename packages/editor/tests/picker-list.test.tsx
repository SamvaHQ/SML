/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { PickerList, type PickerOption } from "../src/chrome/color-field";

afterEach(cleanup);

const option = (key: string, selected = false): PickerOption => ({
  key,
  testId: `option.${key}`,
  name: key,
  selected,
  onChoose: () => {},
});

describe("a picker list", () => {
  it("moves the tab stop with arrow-key focus", () => {
    const view = render(
      <PickerList
        label="Color"
        groups={[
          { label: "Brand", options: [option("ink"), option("accent", true)] },
          { label: "Theme", options: [option("muted")] },
        ]}
      />,
    );
    const tabStops = () =>
      ["ink", "accent", "muted"].filter((key) => view.getByTestId(`option.${key}`).tabIndex === 0);
    expect(tabStops()).toEqual(["accent"]);
    const accent = view.getByTestId("option.accent");
    accent.focus();
    fireEvent.keyDown(accent, { key: "ArrowDown" });
    expect(document.activeElement).toBe(view.getByTestId("option.muted"));
    expect(tabStops()).toEqual(["muted"]);
    fireEvent.keyDown(view.getByTestId("option.muted"), { key: "Home" });
    expect(tabStops()).toEqual(["ink"]);
  });
});
