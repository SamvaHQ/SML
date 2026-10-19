import { expect, test, type Page } from "@playwright/test";

// The Design tab over the harness's real Nimbus email: the layers name what the author wrote,
// and the properties stage plain edits that land in the draft as Tailwind classes.

const open = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=workspace");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await page.getByTestId("work-pane.add").click();
  await page.getByTestId("work-pane.add.design").click();
  await expect(page.getByTestId("design-panel")).toBeVisible();
};

const layers = (page: Page) => page.locator('[data-slot="editor-layers"]');
const source = (page: Page) => page.locator("[data-editor-authored-source]");

test("layers list the authored blocks by name, with no compiler scaffolding", async ({ page }) => {
  await open(page);
  const rows = layers(page).locator('[data-slot="editor-layer"]');
  const names = await rows.locator("button > span:nth-of-type(1)").allTextContents();
  const text = names.join("|");
  expect(text).toContain("Section");
  expect(text).toContain("Heading");
  expect(text).toContain("Button");
  await expect(rows.filter({ hasText: /^Column×3$/ })).toHaveCount(1);
  for (const scaffold of ["tbody", "td", "tr", "meta", "table"])
    expect(text).not.toContain(scaffold);
});

test("a block's background is a theme color, and the change is staged", async ({ page }) => {
  await open(page);
  await layers(page).locator('[data-layer-name="Section"]').nth(1).click();
  await expect(page.getByTestId("inspector.element-name")).toHaveText("Section");
  await expect(page.getByTestId("design-properties.color.bg.card")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("design-properties.color.bg.secondary").click();
  await expect(page.getByTestId("preview-bar.design-count")).toContainText("1");
  await expect(source(page)).toContainText('className="rounded-xl px-8 py-10 bg-secondary"');
  const inspector = page.getByTestId("design-panel").getByTestId("inspector");
  await expect(inspector).not.toContainText("0.1.1");
});

test("Advanced keeps the raw classes one click away", async ({ page }) => {
  await open(page);
  await layers(page).locator('[data-layer-name="Heading"]').click();
  await expect(page.getByTestId("source.classes")).toBeHidden();
  await page.getByTestId("source.advanced-toggle").click();
  await expect(page.getByTestId("source.classes")).toBeVisible();
});
