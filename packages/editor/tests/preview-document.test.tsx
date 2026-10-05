/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";

import { EmailFrame } from "../src/canvas/email-frame";
import { EditorProvider, type PreparedPreviewDocument } from "../src/shell";
import { mockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HTML =
  "<html><head><style>@media (prefers-color-scheme: dark){body{color:red}}</style></head><body><p>Original</p></body></html>";

describe("preview document preparation", () => {
  it("writes prepared HTML and mounts before the first frame measurement", async () => {
    const { host } = await mockEditor();
    const measured: string[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.tagName === "BODY") measured.push(this.dataset.mounted ?? "missing");
      return new DOMRect(0, 0, 600, 123);
    });
    const prepare = vi.fn((html: string): PreparedPreviewDocument => ({
      html: html.replace("Original", "Prepared"),
      mount: (document) => {
        expect(document.body.textContent).toBe("Prepared");
        document.body.dataset.mounted = "yes";
        return () => delete document.body.dataset.mounted;
      },
    }));
    const view = render(
      <EditorProvider host={host} preparePreviewDocument={prepare}>
        <EmailFrame html={HTML} width={600} />
      </EditorProvider>,
    );
    expect(prepare).toHaveBeenCalledWith(HTML);
    expect(measured).toEqual(["yes"]);
    expect(view.container.querySelector("iframe")?.style.height).toBe("123px");
  });

  it("replaces resources for callback identity and original HTML even if preparation is identical", async () => {
    const { host } = await mockEditor();
    const mounted: Document[] = [];
    const cleaned: Document[] = [];
    const prepare = (_html: string): PreparedPreviewDocument => ({
      html: "<html><body>Same prepared output</body></html>",
      mount: (document) => {
        mounted.push(document);
        return () => {
          cleaned.push(document);
        };
      },
    });
    const tree = (html: string, preparation = prepare, width = 600) => (
      <EditorProvider host={host} preparePreviewDocument={preparation}>
        <EmailFrame html={html} width={width} overlay={<span data-overlay="" />} />
      </EditorProvider>
    );
    const view = render(tree(HTML));
    const firstFrame = view.container.querySelector("iframe");
    view.rerender(tree(HTML, prepare, 320));
    expect(view.container.querySelector("iframe")).toBe(firstFrame);
    expect(mounted).toHaveLength(1);
    view.rerender(tree(`${HTML}<!-- another revision -->`));
    expect(cleaned).toEqual([mounted[0]]);
    expect(mounted[1]).not.toBe(mounted[0]);
    view.rerender(tree(`${HTML}<!-- another revision -->`, (html) => prepare(html)));
    expect(cleaned).toEqual(mounted.slice(0, 2));
    expect(mounted[2]?.querySelector("[data-overlay]")).not.toBeNull();
    view.unmount();
    expect(cleaned).toEqual(mounted);
  });

  it("balances StrictMode replay and omission restores default HTML", async () => {
    const { host } = await mockEditor();
    const live = new Set<Document>();
    const mounts = vi.fn((document: Document) => {
      expect(live.has(document)).toBe(false);
      live.add(document);
      return () => {
        expect(live.delete(document)).toBe(true);
      };
    });
    const prepare = (_html: string): PreparedPreviewDocument => ({
      html: "<html><body>Prepared</body></html>",
      mount: mounts,
    });
    const tree = (preparation?: typeof prepare) => (
      <StrictMode>
        <EditorProvider host={host} preparePreviewDocument={preparation}>
          <EmailFrame html={HTML} width={600} />
        </EditorProvider>
      </StrictMode>
    );
    const view = render(tree(prepare));
    expect(mounts.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(live.size).toBe(1);
    view.rerender(tree());
    expect(live.size).toBe(0);
    expect(view.container.querySelector("iframe")?.contentDocument?.body.textContent).toBe(
      "Original",
    );
    view.unmount();
    expect(live.size).toBe(0);
  });

  it("prepares each forced scheme before parsing and cleans each scheme document", async () => {
    const { host } = await mockEditor();
    const cleaned: Document[] = [];
    const prepare = vi.fn((html: string): PreparedPreviewDocument => ({
      html,
      mount: (document) => () => {
        cleaned.push(document);
      },
    }));
    const tree = (scheme: "light" | "dark") => (
      <EditorProvider host={host} preparePreviewDocument={prepare}>
        <EmailFrame html={HTML} forceColorScheme={scheme} width={600} />
      </EditorProvider>
    );
    const view = render(tree("light"));
    const light = view.container.querySelector("iframe")!.contentDocument!;
    expect(light.head.textContent).toContain("@media not all");
    view.rerender(tree("dark"));
    const dark = view.container.querySelector("iframe")!.contentDocument!;
    expect(dark.head.textContent).toContain("@media all");
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0]?.[0]).toContain("@media not all");
    expect(prepare.mock.calls[1]?.[0]).toContain("@media all");
    expect(cleaned).toEqual([light]);
    view.unmount();
    expect(cleaned).toEqual([light, dark]);
  });
});
