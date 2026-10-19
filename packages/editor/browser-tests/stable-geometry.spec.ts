import { expect, test, type Page } from "@playwright/test";

// The editor draws its final chrome from mount: a host that takes a while to open the document
// sees the top bar and the preview bar in place, so nothing moves under the customer when the
// document lands. `?openHold` holds the workspace harness's document back.

const HOLD_MS = 1_500;

/** Where the controls a customer reaches for sit, and where the canvas starts. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      canvas: box("[data-samva-canvas-viewport]"),
      previewBar: box('[data-testid="preview-bar"]'),
      preview: box('[data-testid="topbar.preview"]'),
      paneSwitch: box('[data-testid="agent-workspace.tab.preview"]'),
    };
  });

for (const [layout, size] of [
  ["wide", { width: 1440, height: 900 }],
  // Below the wide layout the docked assistant puts the pane switch in the top bar and opens on
  // Chat; the switch is there before the document, and Preview shows the preview bar.
  ["standard", { width: 1100, height: 900 }],
] as const) {
  test(`the ${layout} editor keeps its chrome in place when the document lands`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto(`/?demo=workspace&openHold=${HOLD_MS}`);
    if (layout === "standard") await page.getByTestId("agent-workspace.tab.preview").click();
    await expect(page.getByTestId("preview-bar")).toBeVisible();
    await expect(page.getByText("Loading document…")).toBeVisible();
    const loading = await geometry(page);

    await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
    const loaded = await geometry(page);

    expect(loading.canvas).not.toBeNull();
    expect(loading.preview).not.toBeNull();
    expect(loaded).toEqual(loading);
  });
}
