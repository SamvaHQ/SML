import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { samvaEditor } from "@samva/vite";
import { createServer, type ViteDevServer } from "vite";

import { SOURCE, COPY } from "./source-editing-fixture";

/** Pointer coordinates include the canvas fit transform around the iframe. */
const clickRendered = async (page: Page, target: Locator) => {
  const rect = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const frame = page.locator("iframe");
  const box = await frame.boundingBox();
  const width = await frame.evaluate((element) => element.clientWidth);
  const scale = box!.width / width;
  await page.mouse.click(
    box!.x + (rect.x + rect.width / 2) * scale,
    box!.y + (rect.y + rect.height / 2) * scale,
  );
};

let root: string;
let origin: string;
let server: ViteDevServer;
let http: Server;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "samva-visual-proof-"));
  await mkdir(join(root, "templates"));
  await writeFile(join(root, "templates/visual-proof.tsx"), SOURCE);
  server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    plugins: [samvaEditor()],
  });
  http = createHttpServer(server.middlewares);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await server?.close();
  http?.closeAllConnections();
  await new Promise<void>((resolve) => http?.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

test("local host preserves source intent through visual edits, undo, fixtures and reopen", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.goto(origin);
  await page.getByTestId("template-card.templates/visual-proof.tsx").click();
  const frame = page.locator("iframe").contentFrame();
  await expect(frame.getByText(COPY.heading)).toBeVisible();
  await frame.getByText(COPY.heading).click();
  const show = page.getByTestId("shell.show-right");
  if (await show.isVisible()) await show.click();
  await page.getByTestId("source.property.children.literal").fill("Changed heading");
  await page.getByTestId("source.property.children.apply").click();
  await expect(frame.getByText(COPY.changedHeading)).toBeVisible();
  await expect
    .poll(() => readFile(join(root, "templates/visual-proof.tsx"), "utf8"))
    .toContain("<h1>Changed heading</h1>");
  await page.getByTestId("source.undo").click();
  await expect(frame.getByText(COPY.heading)).toBeVisible();
  await page.getByTestId("source.redo").click();
  await expect(frame.getByText(COPY.changedHeading)).toBeVisible();

  await page.getByTestId("topbar.fixture").selectOption("second");
  await expect(frame.getByText(COPY.grace, { exact: true })).toBeVisible();
  await page.getByTestId("inspector.document").click();
  await page.getByTestId("source.fixture-data").fill('{ name: "Lin" }');
  await page.getByTestId("source.fixture-review").click();
  await page.getByTestId("source.fixture-apply").click();
  await expect(frame.getByText(COPY.lin, { exact: true })).toBeVisible();
  await page.getByTestId("topbar.fixture").selectOption("first");
  await expect(frame.getByText(COPY.ada, { exact: true })).toBeVisible();
  await clickRendered(page, frame.getByText(COPY.movable));
  await page.getByTestId("source.structure-toggle").click();
  await page.getByTestId("source.insert").fill("<span>Added text</span>");
  await page.getByTestId("source.review-insert").click();
  await page.getByTestId("source.apply-structure").click();
  await expect(frame.getByText(COPY.added, { exact: true })).toBeVisible();
  await page.getByTestId("source.undo").click();
  await expect(frame.getByText(COPY.added, { exact: true })).toHaveCount(0);
  await clickRendered(page, frame.getByText(COPY.movable));
  await page.getByTestId("source.structure-toggle").click();
  await page.getByTestId("source.review-delete").click();
  await page.getByTestId("source.apply-structure").click();
  await expect(frame.getByText(COPY.movable, { exact: true })).toHaveCount(0);
  await page.getByTestId("source.undo").click();
  await expect(frame.getByText(COPY.movable, { exact: true })).toBeVisible();
  await clickRendered(page, frame.getByText(COPY.movable));
  await page.getByTestId("source.structure-toggle").click();
  const destination = await frame
    .getByText(COPY.destination, { exact: true })
    .getAttribute("data-samva-instance");
  await page.getByTestId("source.destination").selectOption(destination!);
  await page.getByTestId("source.review-move").click();
  await page.getByTestId("source.apply-structure").click();
  await expect
    .poll(() => readFile(join(root, "templates/visual-proof.tsx"), "utf8"))
    .toContain("Destination<p>Movable block</p>");
  await page.getByTestId("source.undo").click();
  await expect
    .poll(() => readFile(join(root, "templates/visual-proof.tsx"), "utf8"))
    .toContain("<div><p>Movable block</p></div>");
  await page.reload();
  await page.getByTestId("template-card.templates/visual-proof.tsx").click();
  await expect(frame.getByText(COPY.changedHeading)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await clickRendered(page, frame.getByText(COPY.changedHeading));
  if (await show.isVisible()) await show.click();
  await expect(page.getByTestId("source.property.children.literal")).toBeVisible();
  await expect
    .poll(async () => (await page.getByTestId("inspector").boundingBox())?.width ?? 0)
    .toBeGreaterThan(260);
  await page.getByTestId("source.property.children.literal").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("source-properties-mobile.png"), fullPage: true });
});

test("groups fixture diagnostics and persists a one-click fix through undo and reopen", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const path = join(root, "templates/visual-proof.tsx");
  await writeFile(
    path,
    SOURCE.replace(
      '<a href="https://example.com">',
      '<a href="https://example.com" target="_self">',
    ),
  );
  await page.goto(origin);
  await page.getByTestId("template-card.templates/visual-proof.tsx").click();
  const frame = page.locator("iframe").contentFrame();
  await expect(frame.getByText(COPY.heading)).toBeVisible();
  const show = page.getByTestId("shell.show-right");
  if (await show.isVisible()) await show.click();
  const targetCheck = page.getByTestId("check.compat:caniemail/target-attribute");
  await expect(targetCheck).toHaveCount(1);
  await targetCheck.locator("summary").click();
  await expect(targetCheck).toContainText("Fixtures: first, second");
  await expect(targetCheck).toContainText("caniemail@2.0.2");
  const badge = page.getByTestId("statusbar.checks-trigger");
  const before = Number((await badge.textContent())?.match(/\d+/)?.[0]);
  await page.getByTestId("check.fix-target").click();
  await expect.poll(() => readFile(path, "utf8")).toContain('target="_blank"');
  await expect(frame.locator("a")).toHaveAttribute("target", "_blank");
  if (before === 1) await expect(badge).toContainText("No known risks");
  else await expect(badge).toHaveText(`${before - 1} warning${before - 1 === 1 ? "" : "s"}`);
  await page.getByTestId("source.undo").click();
  await expect.poll(() => readFile(path, "utf8")).toContain('target="_self"');
  await expect(frame.locator("a")).toHaveAttribute("target", "_self");
  await page.getByTestId("source.redo").click();
  await expect.poll(() => readFile(path, "utf8")).toContain('target="_blank"');
  await page.reload();
  await page.getByTestId("template-card.templates/visual-proof.tsx").click();
  await expect(frame.locator("a")).toHaveAttribute("target", "_blank");
  if (await show.isVisible()) await show.click();
  await page.getByTestId("checks.compatibility-report").click();
  await page.getByTestId("checks.report.assessment").selectOption("not-applicable");
  await targetCheck.locator("summary").click();
  await expect(targetCheck).toContainText("matching the client's enforced behavior");
  await expect(page.getByTestId("checks.report")).toContainText("Client verification remains");
  const clientFilter = page.getByTestId("checks.report.client");
  const client =
    (await clientFilter.locator("option").nth(1).getAttribute("value")) ??
    (await clientFilter.locator("option").nth(1).textContent());
  await clientFilter.selectOption(client!);
  await expect(clientFilter).toHaveValue(client!);
  await expect(page.getByTestId("checks.report")).toContainText(client!);
  await expect(page.getByTestId("check.fix-target")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("diagnostic-fix-persisted.png"), fullPage: true });
});
