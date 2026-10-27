import { expect, test } from "@playwright/test";

test("shell popups stay in the portal and accept keyboard and pointer input", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=workspace&brand");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  const portal = page.locator("[data-samva-editor-portal-root]");

  await page.getByTestId("topbar.preview").focus();
  await expect(portal.getByRole("tooltip")).toHaveText("Preview template");
  await page.keyboard.press("Escape");

  await page.getByTestId("topbar.brand").click();
  await expect(portal.getByTestId("topbar.brand-menu")).toBeVisible();
  await portal.getByTestId("topbar.brand-manage").click();
  await expect(page).toHaveURL(/#brands$/);
  await expect(portal.getByTestId("topbar.brand-menu")).toBeHidden();

  await page.getByTestId("preview-bar.versions").click();
  await expect(portal.getByTestId("preview-bar.versions-popup")).toBeVisible();
  await portal.getByTestId("preview-bar.versions-search").fill("brand");
  await portal.getByTestId("preview-bar.version.c3").click();
  await expect(portal.getByTestId("preview-bar.restore-dialog")).toBeVisible();
  await portal.getByTestId("preview-bar.restore-cancel").click();
  await expect(portal.getByTestId("preview-bar.restore-dialog")).toBeHidden();
});
