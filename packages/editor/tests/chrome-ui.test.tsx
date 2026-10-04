/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { IconBtn, Segmented, Toggle } from "../src/chrome/ui";

afterEach(cleanup);

describe("IconBtn", () => {
  it("keeps its accessible name and reveals help on focus", async () => {
    const view = render(
      <IconBtn title="Undo" testId="chrome-ui.icon-btn">
        U
      </IconBtn>,
    );
    const button = view.getByTestId("chrome-ui.icon-btn");

    // The title prop becomes the accessible name, not a native title tooltip.
    expect(button.getAttribute("aria-label")).toBe("Undo");
    fireEvent.focus(button);

    expect(button.getAttribute("title")).toBeNull();
    expect((await view.findByRole("tooltip")).textContent).toBe("Undo");
  });

  it("uses the Base UI trigger without duplicating native hover help", () => {
    const view = render(
      <IconBtn title="Redo" testId="chrome-ui.icon-btn">
        R
      </IconBtn>,
    );
    const button = view.getByTestId("chrome-ui.icon-btn");
    expect(button.getAttribute("aria-label")).toBe("Redo");
    expect(button.getAttribute("title")).toBeNull();
    expect(button.hasAttribute("data-base-ui-tooltip-trigger")).toBe(true);
  });

  it("can explain an action without changing its accessible name", async () => {
    const view = render(
      <IconBtn
        title="Send a test"
        help="Connect a sending domain before sending a test"
        testId="chrome-ui.icon-btn"
      >
        S
      </IconBtn>,
    );
    const button = view.getByTestId("chrome-ui.icon-btn");
    fireEvent.focus(button);

    expect(button.getAttribute("aria-label")).toBe("Send a test");
    expect((await view.findByRole("tooltip")).textContent).toBe(
      "Connect a sending domain before sending a test",
    );
  });

  it("keeps disabled controls named without opening a tooltip", async () => {
    const view = render(
      <IconBtn title="Undo" testId="chrome-ui.icon-btn" disabled>
        U
      </IconBtn>,
    );
    const button = view.getByTestId("chrome-ui.icon-btn");
    expect(button.getAttribute("aria-label")).toBe("Undo");

    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.mouseMove(button);
    fireEvent.focus(button);

    await waitFor(() => expect(view.queryByRole("tooltip")).toBeNull());
  });
});

describe("Toggle", () => {
  it("exposes its name, checked state, disabled state, and change contract", () => {
    const onChange = vi.fn();
    const view = render(
      <Toggle
        label="Hide on mobile"
        testId="chrome-ui.toggle"
        pressed={false}
        onChange={onChange}
      />,
    );
    const control = view.getByTestId("chrome-ui.toggle");

    expect(control.getAttribute("aria-label")).toBe("Hide on mobile");
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(onChange.mock.calls[0]?.[0]).toBe(true);

    view.rerender(
      <Toggle
        label="Hide on mobile"
        testId="chrome-ui.toggle"
        pressed
        disabled
        onChange={onChange}
      />,
    );
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Segmented", () => {
  it("names the group and shows icon-only option help on keyboard focus", async () => {
    const view = render(
      <Segmented
        ariaLabel="Canvas preview width"
        value="desktop"
        onChange={() => {}}
        options={[
          {
            value: "desktop",
            label: "D",
            title: "Preview desktop width",
            testId: "desktop",
          },
          {
            value: "mobile",
            label: "M",
            title: "Preview mobile width",
            testId: "mobile",
          },
        ]}
      />,
    );

    expect(view.getByRole("group").getAttribute("aria-label")).toBe("Canvas preview width");
    const mobile = view.getByTestId("mobile");
    fireEvent.focus(mobile);
    expect(mobile.getAttribute("title")).toBeNull();
    expect((await view.findByRole("tooltip")).textContent).toBe("Preview mobile width");
  });
});
