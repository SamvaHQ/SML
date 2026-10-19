import { expect, test, type Page } from "@playwright/test";

// The bar above the email canvas, in the docked-assistant harness (`?demo=workspace`), which
// supplies saved versions, a sent size, a new-tab opener and a host busy signal.

const WORKSPACE = "/?demo=workspace";
const WIDE = { width: 1440, height: 900 } as const;

const open = async (
  page: Page,
  url = WORKSPACE,
  size: { width: number; height: number } = WIDE,
) => {
  await page.setViewportSize(size);
  await page.goto(url);
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("preview-bar")).toBeAttached();
};

/** Every version row, Latest included. */
const VERSION_ROWS =
  '[data-testid^="preview-bar.version."], [data-testid="preview-bar.version-latest"]';

const openVersions = async (page: Page) => {
  await page.getByTestId("preview-bar.versions").click();
  await expect(page.getByTestId("preview-bar.versions-popup")).toBeVisible();
  await expect(page.getByTestId("preview-bar.version.c3")).toBeVisible();
};

test("the versions list offers Latest and every saved version, and search filters it", async ({
  page,
}) => {
  await open(page);
  await openVersions(page);
  await expect(page.getByTestId("preview-bar.version-latest")).toBeVisible();
  for (const commit of ["c4", "c3", "c2", "c1"]) {
    await expect(page.getByTestId(`preview-bar.version.${commit}`)).toBeVisible();
  }
  await expect(page.locator(VERSION_ROWS)).toHaveCount(5);

  await page.getByTestId("preview-bar.versions-search").fill("brand");
  await expect(page.getByTestId("preview-bar.version.c3")).toBeVisible();
  await expect(page.getByTestId("preview-bar.version.c3")).toContainText("Brand applied");
  await expect(page.getByTestId("preview-bar.version.c4")).toHaveCount(0);
  await expect(page.getByTestId("preview-bar.version-latest")).toHaveCount(0);

  await page.getByTestId("preview-bar.versions-search").fill("zzz");
  await expect(page.getByTestId("preview-bar.versions-empty")).toBeVisible();

  await page.getByTestId("preview-bar.versions-search").fill("lat");
  await expect(page.getByTestId("preview-bar.version-latest")).toBeVisible();
  await expect(page.locator(VERSION_ROWS)).toHaveCount(1);
});

test("choosing a version asks first and restores nothing until confirmed", async ({ page }) => {
  await open(page);
  const source = page.locator("[data-editor-authored-source]");
  const before = await source.textContent();
  await openVersions(page);
  await page.getByTestId("preview-bar.version.c3").click();

  const dialog = page.getByTestId("preview-bar.restore-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Brand applied");
  await expect(source).toHaveText(before!);

  await page.getByTestId("preview-bar.restore-cancel").click();
  await expect(dialog).toBeHidden();
  await expect(source).toHaveText(before!);
  await expect(page.getByTestId("preview-bar.versions")).toBeEnabled();

  await openVersions(page);
  await page.getByTestId("preview-bar.version.c3").click();
  await expect(dialog).toBeVisible();
  await page.getByTestId("preview-bar.restore-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
});

test("the device toggle sets the email's width", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("preview-bar")).toBeVisible();
  const frame = page.getByTestId("canvas.frame");
  await expect(page.getByTestId("preview-bar.size")).toContainText("600 px");
  await page.getByTestId("canvas.device.mobile").click();
  await expect.poll(async () => (await frame.boundingBox())?.width).toBeCloseTo(375, 0);
  await expect(page.getByTestId("preview-bar.size")).toContainText("375 px");
  await page.getByTestId("canvas.device.desktop").click();
  await expect.poll(async () => (await frame.boundingBox())?.width).toBeCloseTo(600, 0);
});

test("the size readout names the sent size under a host that reports one, the preview otherwise", async ({
  page,
}) => {
  await open(page);
  const size = page.getByTestId("preview-bar.size");
  await expect(size).toContainText("KB");
  await expect(size).not.toContainText("preview");

  await open(page, "/", { width: 1440, height: 1000 });
  await expect(page.getByTestId("preview-bar.size")).toContainText("KB");
  await expect(page.getByTestId("preview-bar.size")).toContainText("preview");
});

test("a host still working keeps a progress line on the bar", async ({ page }) => {
  await open(page, `${WORKSPACE}&busy=1`);
  await expect(page.getByTestId("preview-bar.progress")).toBeVisible();
  await expect(page.getByTestId("preview-bar")).toHaveAttribute("data-busy", "");

  await open(page);
  await expect(page.getByTestId("preview-bar.progress")).toHaveCount(0);
});

test("Open in a new tab opens the email in a popup page", async ({ page, context }) => {
  await open(page);
  const popup = context.waitForEvent("page");
  await page.getByTestId("preview-bar.open").click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toMatch(/^blob:/);
  await expect(opened.locator("body")).not.toBeEmpty();
});

test("refreshing the preview keeps the email rendered", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("canvas.frame")).toBeVisible();
  await page.getByTestId("preview-bar.refresh").click();
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("canvas.frame")).toBeVisible();
  await expect(page.getByTestId("preview-bar.refresh")).toBeEnabled();
  await expect(page.getByTestId("canvas.unbuilt")).toHaveCount(0);
});

test("a preview that could not be built says why and leads to the checks", async ({ page }) => {
  await open(page, `${WORKSPACE}&dev=1`);
  await expect(page.getByTestId("canvas.preview-stale")).toHaveCount(0);
  await page.getByTestId("dev-app.stale-preview").click();
  const notice = page.getByTestId("canvas.preview-stale");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("closes a tag it never opened");
  // The last preview that worked stays on screen.
  await expect(page.getByTestId("canvas.frame")).toBeVisible();

  await page.getByTestId("canvas.preview-stale.checks").click();
  await expect(page.getByTestId("work-pane.tab.checks")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("work-pane.panel.checks")).toBeVisible();
});

test("in a narrow pane the size readout folds into a menu and the versions trigger stays", async ({
  page,
}) => {
  await open(page, WORKSPACE, { width: 390, height: 844 });
  await page.getByTestId("agent-workspace.tab.preview").click();
  await expect(page.getByTestId("preview-bar")).toBeVisible();
  await expect(page.getByTestId("preview-bar.size")).toBeHidden();
  await expect(page.getByTestId("preview-bar.open")).toBeHidden();
  await expect(page.getByTestId("preview-bar.more")).toBeVisible();
  await expect(page.getByTestId("preview-bar.versions")).toBeVisible();
  await expect(page.getByTestId("preview-bar.refresh")).toBeVisible();

  // A wide pane shows the readout and has no overflow menu.
  await page.setViewportSize(WIDE);
  await expect(page.getByTestId("preview-bar.size")).toBeVisible();
  await expect(page.getByTestId("preview-bar.more")).toBeHidden();
});
