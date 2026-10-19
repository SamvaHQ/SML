import { expect, test, type Page } from "@playwright/test";

// The composable chrome parts of README "Composing the chrome", against the docked-assistant
// harness (`?demo=workspace`). The harness's left column takes 48px, so the editor frame is the
// viewport width minus 48.

const WORKSPACE = "/?demo=workspace";
const WIDE = { width: 1440, height: 900 } as const;
const STANDARD = { width: 1180, height: 820 } as const;
const PHONE = { width: 390, height: 844 } as const;

const open = async (page: Page, size: { width: number; height: number }, url = WORKSPACE) => {
  await page.setViewportSize(size);
  await page.goto(url);
  await expect(page.locator("[data-editor-rendered]")).toHaveText("true");
  await expect(page.locator("[data-slot=editor]")).toBeVisible();
};

const slot = (page: Page, name: string) => page.locator(`[data-slot=${name}]`).first();

/** Top, bottom and centre of a box, in page pixels. */
const verticals = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        centre: rect.top + rect.height / 2,
      };
    });

test("a wide frame renders every part with its data-slot and state", async ({ page }) => {
  await open(page, WIDE);
  const slots = [
    "editor",
    "editor-top-bar",
    "editor-top-bar-title",
    "editor-top-bar-name",
    "editor-top-bar-actions",
    "editor-workspace",
    "editor-assistant-dock",
    "editor-assistant-dock-header",
    "editor-assistant-dock-body",
    "editor-divider",
    "editor-work-pane",
    "editor-work-pane-header",
    "editor-work-pane-tabs",
    "editor-work-pane-tab",
    "editor-work-pane-add",
    "editor-work-pane-panel",
    "editor-canvas",
    "editor-envelope",
    "editor-preview-bar",
    "editor-version-picker",
    "editor-fixture-select",
    "editor-preview-bar-center",
    "editor-preview-bar-size",
    "editor-zoom-control",
    "editor-status-bar",
    "editor-status-bar-start",
    "editor-status-bar-end",
  ];
  for (const name of slots) {
    await expect(slot(page, name), `data-slot=${name}`).toBeVisible();
  }

  // State rides on the element as data attributes.
  await expect(slot(page, "editor")).toHaveAttribute("data-layout", "wide");
  await expect(slot(page, "editor")).toHaveAttribute("data-docked", "");
  await expect(slot(page, "editor-top-bar")).toHaveAttribute("data-layout", "wide");
  await expect(slot(page, "editor-workspace")).toHaveAttribute("data-layout", "wide");
  await expect(slot(page, "editor-status-bar")).toHaveAttribute("data-layout", "wide");
  await expect(slot(page, "editor-status-bar")).toHaveAttribute("data-save", "idle");
  await expect(slot(page, "editor-divider")).toHaveAttribute("data-side", "assistant");
  await expect(slot(page, "editor-work-pane")).toHaveAttribute("data-tab", "preview");
  await expect(slot(page, "editor-work-pane")).toHaveAttribute("data-split", "");
  await expect(slot(page, "editor-work-pane-tab")).toHaveAttribute("data-active", "");
  await expect(slot(page, "editor-zoom-control")).toHaveAttribute("data-percent", /^\d+$/);

  // The Chat | Preview switch exists only below 1280px.
  await expect(slot(page, "editor-pane-switch")).toHaveCount(0);
});

test("a standard frame shows the pane switch in the top bar", async ({ page }) => {
  await open(page, STANDARD);
  await expect(slot(page, "editor")).toHaveAttribute("data-layout", "standard");
  const pane = page.locator("[data-slot=editor-top-bar] [data-slot=editor-pane-switch]");
  await expect(pane).toBeVisible();
  await expect(pane).toHaveAttribute("data-pane", "assistant");
  await expect(slot(page, "editor-assistant-dock")).toHaveAttribute("data-focused", "");
  await expect(slot(page, "editor-divider")).toHaveCount(0);

  await page.getByTestId("agent-workspace.tab.preview").click();
  await expect(pane).toHaveAttribute("data-pane", "preview");
  await expect(slot(page, "editor-work-pane")).toBeVisible();
});

test("the layout attribute follows the frame: wide, standard, narrow", async ({ page }) => {
  for (const [size, layout] of [
    [WIDE, "wide"],
    [STANDARD, "standard"],
    [PHONE, "narrow"],
  ] as const) {
    await open(page, size);
    await expect(slot(page, "editor"), `${size.width}px`).toHaveAttribute("data-layout", layout);
  }
});

test("the phone top bar is one 48px row and nothing wraps out of it", async ({ page }) => {
  await open(page, PHONE);
  const bar = await verticals(page, "[data-slot=editor-top-bar]");
  expect(bar.height).toBe(48);

  const escaped = await page.locator("[data-slot=editor-top-bar]").evaluate((header) => {
    const box = header.getBoundingClientRect();
    return [...header.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      const inside =
        rect.top >= box.top - 0.5 &&
        rect.bottom <= box.bottom + 0.5 &&
        rect.left >= box.left - 0.5 &&
        rect.right <= box.right + 0.5;
      return inside
        ? []
        : [`${element.getAttribute("data-testid") ?? element.getAttribute("data-slot")}`];
    });
  });
  expect(escaped).toEqual([]);

  // The switch is icons only, named for assistive tech; the folded actions live in one menu.
  await expect(page.getByTestId("agent-workspace.tab.assistant")).toHaveAttribute(
    "aria-label",
    "Chat",
  );
  await expect(page.getByTestId("agent-workspace.tab.preview")).toHaveAttribute(
    "aria-label",
    "Preview",
  );
  await expect(page.getByTestId("topbar.more")).toBeVisible();
  await expect(page.getByTestId("topbar.export")).toHaveCount(0);
  await page.getByTestId("topbar.more").click();
  await expect(page.locator('[role="menuitem"][data-testid="topbar.preview"]')).toBeVisible();
});

test("on a phone the tab row steps aside for Preview alone and returns with Design", async ({
  page,
}) => {
  await open(page, PHONE);
  await page.getByTestId("agent-workspace.tab.preview").click();
  await expect(slot(page, "editor-work-pane")).toBeVisible();
  await expect(slot(page, "editor-work-pane-header")).toBeHidden();

  await page.getByTestId("preview-bar.more").click();
  await page.getByTestId("work-pane.add.design").click();
  await expect(slot(page, "editor-work-pane-header")).toBeVisible();
  await expect(page.getByTestId("work-pane.tab.design")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("design-panel")).toBeVisible();
});

test("the preview bar's controls share one height and one vertical centre", async ({ page }) => {
  await open(page, WIDE);
  const controls = {
    versions: "[data-slot=editor-version-picker]",
    devices: "[data-slot=editor-preview-bar-center] [data-slot=toggle-group]",
    fixture: "[data-slot=editor-fixture-select]",
    refresh: '[data-testid="preview-bar.refresh"]',
    open: '[data-testid="preview-bar.open"]',
  };
  const measured: Record<string, Awaited<ReturnType<typeof verticals>>> = {};
  for (const [name, selector] of Object.entries(controls)) {
    await expect(page.locator(selector).first(), name).toBeVisible();
    measured[name] = await verticals(page, selector);
  }
  const names = Object.keys(measured);
  const first = measured[names[0]!]!;
  expect(first.height).toBe(28);
  for (const name of names) {
    const box = measured[name]!;
    expect(Math.abs(box.height - first.height), `${name} height`).toBeLessThanOrEqual(1);
    expect(Math.abs(box.centre - first.centre), `${name} centre`).toBeLessThanOrEqual(1);
  }

  // Zoom is a popover-paper group of 28px buttons.
  const zoom = await page.locator("[data-slot=editor-zoom-control]").evaluate((group) => ({
    background: getComputedStyle(group).backgroundColor,
    buttons: [...group.querySelectorAll<HTMLElement>("button")].map(
      (button) => button.getBoundingClientRect().height,
    ),
  }));
  expect(zoom.buttons.length).toBeGreaterThan(0);
  expect(zoom.buttons.every((height) => height === 28)).toBe(true);
  const popover = await page.locator("[data-slot=editor-zoom-control]").evaluate((group) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--popover)";
    group.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  });
  expect(zoom.background).toBe(popover);
});

test("a docked chat's status bar half is exactly as wide as the chat", async ({ page }) => {
  await open(page, WIDE);
  const widthOf = async (name: string) => (await slot(page, name).boundingBox())!.width;
  expect(
    Math.abs((await widthOf("editor-status-bar-start")) - (await widthOf("editor-assistant-dock"))),
  ).toBeLessThanOrEqual(1);

  // It keeps following the chat as the divider moves.
  const divider = page.getByTestId("agent-column.resize");
  await divider.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () =>
      Math.abs(
        (await widthOf("editor-status-bar-start")) - (await widthOf("editor-assistant-dock")),
      ),
    )
    .toBeLessThanOrEqual(1);
  expect(await widthOf("editor-assistant-dock")).toBeGreaterThan(420);
});

test("no status text is clipped on a phone", async ({ page }) => {
  await open(page, PHONE);
  const clipped = await page.locator("[data-slot=editor-status-bar]").evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    return [...bar.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
      const hasText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      if (!hasText) return [];
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("data-testid") ?? element.tagName;
      const problems: string[] = [];
      if (element.scrollWidth > element.clientWidth) problems.push(`${label} scrolls`);
      if (rect.right > box.right + 0.5 || rect.left < box.left - 0.5)
        problems.push(`${label} leaves the bar`);
      return problems;
    });
  });
  expect(clipped).toEqual([]);
  await expect(page.getByTestId("statusbar.save-version")).toBeVisible();
});

test("a busy host adds the preview bar's progress part", async ({ page }) => {
  await open(page, WIDE, `${WORKSPACE}&busy=1`);
  await expect(slot(page, "editor-preview-bar")).toHaveAttribute("data-busy", "");
  await expect(slot(page, "editor-preview-bar-progress")).toBeVisible();
});

test("a broken edit adds the preview notice part", async ({ page }) => {
  await open(page, WIDE, `${WORKSPACE}&dev=1`);
  await page.getByTestId("dev-app.stale-preview").click();
  await expect(slot(page, "editor-preview-notice")).toBeVisible();
});

test("a standalone editor shows its Visual | Source switch as a part", async ({ page }) => {
  await open(page, WIDE, "/");
  await expect(slot(page, "editor-workspace-view")).toBeVisible();
  await expect(slot(page, "editor-assistant-dock")).toHaveCount(0);
  await expect(slot(page, "editor")).not.toHaveAttribute("data-docked");
});
