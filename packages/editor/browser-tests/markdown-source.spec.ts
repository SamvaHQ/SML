import { expect, test, type Page } from "@playwright/test";

import { ISSUE_PROSE, SAVED_ISSUE_PROSE } from "./issue-fixture-copy";

const open = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?demo=issue");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.locator("[data-editor-authored-source]")).toContainText("title: Launch notes");
};

const sourceTab = async (page: Page) => {
  await page.getByTestId("workspace.tab.source").click();
  return page.getByTestId("source-workspace.authored-markdown");
};

const showInspector = async (page: Page) => {
  const show = page.getByTestId("shell.show-right");
  if (await show.isVisible()) await show.click();
};

test("Source edits the complete Markdown issue including frontmatter and saves both previews", async ({
  page,
}, testInfo) => {
  await open(page);
  const editor = await sourceTab(page);
  await expect(editor).toBeEditable();
  await expect(editor).toHaveAccessibleName("Authored Markdown · issues/launch.md");
  const original = await editor.inputValue();
  expect(original).toMatch(/^---\ntitle: Launch notes\n/);
  expect(original).not.toContain("defineTemplate");
  const next = original
    .replace("title: Launch notes", "title: October dispatch")
    .replace(ISSUE_PROSE, SAVED_ISSUE_PROSE);
  await editor.fill(next);
  await expect(page.getByTestId("dev-app.issue-source")).toHaveText(`issues/launch.md\n\n${next}`);
  await page.screenshot({ path: testInfo.outputPath("markdown-source-light.png") });
  await page.getByTitle("Toggle theme").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("markdown-source-dark.png") });
  await page.getByTitle("Toggle theme").click();
  await page.getByTestId("workspace.tab.visual").click();
  await expect(page.locator("iframe").contentFrame().getByText(SAVED_ISSUE_PROSE)).toBeVisible();
  await expect(page.getByTestId("preview-bar.target.email")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("preview-bar.target.web").click();
  await expect(page.locator("iframe").contentFrame().getByText(SAVED_ISSUE_PROSE)).toBeVisible();
  await expect(await sourceTab(page)).toHaveValue(next);
});

for (const target of ["email", "web"] as const) {
  test(`a click edits the issue's own prose from the ${target} preview`, async ({ page }) => {
    await open(page);
    await page.getByTestId(`preview-bar.target.${target}`).click();
    await page.locator("iframe").contentFrame().getByText(ISSUE_PROSE, { exact: true }).click();
    await showInspector(page);
    const field = page.getByTestId("markdown.text");
    await expect(field).toHaveValue(ISSUE_PROSE);
    const edited = `Updated from the ${target} preview.`;
    await field.fill(edited);
    await expect(page.getByTestId("dev-app.issue-source")).toContainText(edited);
    await expect(
      page.locator("iframe").contentFrame().getByText(edited, { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("markdown.error")).toHaveCount(0);
    const other = target === "email" ? "web" : "email";
    await page.getByTestId(`preview-bar.target.${other}`).click();
    await expect(
      page.locator("iframe").contentFrame().getByText(edited, { exact: true }),
    ).toBeVisible();
    const source = await sourceTab(page);
    await expect(source).toHaveValue(new RegExp(`^---\\ntitle: Launch notes[\\s\\S]*${edited}`));
    await expect(source).not.toHaveValue(/<Email|defineTemplate/);
  });
}

test("switching targets preserves authored source and shows the host's email differences", async ({
  page,
}) => {
  await open(page);
  const original = await page.locator("[data-editor-authored-source]").textContent();
  await page.getByTestId("preview-bar.target.web").click();
  await expect(page.locator("iframe").contentFrame().locator("main")).toBeVisible();
  await page.getByTestId("preview-bar.target.email").click();
  await expect(
    page.locator("iframe").contentFrame().getByText(ISSUE_PROSE, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-editor-authored-source]")).toHaveText(original!);
  await showInspector(page);
  await page.getByTestId("checks.compatibility-report").click();
  await page.getByTestId("checks.report.assessment").selectOption("degradation");
  await expect(page.getByTestId("checks.report")).toContainText("caniemail/border-radius");
  await page.getByTestId("checks.report.close").click();
  await expect(page.getByTestId("checks.email-differences.empty")).toHaveText(
    "This looks the same in email and on the web.",
  );
});
