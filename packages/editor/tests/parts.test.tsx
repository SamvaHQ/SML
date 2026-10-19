/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { EditorPreviewBar } from "../src/chrome/preview-bar";
import { EditorRoot, EditorStatusBar, EditorTopBar, EditorWorkspace } from "../src/chrome/shell";
import { EditorProvider } from "../src/state/provider";
import { mockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stubFrame = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 900,
    top: 0,
    right: width,
    bottom: 900,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
};

describe("chrome parts", () => {
  it("lay out in the host's order inside the root, each under its data-slot", async () => {
    stubFrame(1440);
    const view = render(
      <EditorProvider host={(await mockEditor()).host}>
        <EditorRoot>
          <EditorStatusBar />
          <EditorWorkspace />
          <EditorTopBar />
        </EditorRoot>
      </EditorProvider>,
    );
    const root = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('[data-slot="editor"]');
      if (element === null) throw new Error("no root");
      return element;
    });
    expect(root.dataset.layout).toBe("wide");
    expect([...root.children].map((child) => child.getAttribute("data-slot"))).toEqual([
      "editor-status-bar",
      "editor-workspace",
      "editor-top-bar",
    ]);
  });

  it("merge a host className over the part's own, resolved from its state", async () => {
    stubFrame(1440);
    const view = render(
      <EditorProvider host={(await mockEditor()).host}>
        <EditorRoot className={(state) => (state.layout === "wide" ? "wide-root h-10" : "narrow")}>
          <EditorTopBar className="h-16 bg-red-500" />
          <EditorWorkspace />
          <EditorStatusBar className={(state) => `save-${state.save}`} />
        </EditorRoot>
      </EditorProvider>,
    );
    const topBar = await view.findByRole("banner");
    // tailwind-merge drops the part's h-12 for the host's h-16.
    expect(topBar.className).toContain("h-16");
    expect(topBar.className).not.toContain("h-12");
    expect(topBar.dataset.slot).toBe("editor-top-bar");
    const root = view.container.querySelector<HTMLElement>('[data-slot="editor"]');
    expect(root?.className).toContain("wide-root");
    const status = view.container.querySelector<HTMLElement>('[data-slot="editor-status-bar"]');
    expect(status?.className).toContain("save-unavailable");
    expect(status?.dataset.save).toBe("unavailable");
  });

  it("render through the host's element while keeping their slot and state", async () => {
    stubFrame(1440);
    const view = render(
      <EditorProvider host={(await mockEditor()).host}>
        <EditorRoot>
          <EditorWorkspace render={<main data-testid="test.host-main" />} />
          <EditorPreviewBar render={<nav data-testid="test.host-bar" />} />
        </EditorRoot>
      </EditorProvider>,
    );
    const main = await view.findByTestId("test.host-main");
    expect(main.tagName).toBe("MAIN");
    expect(main.dataset.slot).toBe("editor-workspace");
    const bar = await view.findByTestId("test.host-bar");
    expect(bar.tagName).toBe("NAV");
    expect(bar.dataset.slot).toBe("editor-preview-bar");
    expect(bar.hasAttribute("data-busy")).toBe(false);
  });
});
