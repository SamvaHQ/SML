import { expect, test, type Page } from "@playwright/test";

// The docked-assistant workspace: chat beside a tabbed work pane from 1280px of frame width,
// a Chat | Preview switch below it. `?demo=workspace` is the harness's stand-in for the dashboard.

const WORKSPACE = "/?demo=workspace";
const WIDE = { width: 1440, height: 900 } as const;
const FOCUSED = { width: 1180, height: 820 } as const;
const PHONE = { width: 390, height: 844 } as const;

const open = async (page: Page, size: { width: number; height: number }, url = WORKSPACE) => {
  await page.setViewportSize(size);
  await page.goto(url);
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.getByTestId("work-pane")).toBeAttached();
};

/**
 * Adds a view from the tab row's "+" menu. On a phone, while Preview is the only tab, the row is
 * hidden and the preview bar's menu offers the same rows.
 */
const addTab = async (page: Page, tab: string) => {
  const row = page.locator("[data-slot=editor-work-pane-header]");
  await (
    (await row.isVisible())
      ? page.getByTestId("work-pane.add")
      : page.getByTestId("preview-bar.more")
  ).click();
  await page.getByTestId(`work-pane.add.${tab}`).click();
  await expect(page.getByTestId(`work-pane.tab.${tab}`)).toHaveAttribute("aria-selected", "true");
};

const closeOpacity = (page: Page, tab: string) =>
  page
    .getByTestId(`work-pane.close.${tab}`)
    .evaluate((element) => Number(getComputedStyle(element).opacity));

/** The tab triggers in DOM order, by the id each carries. */
const tabOrder = (page: Page) =>
  page
    .locator('[data-testid^="work-pane.tab."]')
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute("data-testid")!.replace("work-pane.tab.", "")),
    );

test("a wide frame splits chat and a work pane that starts on Preview only", async ({ page }) => {
  await open(page, WIDE);
  await expect(page.locator("[data-agent-workspace-layout]")).toHaveAttribute(
    "data-agent-workspace-layout",
    "split",
  );
  await expect(page.getByTestId("agent-column")).toBeVisible();
  expect(await tabOrder(page)).toEqual(["preview"]);
  await expect(page.getByTestId("work-pane.tab.preview")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("work-pane.panel.preview")).toBeVisible();
});

test("tabs added from + open in menu order and closing returns to the tab on the left", async ({
  page,
}) => {
  await open(page, WIDE);
  // Design first, then Source: the bar still lists them in the menu's order.
  await addTab(page, "design");
  await addTab(page, "source");
  expect(await tabOrder(page)).toEqual(["preview", "source", "design"]);

  await expect(page.getByTestId("source-workspace.authored-tsx")).toBeVisible();
  await expect(page.getByTestId("source-workspace.authored-tsx")).toContainText("export default");

  await page.getByTestId("work-pane.tab.design").click();
  await expect(page.getByTestId("design-panel")).toBeVisible();

  // Closing the active Design tab lands on Source, its neighbour on the left.
  await page.getByTestId("work-pane.close.design").click();
  await expect(page.getByTestId("work-pane.tab.source")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("work-pane.close.source").click();
  await expect(page.getByTestId("work-pane.tab.preview")).toHaveAttribute("aria-selected", "true");
  expect(await tabOrder(page)).toEqual(["preview"]);
  await expect(page.getByTestId("work-pane.panel.preview")).toBeVisible();
});

test("open tabs and the active tab survive a reload", async ({ page }) => {
  await open(page, WIDE);
  await addTab(page, "source");
  await addTab(page, "design");
  await page.reload();
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  expect(await tabOrder(page)).toEqual(["preview", "source", "design"]);
  await expect(page.getByTestId("work-pane.tab.design")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-panel")).toBeVisible();
});

test("an inactive tab's close control shows on row hover and on keyboard focus", async ({
  page,
}) => {
  await open(page, WIDE);
  await addTab(page, "source");
  await addTab(page, "design");
  // Source is the inactive added tab; park the pointer away from the tab bar.
  await page.mouse.move(700, 600);
  await expect.poll(() => closeOpacity(page, "source")).toBe(0);

  await page.getByTestId("work-pane.tab.source").hover();
  await expect.poll(() => closeOpacity(page, "source")).toBe(1);

  await page.mouse.move(700, 600);
  await expect.poll(() => closeOpacity(page, "source")).toBe(0);

  // Arrow keys move focus along the tab list; reaching Source reveals its close control.
  await page.getByTestId("work-pane.tab.preview").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("work-pane.tab.source")).toBeFocused();
  await expect.poll(() => closeOpacity(page, "source")).toBe(1);
  // The shown tab keeps its own × in view whatever has focus.
  expect(await closeOpacity(page, "design")).toBe(1);
});

test("a touch screen always shows the close control", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL!,
    hasTouch: true,
    isMobile: true,
    viewport: PHONE,
  });
  try {
    const page = await context.newPage();
    await page.goto(WORKSPACE);
    await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
    await page.getByTestId("agent-workspace.tab.preview").click();
    await addTab(page, "source");
    await addTab(page, "checks");
    await page.getByTestId("work-pane.tab.preview").click();
    await expect(page.getByTestId("work-pane.close.source")).toBeVisible();
    await expect.poll(() => closeOpacity(page, "source")).toBe(1);
    await expect.poll(() => closeOpacity(page, "checks")).toBe(1);

    // Tabs keep their glyphs whole, and a close target sits beside its tab, never over it.
    const layout = await page.evaluate(() => {
      const box = (id: string) =>
        document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      const preview = box("work-pane.tab.preview");
      const glyph = document
        .querySelector('[data-testid="work-pane.tab.preview"] svg')!
        .getBoundingClientRect();
      return {
        previewClipped: glyph.left < preview.left || glyph.right > preview.right,
        sourceRight: box("work-pane.tab.source").right,
        closeLeft: box("work-pane.close.source").left,
      };
    });
    expect(layout.previewClipped).toBe(false);
    expect(layout.closeLeft).toBeGreaterThanOrEqual(layout.sourceRight - 0.5);
  } finally {
    await context.close();
  }
});

test("collapsing the chat gives the work pane the whole frame and Show chat restores it", async ({
  page,
}) => {
  await open(page, WIDE);
  const toggle = page.getByTestId("work-pane.toggle-chat");
  await expect(toggle).toHaveAttribute("aria-label", "Collapse chat");
  const frame = page.locator("[data-agent-workspace-layout]");
  const frameBox = (await frame.boundingBox())!;
  const paneBox = async () => (await page.getByTestId("work-pane").boundingBox())!;
  expect((await paneBox()).width).toBeLessThan(frameBox.width - 280);

  await toggle.click();
  await expect(page.getByTestId("agent-column")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-label", "Show chat");
  const collapsed = await paneBox();
  expect(collapsed.width).toBeCloseTo(frameBox.width, 0);
  expect(collapsed.x).toBeCloseTo(frameBox.x, 0);

  await toggle.click();
  await expect(page.getByTestId("agent-column")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-label", "Collapse chat");
  expect((await paneBox()).width).toBeLessThan(frameBox.width - 280);
});

test("below 1280px the layout is focused and a finished turn dots the Preview switch", async ({
  page,
}) => {
  await open(page, FOCUSED, `${WORKSPACE}&dev=1`);
  await expect(page.locator("[data-agent-workspace-layout]")).toHaveAttribute(
    "data-agent-workspace-layout",
    "focused",
  );
  // Below 1280px the Chat | Preview switch lives in the top bar.
  await expect(
    page.locator("[data-slot=editor-top-bar] [data-slot=editor-pane-switch]"),
  ).toBeVisible();
  await expect(page.getByTestId("agent-workspace.tab.assistant")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("agent-column")).toBeVisible();
  await expect(page.getByTestId("work-pane")).toBeHidden();
  await expect(page.getByTestId("work-pane.toggle-chat")).toHaveCount(0);
  await expect(page.getByTestId("agent-workspace.preview-updated")).toHaveCount(0);

  await page.getByTestId("dev-app.simulate-turn").click();
  await expect(page.getByTestId("agent-workspace.preview-updated")).toBeVisible({
    timeout: 10_000,
  });

  await page.getByTestId("agent-workspace.tab.preview").click();
  await expect(page.getByTestId("work-pane")).toBeVisible();
  await expect(page.getByTestId("agent-workspace.preview-updated")).toHaveCount(0);
});

test("on a phone every visible editor control has a 44px hit area and Design is reachable", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL!,
    hasTouch: true,
    isMobile: true,
    viewport: PHONE,
  });
  try {
    const page = await context.newPage();
    await page.goto(`${WORKSPACE}&dev=1`);
    await expect(page.locator("[data-editor-rendered]")).toHaveText("true");

    // A marked control keeps the box it was designed with (never drawn 44px tall) and carries an
    // invisible hit area, at least 44x44, centred on it.
    const wanting = () =>
      page.evaluate(() => {
        const marked = [...document.querySelectorAll<HTMLElement>("[data-editor-control]")];
        const problems: string[] = [];
        let seen = 0;
        for (const element of marked) {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none";
          // A <select> draws no pseudo-element, so it has no hit area to measure.
          if (!visible || element instanceof HTMLSelectElement) continue;
          seen += 1;
          const after = getComputedStyle(element, "::after");
          const hit = {
            width: Number.parseFloat(after.width),
            height: Number.parseFloat(after.height),
          };
          const name = `${element.getAttribute("data-testid") ?? element.tagName} `;
          // A two-line menu row is naturally taller; every other control stays under 44px.
          const row = element.getAttribute("role") === "menuitem";
          if (!row && rect.height >= 44)
            problems.push(`${name}is drawn ${Math.round(rect.height)}px tall`);
          if (!(hit.width >= 44 && hit.height >= 44))
            problems.push(`${name}hit area ${hit.width}x${hit.height}`);
        }
        return { seen, problems };
      });
    const expectHitAreas = async () => {
      const { seen, problems } = await wanting();
      expect(seen).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    };

    // Chat pane.
    await expectHitAreas();

    // Preview pane: with Preview alone the tab row is gone and the bar's menu adds views.
    await page.getByTestId("agent-workspace.tab.preview").click();
    await expect(page.getByTestId("work-pane")).toBeVisible();
    await expect(page.locator("[data-slot=editor-work-pane-header]")).toBeHidden();
    await expectHitAreas();
    await page.getByTestId("preview-bar.more").click();
    await expect(page.getByTestId("work-pane.add.design")).toBeVisible();
    await expectHitAreas();
    await page.keyboard.press("Escape");

    await addTab(page, "design");
    await expect(page.getByTestId("design-panel")).toBeVisible();
    await expectHitAreas();
    await addTab(page, "source");
    await expectHitAreas();
    await addTab(page, "checks");
    await expectHitAreas();

    // The "+" menu's rows and the broken-edit notice's action are controls too.
    await page.getByTestId("work-pane.add").click();
    await expect(page.getByTestId("work-pane.add-menu")).toBeVisible();
    await expectHitAreas();
    await page.keyboard.press("Escape");
    await page.getByTestId("agent-workspace.tab.assistant").click();
    await page.getByTestId("dev-app.stale-preview").click();
    await page.getByTestId("agent-workspace.tab.preview").click();
    await page.getByTestId("work-pane.tab.preview").click();
    await expect(page.getByTestId("canvas.preview-stale.checks")).toBeVisible();
    await expectHitAreas();
  } finally {
    await context.close();
  }
});

test("growing the frame from focused to split keeps the same assistant node", async ({ page }) => {
  await open(page, FOCUSED);
  await page.getByTestId("agent-column").evaluate((element) => {
    element.setAttribute("data-identity-probe", "kept");
  });
  const demo = page.getByTestId("dev-app.demo-assistant");
  await demo.evaluate((element) => {
    element.setAttribute("data-identity-probe", "kept");
  });

  await page.setViewportSize(WIDE);
  await expect(page.locator("[data-agent-workspace-layout]")).toHaveAttribute(
    "data-agent-workspace-layout",
    "split",
  );
  await expect(page.getByTestId("agent-column")).toHaveAttribute("data-identity-probe", "kept");
  await expect(demo).toHaveAttribute("data-identity-probe", "kept");
  await expect(page.getByTestId("work-pane")).toBeVisible();
});
