/** @vitest-environment happy-dom */
import { describe, expect, it } from "@effect/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach } from "vitest";

import { Segmented, Tip } from "../src/chrome/ui";
import { Button } from "../src/ui/button";

afterEach(cleanup);

describe("Tip", () => {
  it("keeps the trigger's own name and reveals help on focus", async () => {
    const view = render(
      <Tip label="Connect a sending domain before sending a test" shortcut="⌘T">
        <Button aria-label="Send a test" data-testid="chrome-ui.trigger">
          S
        </Button>
      </Tip>,
    );
    const button = view.getByTestId("chrome-ui.trigger");
    fireEvent.focus(button);

    expect(button.getAttribute("aria-label")).toBe("Send a test");
    expect(button.getAttribute("title")).toBeNull();
    const tooltip = await view.findByRole("tooltip");
    expect(tooltip.getAttribute("data-slot")).toBe("tooltip-content");
    expect(tooltip.querySelector('[data-slot="kbd"]')?.textContent).toBe("⌘T");
  });
});

describe("Segmented", () => {
  it("names the group, marks the chosen option, and reports a change", async () => {
    const changes: string[] = [];
    const view = render(
      <Segmented
        ariaLabel="Canvas preview width"
        value="desktop"
        onChange={(value) => changes.push(value)}
        options={[
          { value: "desktop", label: "D", title: "Desktop width", testId: "desktop" },
          { value: "mobile", label: "M", title: "Phone width", testId: "mobile" },
        ]}
      />,
    );

    expect(view.getByRole("group").getAttribute("aria-label")).toBe("Canvas preview width");
    expect(view.getByTestId("desktop").getAttribute("aria-pressed")).toBe("true");
    const mobile = view.getByTestId("mobile");
    expect(mobile.getAttribute("data-slot")).toBe("toggle-group-item");
    fireEvent.focus(mobile);
    expect((await view.findByRole("tooltip")).textContent).toBe("Phone width");
    fireEvent.click(mobile);
    expect(changes).toEqual(["mobile"]);
  });
});
