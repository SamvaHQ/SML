import { expect, test } from "@playwright/test";

test("an issue host keeps saved versions without a publish step", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=issue");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("topbar.publish")).toHaveCount(0);
  await expect(page.getByTestId("topbar.history")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("issue-history.png") });
  await page.getByTestId("topbar.history").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("lifecycle-sheet.file.issues/launch.md")).toBeVisible();
  await expect(page.getByTestId("lifecycle-sheet.confirm-publish")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("topbar.history")).toBeFocused();
});

test("a publishing host retains its primary Publish action", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=workspace");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("topbar.publish")).toBeVisible();
  await expect(page.getByTestId("topbar.history")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("template-publish.png") });
  await page.getByTestId("topbar.publish").click();
  await expect(page.getByTestId("lifecycle-sheet.confirm-publish")).toBeVisible();
});
