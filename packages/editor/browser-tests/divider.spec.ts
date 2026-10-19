import { expect, test, type Locator, type Page } from "@playwright/test";

// The divider between the docked chat and the work pane: mouse, touch and keyboard resize it
// within [280, 640], and dragging it under 140 collapses the chat.

const WORKSPACE = "/?demo=workspace";
const MIN = 280;
const MAX = 640;
const KEY_STEP = 8;
const KEY_STEP_LARGE = 24;
const WIDE = { width: 1440, height: 900 } as const;

const open = async (page: Page) => {
  await page.setViewportSize(WIDE);
  await page.goto(WORKSPACE);
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("agent-column.resize")).toBeVisible();
};

const handleOf = (page: Page) => page.getByTestId("agent-column.resize");
const columnOf = (page: Page) => page.getByTestId("agent-column");

const valueNow = async (handle: Locator) => Number(await handle.getAttribute("aria-valuenow"));

/** The left edge of the container the handle measures against. */
const containerLeft = (handle: Locator) =>
  handle.evaluate((element) => element.parentElement!.getBoundingClientRect().left);

const handleCenter = async (handle: Locator) => {
  const box = (await handle.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Press on the handle, move to `x` (frame-relative), release. */
const drag = async (page: Page, x: number) => {
  const handle = handleOf(page);
  const left = await containerLeft(handle);
  const start = await handleCenter(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(left + x, start.y, { steps: 8 });
  await page.mouse.up();
};

test("dragging the divider sets the chat's width", async ({ page }) => {
  await open(page);
  await drag(page, 500);
  const handle = handleOf(page);
  expect(await valueNow(handle)).toBeCloseTo(500, -1);
  await expect(handle).toHaveAttribute("aria-valuenow", "500");
  const width = (await columnOf(page).boundingBox())!.width;
  expect(Math.abs(width - 500)).toBeLessThanOrEqual(2);
});

test("the chat width clamps at 640 and 280, and a drag under 140 collapses the chat", async ({
  page,
}) => {
  await open(page);
  const handle = handleOf(page);

  await drag(page, 900);
  await expect(handle).toHaveAttribute("aria-valuenow", String(MAX));
  expect((await columnOf(page).boundingBox())!.width).toBeCloseTo(MAX, 0);

  await drag(page, 200);
  await expect(handle).toHaveAttribute("aria-valuenow", String(MIN));
  expect((await columnOf(page).boundingBox())!.width).toBeCloseTo(MIN, 0);

  await drag(page, 100);
  await expect(columnOf(page)).toBeHidden();
  await expect(page.getByTestId("work-pane.toggle-chat")).toHaveAttribute(
    "aria-label",
    "Show chat",
  );
});

test("the chat width persists across a reload", async ({ page }) => {
  await open(page);
  await drag(page, 500);
  await expect(handleOf(page)).toHaveAttribute("aria-valuenow", "500");
  await page.reload();
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(handleOf(page)).toHaveAttribute("aria-valuenow", "500");
  expect(Math.abs((await columnOf(page).boundingBox())!.width - 500)).toBeLessThanOrEqual(2);
});

test("the divider is a keyboard separator with step, large step and limit keys", async ({
  page,
}) => {
  await open(page);
  const handle = handleOf(page);
  await expect(handle).toHaveAttribute("role", "separator");
  await expect(handle).toHaveAttribute("aria-valuemin", String(MIN));
  await expect(handle).toHaveAttribute("aria-valuemax", String(MAX));

  await handle.focus();
  const start = await valueNow(handle);
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(start + KEY_STEP));
  await page.keyboard.press("Shift+ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(start + KEY_STEP + KEY_STEP_LARGE));
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", String(start + KEY_STEP_LARGE));
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", String(MIN));
  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", String(MAX));
  expect((await columnOf(page).boundingBox())!.width).toBeCloseTo(MAX, 0);
});

test("a touch drag resizes the chat", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL!,
    hasTouch: true,
    viewport: WIDE,
  });
  try {
    const page = await context.newPage();
    await open(page);
    const handle = handleOf(page);
    const before = await valueNow(handle);
    const left = await containerLeft(handle);
    const start = await handleCenter(handle);

    // Real touch input, so the browser raises pointer events with pointerType "touch".
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y: start.y }],
      });
    await touch("touchStart", start.x);
    for (const x of [start.x + 40, left + 400, left + 560]) await touch("touchMove", x);
    await touch("touchEnd", left + 560);

    expect(await valueNow(handle)).not.toBe(before);
    await expect(handle).toHaveAttribute("aria-valuenow", "560");
    expect(Math.abs((await columnOf(page).boundingBox())!.width - 560)).toBeLessThanOrEqual(2);
  } finally {
    await context.close();
  }
});
