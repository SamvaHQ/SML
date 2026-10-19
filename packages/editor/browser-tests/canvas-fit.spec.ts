import { expect, test, type Locator, type Page } from "@playwright/test";

// Fit zoom derives from the canvas viewport's width. Whether the zoomed email
// overflows depends on the zoom, so a width that moved with the scrollbar fed
// the zoom back into itself and flipped it between two values.

// Headless Chromium hides scrollbars, which hides the defect with them.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const zoomSamples = (page: Page, frames: number) =>
  page.evaluate(async (count) => {
    const column = document.querySelector<HTMLElement>("[data-canvas-zoom]")!;
    const samples: string[] = [];
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(column.style.zoom);
    }
    return samples;
  }, frames);

test("fit zoom does not depend on whether the canvas scrolls", async ({ page }) => {
  // Narrow enough that fit scales the desktop width down.
  await page.setViewportSize({ width: 700, height: 2400 });
  await page.goto("/");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  const column = page.locator("[data-canvas-zoom]");
  await expect(column).toHaveAttribute("data-canvas-zoom", "fit");

  const viewport = page.locator("[data-samva-canvas-viewport]");
  const overflows = () =>
    viewport.evaluate((element) => element.scrollHeight > element.clientHeight);

  expect(await overflows()).toBe(false);
  const [unscrolled] = await zoomSamples(page, 2);
  expect(Number(unscrolled)).toBeLessThan(1);

  // Find where the email starts to overflow, then hold every height around that
  // point to one zoom across many frames.
  let threshold = 1000;
  while (threshold > 360) {
    await page.setViewportSize({ width: 700, height: threshold });
    await zoomSamples(page, 2);
    if (await overflows()) break;
    threshold -= 20;
  }
  for (let height = threshold + 40; height >= threshold - 40; height -= 4) {
    await page.setViewportSize({ width: 700, height });
    const samples = await zoomSamples(page, 8);
    expect(new Set(samples), `zoom at height ${height}`).toEqual(new Set([unscrolled]));
  }
  expect(await overflows()).toBe(true);
});

// Zoom on the canvas of the standalone editor: the control's steps, its limits, and the pinch
// and keyboard chords that zoom the canvas instead of the page.

const STANDALONE = { width: 1440, height: 1000 } as const;

const openStandalone = async (page: Page) => {
  await page.setViewportSize(STANDALONE);
  await page.goto("/");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("canvas.zoom-control")).toBeVisible();
};

const zoomOf = (page: Page) => page.locator("[data-canvas-zoom]");

/** Set the zoom to actual size, whatever the layout started at. */
const actualSize = async (page: Page) => {
  await page.getByTestId("canvas.zoom-value").click();
  await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "100");
};

const pageNotZoomed = (page: Page) =>
  page.evaluate(() => ({
    scale: window.visualViewport!.scale,
    clientWidth: document.documentElement.clientWidth,
  }));

/** A pinch or Ctrl+wheel with the pointer over `target`. */
const pinch = async (page: Page, target: Locator, deltaY: number) => {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
};

test.describe("zoom control", () => {
  test("zoom in and out step between 100 and 110", async ({ page }) => {
    await openStandalone(page);
    await actualSize(page);
    await page.getByTestId("canvas.zoom-in").click();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "110");
    await expect(page.getByTestId("canvas.zoom-value")).toHaveText("110%");
    await page.getByTestId("canvas.zoom-out").click();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "100");
    await expect(page.getByTestId("canvas.zoom-value")).toHaveText("100%");
  });

  test("zoom out stops at 50 and zoom in stops at 200", async ({ page }) => {
    await openStandalone(page);
    await actualSize(page);
    const out = page.getByTestId("canvas.zoom-out");
    const zoomIn = page.getByTestId("canvas.zoom-in");

    for (let step = 0; step < 12 && (await out.isEnabled()); step += 1) await out.click();
    await expect(out).toBeDisabled();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "50");
    await expect(zoomOf(page)).toHaveCSS("zoom", "0.5");
    await expect(page.getByTestId("canvas.zoom-value")).toHaveText("50%");

    await page.getByTestId("canvas.zoom-value").click();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "100");
    for (let step = 0; step < 12 && (await zoomIn.isEnabled()); step += 1) await zoomIn.click();
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "200");
    await expect(zoomOf(page)).toHaveCSS("zoom", "2");

    await page.getByTestId("canvas.zoom-value").click();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "100");
    await expect(page.getByTestId("canvas.zoom-value")).toHaveText("100%");
  });

  test("Fit hands the zoom back to the pane", async ({ page }) => {
    await openStandalone(page);
    await actualSize(page);
    const fit = page.getByTestId("canvas.zoom");
    await expect(fit).toHaveAttribute("aria-pressed", "false");
    await fit.click();
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "fit");
    await expect(fit).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("canvas.zoom-in").click();
    await expect(fit).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("zoom gestures", () => {
  test("a pinch over the canvas zooms the canvas and leaves the page alone", async ({ page }) => {
    await openStandalone(page);
    await actualSize(page);
    const pageBefore = await pageNotZoomed(page);
    expect(pageBefore.scale).toBe(1);

    await pinch(page, page.locator("[data-samva-canvas-viewport]"), -200);
    await expect(zoomOf(page)).not.toHaveAttribute("data-canvas-zoom", "100");
    await expect(zoomOf(page)).not.toHaveAttribute("data-canvas-zoom", "fit");
    expect(await pageNotZoomed(page)).toEqual(pageBefore);
  });

  test("a pinch over the email itself zooms the canvas too", async ({ page }) => {
    await openStandalone(page);
    await actualSize(page);
    const pageBefore = await pageNotZoomed(page);

    await pinch(page, page.getByTestId("canvas.frame"), 200);
    await expect(zoomOf(page)).not.toHaveAttribute("data-canvas-zoom", "100");
    await expect(zoomOf(page)).not.toHaveAttribute("data-canvas-zoom", "fit");
    expect(Number(await zoomOf(page).getAttribute("data-canvas-zoom"))).toBeLessThan(100);
    expect(await pageNotZoomed(page)).toEqual(pageBefore);
  });

  test("Ctrl with = and 0 zooms the canvas from any editor control", async ({ page }) => {
    await openStandalone(page);
    await actualSize(page);
    await page.getByTestId("canvas.zoom-control").getByTestId("canvas.zoom-out").focus();
    await page.getByTestId("canvas.zoom-in").focus();

    await page.keyboard.press("Control+=");
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "110");
    await page.keyboard.press("Control+0");
    await expect(zoomOf(page)).toHaveAttribute("data-canvas-zoom", "100");
    expect((await pageNotZoomed(page)).scale).toBe(1);
  });
});
