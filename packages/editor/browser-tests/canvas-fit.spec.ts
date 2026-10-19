import { expect, test, type Page } from "@playwright/test";

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
