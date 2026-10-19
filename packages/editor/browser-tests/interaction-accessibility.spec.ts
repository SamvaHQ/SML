import { expect, test } from "@playwright/test";

const PREVIEW_TOOLTIP = "Preview template";

const open = async (page: import("@playwright/test").Page, url = "/") => {
  await page.goto(url);
  await expect(page.locator("[data-editor-harness-ready]")).toBeAttached();
};

/** The computed value of a CSS value expression (`var(--primary)`) as the shell resolves it. */
const resolveIn = (shell: import("@playwright/test").Locator, property: string, value: string) =>
  shell.evaluate(
    (element, [prop, expression]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(prop!, expression!);
      element.append(probe);
      const resolved = getComputedStyle(probe).getPropertyValue(prop!);
      probe.remove();
      return resolved;
    },
    [property, value] as const,
  );

test("icon-only editor actions expose the same help to keyboard focus", async ({ page }) => {
  await open(page);
  const preview = page.getByTestId("topbar.preview");

  await preview.focus();

  await expect(page.getByRole("tooltip")).toHaveText(PREVIEW_TOOLTIP);
  await expect(preview).not.toHaveAttribute("title");
});

test("preview controls remain reachable in a narrow reduced-motion viewport", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  // A phone-width control keeps its designed 28px box and gains an invisible 44px hit area.
  const more = page.getByTestId("topbar.more");
  expect((await more.boundingBox())?.height).toBe(28);
  const hitArea = await more.evaluate((element) => {
    const after = getComputedStyle(element, "::after");
    return { width: Number.parseFloat(after.width), height: Number.parseFloat(after.height) };
  });
  expect(hitArea.width).toBeGreaterThanOrEqual(44);
  expect(hitArea.height).toBeGreaterThanOrEqual(44);
  // Preview template is one of the menu's rows.
  await more.click();
  await page.locator('[role="menuitem"][data-testid="topbar.preview"]').click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("preview-overlay.format-group")).toBeVisible();
  await expect(page.getByTestId("preview-overlay.width-group")).toBeVisible();
  await expect(page.getByTestId("preview-overlay.color-scheme-group")).toBeVisible();
  await expect(page.getByTestId("preview-overlay.close")).toBeInViewport();

  const duration = await page.getByTestId("preview-overlay.device-frame").evaluate((element) => {
    const first = getComputedStyle(element).transitionDuration.split(",")[0] ?? "0s";
    return first.endsWith("ms") ? Number.parseFloat(first) / 1_000 : Number.parseFloat(first);
  });
  expect(duration).toBeLessThanOrEqual(0.001);
});

for (const mode of ["light", "dark"] as const) {
  test(`editor resolves host and canvas theme values in ${mode} mode`, async ({ page }) => {
    await open(page, "/?demo=workspace");
    const shell = page.locator(".samva-editor-shell").first();
    const readTokens = () =>
      shell.evaluate((element) => {
        const styles = getComputedStyle(element);
        const colors = [
          "--primary",
          "--primary-foreground",
          "--muted",
          "--muted-foreground",
          "--border",
          "--card",
          "--card-foreground",
          "--popover",
          "--popover-foreground",
          "--accent",
          "--accent-foreground",
          "--input",
          "--ring",
          "--status-info",
          "--editor-canvas-bg",
          "--editor-canvas-document-bg",
          "--editor-canvas-hover",
          "--editor-canvas-selected",
          "--editor-canvas-selected-fg",
        ];
        const shadows = ["--shadow-xs", "--shadow-sm", "--shadow-lg", "--shadow-floating"];
        return [
          ...colors.map((token) => ({ token, property: "color" })),
          ...shadows.map((token) => ({ token, property: "box-shadow" })),
        ].map(({ token, property }) => {
          const value = styles.getPropertyValue(token).trim();
          return { token, value, valid: CSS.supports(property, value) };
        });
      });
    const lightTokens = await readTokens();
    if (mode === "dark") await page.getByTitle("Toggle theme").click();
    const tokens = await readTokens();
    for (const { token, value, valid } of tokens) {
      // The harness gives light and dark the same focus ring colour; every other host token
      // moves with the theme.
      if (mode === "dark" && !token.startsWith("--editor-") && token !== "--ring") {
        expect(value, `${token} changes with the host theme`).not.toBe(
          lightTokens.find((entry) => entry.token === token)!.value,
        );
      }
      expect(value, `${mode} ${token} resolves through the host theme`).not.toBe("");
      expect(valid, `${mode} ${token} is usable by the browser`).toBe(true);
    }
    await expect(shell).toHaveCSS("color-scheme", mode);
    const workspace = page.locator(".samva-editor-workspace").first();
    const canvasBackground = tokens.find(({ token }) => token === "--editor-canvas-bg")!.value;
    await expect(workspace).toHaveCSS("background-color", canvasBackground);

    const scroll = page.locator(".samva-editor-scroll").first();
    await expect(scroll).toHaveCSS("color-scheme", mode);
    await expect(scroll).toHaveCSS("scrollbar-width", "thin");
    const scrollbar = await scroll.evaluate((element) => ({
      actual: getComputedStyle(element).scrollbarColor,
    }));
    const thumb = await resolveIn(shell, "color", "var(--editor-scrollbar-thumb)");
    expect(scrollbar.actual).toBe(`${thumb} rgba(0, 0, 0, 0)`);

    // The chrome is shadcn's: the primary button paints the host's `--primary`, and a ghost
    // button's hover fill is the host's `--muted` (half strength on the dark scheme).
    const primary = await resolveIn(shell, "background-color", "var(--primary)");
    const muted = await resolveIn(
      shell,
      "background-color",
      mode === "dark" ? "color-mix(in oklab, var(--muted) 50%, transparent)" : "var(--muted)",
    );
    await expect(page.getByTestId("topbar.publish")).toHaveCSS("background-color", primary);
    const ghost = page.getByTestId("topbar.preview");
    await ghost.hover();
    await expect(ghost).toHaveCSS("background-color", muted);
  });
}

test("editor floating elevation follows a host override", async ({ page }) => {
  await open(page);
  const shadow = "rgb(12, 34, 56) 0px 7px 11px 0px";
  await page.evaluate(
    (value) => document.documentElement.style.setProperty("--shadow-floating", value),
    shadow,
  );
  const resolved = await page
    .locator(".samva-editor-shell")
    .first()
    .evaluate((element) => {
      const styles = getComputedStyle(element);
      const probe = document.createElement("div");
      probe.style.boxShadow = "var(--editor-shadow-floating)";
      element.append(probe);
      const computedShadow = getComputedStyle(probe).boxShadow;
      probe.remove();
      return { host: styles.getPropertyValue("--shadow-floating").trim(), shadow: computedShadow };
    });
  expect(resolved.host).toBe(shadow);
  expect(resolved.shadow).toBe(shadow);
});

test("reduced motion suppresses animation while preserving editor interaction", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const preview = page.getByTestId("topbar.preview");
  const motion = await preview.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      transition: Number.parseFloat(styles.transitionDuration),
      animation: Number.parseFloat(styles.animationDuration),
      iterations: styles.animationIterationCount,
      scroll: styles.scrollBehavior,
    };
  });
  expect(motion).toEqual({
    transition: 0.00001,
    animation: 0.00001,
    iterations: "1",
    scroll: "auto",
  });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("preview-overlay.close").click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(preview).toBeVisible();
});
