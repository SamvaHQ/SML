import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    previewParser: {
      writes: string[];
      violations: string[];
      stages: Array<{ kind: string; document: number; mounted: boolean }>;
    };
  }
}

const installParserProbe = async (page: Page) => {
  await page.addInitScript(() => {
    window.previewParser = { writes: [], violations: [], stages: [] };
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentDocument",
    )!;
    const seen = new WeakSet<Document>();
    let nextId = 0;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
      ...descriptor,
      get() {
        const document: Document | null = descriptor.get!.call(this);
        if (document !== null && !seen.has(document)) {
          seen.add(document);
          const id = ++nextId;
          const write = document.write.bind(document);
          const close = document.close.bind(document);
          document.write = (...html) => {
            document.addEventListener("securitypolicyviolation", (event) => {
              window.previewParser.violations.push(event.violatedDirective);
            });
            window.previewParser.writes.push(html.join(""));
            window.previewParser.stages.push({ kind: "write", document: id, mounted: false });
            write(...html);
            const body = document.body;
            const measure = body.getBoundingClientRect.bind(body);
            body.getBoundingClientRect = () => {
              window.previewParser.stages.push({
                kind: "measure",
                document: id,
                mounted: body.dataset.preparationPolicy !== undefined,
              });
              return measure();
            };
          };
          document.close = () => {
            close();
            window.previewParser.stages.push({ kind: "close", document: id, mounted: false });
          };
        }
        return document;
      },
    });
  });
};

const settleFrames = async (page: Page) => {
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(
        document.querySelectorAll("iframe"),
        (frame) => frame.contentDocument!.fonts.ready,
      ),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
};

const openFixture = async (page: Page, prepare = true) => {
  await installParserProbe(page);
  await page.goto(`/preview-document.html${prepare ? "" : "?prepare=off"}`);
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(page.locator("iframe").contentFrame().locator("#preparation-target")).toBeVisible();
};

test("prewrite preparation prevents parser font requests and CSP events in canvas and both Preview schemes", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/preview-font")) requests.push(request.url());
  });
  await openFixture(page);
  await expect(page.locator("iframe")).toHaveJSProperty("clientHeight", 240);
  await page.getByTestId("topbar.preview").click();
  await expect(page.locator("iframe")).toHaveCount(2);
  await expect(
    page.locator("iframe").nth(1).contentFrame().locator("#preparation-target"),
  ).toHaveCSS("color", "rgb(255, 0, 0)");
  await page.getByTestId("preview-overlay.scheme.dark").click();
  await expect(
    page.locator("iframe").nth(1).contentFrame().locator("#preparation-target"),
  ).toHaveCSS("color", "rgb(0, 0, 255)");
  await page.getByTestId("preview-overlay.scheme.light").click();
  await expect(
    page.locator("iframe").nth(1).contentFrame().locator("#preparation-target"),
  ).toHaveCSS("color", "rgb(255, 0, 0)");
  await settleFrames(page);
  const evidence = await page.evaluate(() => ({
    parser: window.previewParser,
    lifecycle: window.previewLifecycle,
  }));
  expect(evidence.parser.writes.length).toBeGreaterThan(0);
  expect(evidence.parser.writes.every((html) => !html.includes("/preview-font"))).toBe(true);
  expect(requests).toEqual([]);
  expect(evidence.parser.violations).toEqual([]);
  expect(
    evidence.parser.stages
      .filter((stage) => stage.kind === "measure")
      .every((stage) => stage.mounted),
  ).toBe(true);
  for (const stage of evidence.parser.stages.filter((candidate) => candidate.kind === "measure")) {
    const stages = evidence.parser.stages.filter(
      (candidate) => candidate.document === stage.document,
    );
    expect(stages.findIndex((candidate) => candidate.kind === "close")).toBeLessThan(
      stages.indexOf(stage),
    );
  }
  expect(
    evidence.lifecycle.events
      .filter((event) => event.kind === "mount")
      .map((event) => event.scheme),
  ).toEqual(expect.arrayContaining(["auto", "light", "dark"]));
  expect(evidence.lifecycle.duplicates).toBe(0);
});

test("default parsing is a positive control for font network and CSP instrumentation", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/preview-font-import.css", (route) =>
    route.fulfill({
      contentType: "text/css",
      body: "@font-face{font-family:ImportedFont;src:url('/preview-font-imported.woff2')} h1{font-family:ImportedFont}",
    }),
  );
  page.on("request", (request) => {
    if (request.url().includes("/preview-font")) requests.push(request.url());
  });
  await openFixture(page, false);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.previewParser.violations.length))
    .toBeGreaterThan(0);
  const evidence = await page.evaluate(() => window.previewParser);
  expect(evidence.writes.some((html) => html.includes("/preview-font"))).toBe(true);
  expect(evidence.violations).toContain("font-src");
  expect(await page.evaluate(() => window.previewLifecycle.events)).toEqual([]);
});

test("StrictMode, selection overlays, revision changes, and callback identity preserve exact resource ownership", async ({
  page,
}) => {
  await openFixture(page);
  let events = await page.evaluate(() => window.previewLifecycle.events);
  expect(events.filter((event) => event.kind === "cleanup").length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.previewLifecycle.live)).toBe(1);
  await page.locator("iframe").contentFrame().locator("#preparation-target").click();
  await expect(page.locator("iframe").contentFrame().locator("[data-samva-chip]")).toBeVisible();
  const before = events.length;
  await page.getByTestId("preparation.unrelated").click();
  await settleFrames(page);
  expect(await page.evaluate(() => window.previewLifecycle.events.length)).toBe(before);
  await page.getByTestId("preparation.revision").click();
  await expect
    .poll(() => page.evaluate(() => window.previewLifecycle.events.length))
    .toBeGreaterThan(before);
  events = await page.evaluate(() => window.previewLifecycle.events);
  const revisionMount = events.findLast((event) => event.kind === "mount")!;
  await page.getByTestId("preparation.policy").click();
  await expect(page.locator("iframe").contentFrame().locator("body")).toHaveAttribute(
    "data-preparation-policy",
    "2",
  );
  events = await page.evaluate(() => window.previewLifecycle.events);
  expect(events.findLast((event) => event.kind === "mount")!.document).not.toBe(
    revisionMount.document,
  );
  expect(
    events.some((event) => event.kind === "cleanup" && event.document === revisionMount.document),
  ).toBe(true);
  await page.getByTestId("topbar.preview").click();
  await expect.poll(() => page.evaluate(() => window.previewLifecycle.live)).toBe(2);
  await page.getByTestId("preview-overlay.close").click();
  await expect.poll(() => page.evaluate(() => window.previewLifecycle.live)).toBe(1);
  await page.getByTestId("preparation.unmount").click();
  await expect(page.locator("iframe")).toHaveCount(0);
  const lifecycle = await page.evaluate(() => window.previewLifecycle);
  expect(lifecycle.live).toBe(0);
  expect(lifecycle.duplicates).toBe(0);
  expect(lifecycle.events.every((event) => event.intact)).toBe(true);
  for (const id of new Set(lifecycle.events.map((event) => event.document))) {
    const owned = lifecycle.events.filter((event) => event.document === id);
    expect(owned.filter((event) => event.kind === "mount").length).toBe(
      owned.filter((event) => event.kind === "cleanup").length,
    );
  }
});

test("removing preparation disposes resources and restores the original host HTML", async ({
  page,
}) => {
  await openFixture(page);
  await page.getByTestId("preparation.disable").click();
  await expect(
    page.locator("iframe").contentFrame().locator("style[data-test-fonts]"),
  ).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.previewLifecycle.live)).toBe(0);
  expect(
    (await page.evaluate(() => window.previewLifecycle.events)).every((event) => event.intact),
  ).toBe(true);
});
