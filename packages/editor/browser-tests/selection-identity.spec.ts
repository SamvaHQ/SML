import { expect, test } from "@playwright/test";

import { ROASTED_TO_ORDER } from "./fixture-copy";

// The gate for source-aware visual editing, taken in a real browser: a click on
// one of several rendered elements that share one authored element has to
// resolve to that element and to which of its instances was clicked. The mock
// host renders three cells from one authored `<Row>` inside a map, and a fourth
// through a second call site, so the four are indistinguishable by authoring and
// separable only by instance and call site.

/** The one authored cell inside `Row`, shared by every rendering of it. */
const SHARED_CELL_AUTHORING = "src/Welcome.tsx:31:5";
/** The call site the map uses. */
const LOOP_CALL_SITE = "src/Welcome.tsx:28:13";

const open = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await expect(page.locator("[data-editor-harness-ready]")).toBeAttached();
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
};

/** The inspector is what reports an identity, and it starts collapsed at this width. */
const showInspector = async (page: import("@playwright/test").Page) => {
  const show = page.getByTestId("shell.show-right");
  if (await show.isVisible()) await show.click();
};

test("a repeated cell resolves to one instance of one authored element", async ({ page }) => {
  await open(page);
  const selected = page.locator("[data-editor-selected-instance-path]");
  await expect(selected).toHaveText("");

  await page.locator("iframe").contentFrame().getByText(ROASTED_TO_ORDER).click();
  await showInspector(page);

  // The authoring is the shared cell, written once, and this element is the one
  // the author wrote rather than one a primitive generated.
  await expect(page.getByTestId("inspector.authoring.origin")).toHaveText(SHARED_CELL_AUTHORING);
  await expect(page.getByTestId("inspector.element.provenance")).toHaveText("Authored");
  await expect(page.getByTestId("inspector.element.tag")).toHaveText("td");
  // The instance is the second of the three that authoring produced here.
  await expect(page.getByTestId("inspector.authoring.occurrence")).toContainText("3 elements");
  await expect(page.getByTestId("inspector.authoring.occurrence")).toContainText("number 2");
  const secondPath = await selected.textContent();
  expect(secondPath).not.toBe("");

  // The enclosing call sites are named, innermost first, and the same authoring
  // reaches the render through a second call site as well — the difference a
  // shared-definition edit has to make visible before it applies.
  await expect(page.getByTestId("inspector.call-site.0")).toHaveText(LOOP_CALL_SITE);
  await expect(page.getByTestId("inspector.authoring.definition-scope")).toContainText(
    "4 elements",
  );

  // The other instances of this call site are reachable and are different
  // instances of the same authoring.
  const iterations = page.locator('[data-testid^="inspector.iteration."]');
  await expect(iterations).toHaveCount(3);
  await iterations.nth(2).click();
  await expect(page.getByTestId("inspector.authoring.occurrence")).toContainText("number 3");
  await expect(selected).not.toHaveText(secondPath ?? "");
  await expect(page.getByTestId("inspector.authoring.origin")).toHaveText(SHARED_CELL_AUTHORING);
});

test("switching fixture re-renders and keeps the selection honest", async ({ page }) => {
  await open(page);
  await page.locator("iframe").contentFrame().getByText(ROASTED_TO_ORDER).click();
  await showInspector(page);
  const selected = page.locator("[data-editor-selected-instance-path]");
  const before = await selected.textContent();
  expect(before).not.toBe("");

  const fixture = page.getByTestId("topbar.fixture");
  await expect(fixture).toHaveValue("welcome");
  await fixture.selectOption("returning");

  await expect(page.locator("[data-editor-fixture]")).toHaveText("returning");
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  // The same authoring renders in this fixture too, so the selection survives
  // the re-render rather than being dropped or pointed at a different element.
  await expect(selected).toHaveText(before ?? "");
  await expect(page.getByTestId("inspector.authoring.origin")).toHaveText(SHARED_CELL_AUTHORING);
  await expect(page.getByTestId("inspector.authoring.occurrence")).toContainText("number 2");
});
