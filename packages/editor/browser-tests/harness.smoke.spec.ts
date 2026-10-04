import { expect, test } from "@playwright/test";

import { CLAIM_BAG_TEXT, ROASTED_TO_ORDER } from "./fixture-copy";

test("boots the standalone editor on the mock host's rendered fixture", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-editor-harness-ready]")).toBeAttached();
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");

  const document = page.locator("iframe").contentFrame();
  await expect(document.getByText(CLAIM_BAG_TEXT)).toBeVisible();
  await expect(document.getByText(ROASTED_TO_ORDER)).toBeVisible();
});

test("a click in the rendered document resolves to one rendered instance", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-editor-harness-ready]")).toBeAttached();

  const selected = page.locator("[data-editor-selected-instance-path]");
  await expect(selected).toHaveText("");

  const document = page.locator("iframe").contentFrame();
  await document.getByText(CLAIM_BAG_TEXT).click();

  // The anchor is a link: the canvas selects it instead of following its href.
  await expect(selected).not.toHaveText("");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("save version stays reachable in a narrow editor", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expect(page.locator("[data-editor-harness-ready]")).toBeAttached();

  const save = page.getByTestId("topbar.save-version");
  await expect(save).toBeVisible();
  const bounds = await save.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await save.click();
  await expect(page.getByTestId("statusbar.save-version")).toHaveAttribute(
    "data-save-version-state",
    "saved",
  );
});
