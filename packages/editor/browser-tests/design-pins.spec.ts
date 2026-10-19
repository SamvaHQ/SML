import { expect, test, type Page } from "@playwright/test";

import { CLAIM_BAG_TEXT, HEADLINE, ROAST_PARAGRAPH, ROASTED_TO_ORDER } from "./fixture-copy";

// Design mode and pins in the docked workspace. The harness's host stands in for the dashboard:
// it writes each staged edit to its draft, saves versions after a moment, and `?applyFail` /
// `?applyHold` make a save fail or stay in flight.

const WIDE = { width: 1440, height: 900 } as const;
/** The harness's paragraph, whose authoring resolves in the entry, so block edits apply. */
const PARAGRAPH = ROAST_PARAGRAPH;

const open = async (page: Page, query = "") => {
  await page.setViewportSize(WIDE);
  await page.goto(`/?demo=workspace${query}`);
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
};

const frame = (page: Page) => page.frameLocator('[data-testid="canvas.frame"]');
/** Click a rendered element centred in the canvas, clear of the dock and tray at the bottom. */
const clickInEmail = async (page: Page, text: string) => {
  const target = frame(page).getByText(text).first();
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await target.click();
};
const dock = (page: Page) => page.getByTestId("design-dock");
const source = (page: Page) => page.locator("[data-editor-authored-source]");

const designOn = async (page: Page) => {
  await page.getByTestId("preview-bar.design").click();
  await expect(page.getByTestId("preview-bar.design")).toHaveAttribute("aria-pressed", "true");
  await expect(dock(page)).toHaveAttribute("data-pending", "0");
};

/** Duplicate the harness paragraph from the toolbar and wait for the draft to take it. */
const duplicateParagraph = async (page: Page, pending: number) => {
  await frame(page).getByText(PARAGRAPH).first().click();
  await frame(page).getByTestId("design-toolbar.duplicate").click();
  await expect(dock(page)).toHaveAttribute("data-pending", String(pending));
  await expect(page.getByTestId("preview-bar.progress")).toHaveCount(0);
};

const paragraphCount = async (page: Page) =>
  ((await source(page).textContent()) ?? "").split(PARAGRAPH).length - 1;

test("Design selects with a toolbar and stages edits on the draft", async ({ page }) => {
  await open(page);
  await expect(dock(page)).toHaveCount(0);
  await designOn(page);
  await frame(page).getByText(PARAGRAPH).first().click();
  await expect(frame(page).getByTestId("design-toolbar")).toBeVisible();
  await expect(page.getByTestId("canvas.design-properties")).toBeVisible();
  const before = await paragraphCount(page);
  await duplicateParagraph(page, 1);
  expect(await paragraphCount(page)).toBe(before + 1);
  await expect(page.getByTestId("design-dock.status")).toHaveText("1 edit staged");
  await expect(page.getByTestId("preview-bar.design-count")).toContainText("1");
  await expect(page.getByTestId("design-dock.apply")).toHaveText("Apply");
  await duplicateParagraph(page, 2);
  await duplicateParagraph(page, 3);
  await expect(page.getByTestId("design-dock.apply")).toHaveText("Apply 3 edits");
  // Leaving Design waits for the edits; the switch says why rather than going dead.
  await expect(page.getByTestId("preview-bar.design")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("preview-bar.design").click({ force: true });
  await expect(page.getByTestId("preview-bar.design")).toHaveAttribute("aria-pressed", "true");
});

test("undo, redo, compare and a confirmed reset walk the staged edits", async ({ page }) => {
  await open(page);
  await designOn(page);
  const original = await source(page).textContent();
  await duplicateParagraph(page, 1);
  await duplicateParagraph(page, 2);
  await page.getByTestId("design-dock.undo").click();
  await expect(dock(page)).toHaveAttribute("data-pending", "1");
  await page.getByTestId("design-dock.redo").click();
  await expect(dock(page)).toHaveAttribute("data-pending", "2");

  await page.getByTestId("design-dock.compare").click();
  await expect(page.getByTestId("design-dock.compare")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("canvas.compare-badge")).toBeVisible();
  await page.getByTestId("design-dock.compare").click();
  await expect(page.getByTestId("canvas.compare-badge")).toHaveCount(0);

  await page.getByTestId("design-dock.reset").click();
  await expect(page.getByTestId("design-dock.reset-confirm")).toContainText("Reset all 2 edits?");
  await page.getByTestId("design-dock.reset-cancel").click();
  await expect(dock(page)).toHaveAttribute("data-pending", "2");
  await page.getByTestId("design-dock.reset").click();
  await page.getByTestId("design-dock.reset-confirm-button").click();
  await expect(dock(page)).toHaveAttribute("data-pending", "0");
  await expect(source(page)).toHaveText(original ?? "");
});

test("the chat waits while edits are staged and Apply saves them as one version", async ({
  page,
}) => {
  await open(page);
  await designOn(page);
  await expect(page.getByTestId("dev-app.send")).toBeEnabled();
  await duplicateParagraph(page, 1);
  await duplicateParagraph(page, 2);
  await expect(page.getByTestId("dev-app.chat-waits")).toBeVisible();
  await expect(page.getByTestId("dev-app.send")).toBeDisabled();
  await page.getByTestId("design-dock.apply").click();
  await expect(dock(page)).toHaveAttribute("data-state", "applying");
  await expect(page.getByTestId("design-dock.apply")).toHaveText("Applying…");
  await expect(dock(page)).toHaveAttribute("data-pending", "0");
  await expect(dock(page)).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("dev-app.send")).toBeEnabled();
  await page.getByTestId("preview-bar.design").click();
  await expect(dock(page)).toHaveCount(0);
});

test("a failed Apply keeps the edits and offers another try", async ({ page }) => {
  await open(page, "&applyFail");
  await designOn(page);
  await duplicateParagraph(page, 1);
  await page.getByTestId("design-dock.apply").click();
  await expect(page.getByTestId("design-dock.error")).toContainText("Your edits are kept.");
  await expect(dock(page)).toHaveAttribute("data-pending", "1");
  await expect(page.getByTestId("design-dock.apply")).toHaveText("Try again");
  await expect(page.getByTestId("dev-app.send")).toBeDisabled();
});

test("Design waits for an assistant turn to finish", async ({ page }) => {
  await open(page, "&busy");
  const toggle = page.getByTestId("preview-bar.design");
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
  await toggle.click({ force: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toHaveAttribute("aria-disabled", "true");
});

test("pins drop numbered, carry notes, renumber and clear after a confirm", async ({ page }) => {
  await open(page);
  await page.getByTestId("preview-bar.pin").click();
  await expect(page.getByTestId("pin-tray")).toHaveAttribute("data-count", "0");
  await clickInEmail(page, ROASTED_TO_ORDER);
  await clickInEmail(page, CLAIM_BAG_TEXT);
  await clickInEmail(page, HEADLINE);
  await expect(page.getByTestId("pin-tray")).toHaveAttribute("data-count", "3");
  await expect(frame(page).locator("[data-samva-pin]")).toHaveCount(3);
  // A click in pin mode pins and never selects.
  await expect(page.locator("[data-editor-selected-instance-path]")).toHaveText("");

  await page.getByTestId("pin-tray.note.1").fill("Shorten this");
  const pins = page.getByTestId("dev-app.composer-pins");
  await expect(pins).toContainText("Shorten this");
  await expect(pins.locator("li")).toHaveCount(3);

  await page.getByTestId("pin-tray.remove.1").click();
  await expect(page.getByTestId("pin-tray")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("pin-tray.row.1")).toContainText("Button");
  await expect(pins).not.toContainText("Shorten this");

  await page.getByTestId("pin-tray.clear").click();
  await expect(page.getByTestId("pin-tray.clear-confirm")).toHaveText("Remove all 2?");
  await page.getByTestId("pin-tray.clear-cancel").click();
  await expect(page.getByTestId("pin-tray")).toHaveAttribute("data-count", "2");
  await page.getByTestId("pin-tray.clear").click();
  await page.getByTestId("pin-tray.clear-confirm-button").click();
  await expect(page.getByTestId("pin-tray")).toHaveAttribute("data-count", "0");
  await expect(pins).toHaveCount(0);
});

test("sending from the chat takes the pins and clears them", async ({ page }) => {
  await open(page);
  await page.getByTestId("preview-bar.pin").click();
  await clickInEmail(page, ROASTED_TO_ORDER);
  await page.getByTestId("dev-app.send").click();
  await expect(page.getByTestId("dev-app.composer")).toContainText("Sent with 1 pin");
  await expect(page.getByTestId("pin-tray")).toHaveAttribute("data-count", "0");
});

test("on a phone the Design bar keeps Apply on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=workspace");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await page.getByTestId("agent-workspace.tab.preview").click();
  await page.getByTestId("preview-bar.design").click();
  const apply = page.getByTestId("design-dock.apply");
  await expect(apply).toBeVisible();
  const box = await apply.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

test("pins sit above the Design bar, not over it", async ({ page }) => {
  await open(page);
  await page.getByTestId("preview-bar.pin").click();
  await clickInEmail(page, ROASTED_TO_ORDER);
  await page.getByTestId("preview-bar.pin").click();
  await page.getByTestId("preview-bar.design").click();
  const tray = await page.getByTestId("pin-tray").boundingBox();
  const bar = await page.locator('[data-slot="editor-design-bar"]').boundingBox();
  expect(tray!.y + tray!.height).toBeLessThanOrEqual(bar!.y);
});
