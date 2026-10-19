/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { AsyncEditableEditorHost, DocumentChange } from "@samva/editor/host";
import { MOCK_FIXTURE_NAMES } from "@samva/editor/mock";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { CanvasPane } from "../src/chrome/canvas-pane";
import { PreviewChromeProvider, type PreviewChrome } from "../src/chrome/preview-context";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import type { EditorStore } from "../src/state/store";
import { emitChange, mockEditor, type MockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

let capturedStore: EditorStore | null = null;

/** Renders nothing; hands the test the store of the editor it is mounted in. */
function StoreCapture() {
  capturedStore = useEditorStoreApi();
  return null;
}

const storeOf = (): EditorStore => {
  if (capturedStore === null) throw new Error("No editor store captured");
  return capturedStore;
};

const NO_CHROME: PreviewChrome = {
  hostBusy: false,
  openInNewTab: undefined,
  showChecks: undefined,
};

/**
 * The canvas pane in a real provider over the controlled mock host. The pane sits inside a
 * themed frame, as the shell renders it, so its key listener scopes to this editor.
 */
const mount = async (
  options: {
    readonly chrome?: Partial<PreviewChrome>;
    readonly editor?: MockEditor;
    readonly host?: AsyncEditableEditorHost;
  } = {},
) => {
  const editor = options.editor ?? (await mockEditor());
  const view = render(
    <EditorProvider host={options.host ?? editor.host}>
      <StoreCapture />
      <div data-samva-editor-theme="host" data-testid="frame">
        <PreviewChromeProvider value={{ ...NO_CHROME, ...options.chrome }}>
          <CanvasPane />
        </PreviewChromeProvider>
      </div>
    </EditorProvider>,
  );
  await view.findByTestId("preview-bar");
  await waitFor(() => expect(storeOf().getState().doc).not.toBeNull());
  return { ...view, editor };
};

/** The mock host, reporting the size of the email as sent with every render it hands over. */
const withSentBytes = async (sentBytes: number) => {
  const editor = await mockEditor();
  const open = editor.host.document.open;
  const host: AsyncEditableEditorHost = {
    ...editor.host,
    document: {
      ...editor.host.document,
      open: async (onChange) => {
        const withSize = (change: DocumentChange): DocumentChange =>
          change.channel === "email" && change.render !== null
            ? { ...change, render: { ...change.render, sentBytes } }
            : change;
        const opened = await open((change) => onChange(withSize(change)));
        const initial = opened.initial;
        return {
          ...opened,
          initial:
            initial.channel === "email" && initial.render !== null
              ? { ...initial, render: { ...initial.render, sentBytes } }
              : initial,
        };
      },
    },
  };
  return { editor, host };
};

/** happy-dom's WheelEvent drops the modifier flags of its init, so the chord is set on the event. */
const wheel = (deltaY: number, modifiers: { readonly ctrlKey: boolean }): WheelEvent => {
  const event = new WheelEvent("wheel", { deltaY, cancelable: true });
  Object.defineProperties(event, {
    ctrlKey: { value: modifiers.ctrlKey },
    metaKey: { value: false },
  });
  return event;
};

const zoomOf = (view: ReturnType<typeof render>) =>
  view.container.querySelector("[data-canvas-zoom]")?.getAttribute("data-canvas-zoom");

describe("preview bar", () => {
  it("switches the preview width with the device toggle", async () => {
    const view = await mount();
    const desktop = view.getByTestId("canvas.device.desktop");
    const mobile = view.getByTestId("canvas.device.mobile");
    expect(storeOf().getState().previewDevice).toBe("desktop");
    expect(desktop.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(mobile);
    await waitFor(() => expect(storeOf().getState().previewDevice).toBe("mobile"));
    expect(mobile.getAttribute("aria-pressed")).toBe("true");
    expect(view.getByTestId("preview-bar.size").textContent).toContain("375 px");

    fireEvent.click(desktop);
    await waitFor(() => expect(storeOf().getState().previewDevice).toBe("desktop"));
    expect(view.getByTestId("preview-bar.size").textContent).toContain("600 px");
  });

  it("says the size is of the preview when the host reports no sent size", async () => {
    const view = await mount();
    expect(storeOf().getState().sizeSource).toBe("preview");
    expect(view.getByTestId("preview-bar.size").textContent).toMatch(/^600 px · \d+ KB preview$/);
  });

  it("shows only the width while there is no preview to weigh", async () => {
    const view = await mount();
    await act(() => emitChange(view.editor, { origin: "agent", broken: "not-built" }));
    await waitFor(() => expect(view.getByTestId("preview-bar.size").textContent).toBe("600 px"));
  });

  it("reads the size of the email as sent when the host reports it", async () => {
    const { editor, host } = await withSentBytes(20 * 1024);
    const view = await mount({ editor, host });
    expect(storeOf().getState().sizeSource).toBe("sent");
    expect(storeOf().getState().sizeKb).toBe(20);
    const size = view.getByTestId("preview-bar.size").textContent;
    expect(size).toBe("600 px · 20 KB");
    expect(size).not.toContain("preview");

    const clip = storeOf()
      .getState()
      .checks.find((check) => check.id === "size:gmail-clip");
    expect(clip?.detail).toContain("The email as sent is 20 KB");

    await emitChange(editor, { origin: "agent" });
    expect(storeOf().getState().sizeSource).toBe("sent");
    expect(view.getByTestId("preview-bar.size").textContent).toBe("600 px · 20 KB");
  });

  it("measures the preview HTML in the clipping check without a sent size", async () => {
    await mount();
    const clip = storeOf()
      .getState()
      .checks.find((check) => check.id === "size:gmail-clip");
    expect(clip?.detail).toContain("The preview HTML is");
  });

  it("shows progress while the host is busy and not otherwise", async () => {
    const idle = await mount({ chrome: { hostBusy: false } });
    expect(idle.queryByTestId("preview-bar.progress")).toBeNull();
    expect(idle.getByTestId("preview-bar").hasAttribute("data-busy")).toBe(false);
    idle.unmount();

    const busy = await mount({ chrome: { hostBusy: true } });
    expect(busy.getByTestId("preview-bar.progress")).toBeTruthy();
    expect(busy.getByTestId("preview-bar").hasAttribute("data-busy")).toBe(true);
  });

  it("offers Open in a new tab only when the shell provides it", async () => {
    const without = await mount();
    expect(without.queryByTestId("preview-bar.open")).toBeNull();
    without.unmount();

    const openInNewTab = vi.fn();
    const view = await mount({ chrome: { openInNewTab } });
    fireEvent.click(view.getByTestId("preview-bar.open"));
    expect(openInNewTab).toHaveBeenCalledTimes(1);
  });

  it("lists the declared fixtures and switches to another", async () => {
    const view = await mount();
    const select = view.getByTestId("preview-bar.fixture") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      ...MOCK_FIXTURE_NAMES,
    ]);
    expect(select.value).toBe(MOCK_FIXTURE_NAMES[0]);

    const other = MOCK_FIXTURE_NAMES[1];
    if (other === undefined) throw new Error("The mock declares one fixture");
    fireEvent.change(select, { target: { value: other } });
    await waitFor(() => {
      const doc = storeOf().getState().doc;
      expect(doc?.channel === "email" ? doc.fixture : null).toBe(other);
    });
  });
});

describe("zoom", () => {
  it("steps in and out between stops and returns to actual size", async () => {
    const view = await mount();
    expect(zoomOf(view)).toBe("100");

    fireEvent.click(view.getByTestId("canvas.zoom-in"));
    await waitFor(() => expect(storeOf().getState().canvasZoom).toBe(110));
    expect(view.getByTestId("canvas.zoom-value").textContent).toBe("110%");
    expect(zoomOf(view)).toBe("110");

    fireEvent.click(view.getByTestId("canvas.zoom-value"));
    await waitFor(() => expect(storeOf().getState().canvasZoom).toBe(100));
    expect(view.getByTestId("canvas.zoom-value").textContent).toBe("100%");

    fireEvent.click(view.getByTestId("canvas.zoom-out"));
    await waitFor(() => expect(storeOf().getState().canvasZoom).toBe(90));
    expect(zoomOf(view)).toBe("90");
  });

  it("fits the email to the pane", async () => {
    const view = await mount();
    const fit = view.getByTestId("canvas.zoom");
    expect(fit.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(fit);
    await waitFor(() => expect(storeOf().getState().canvasZoom).toBe("fit"));
    expect(fit.getAttribute("aria-pressed")).toBe("true");
    expect(zoomOf(view)).toBe("fit");
  });

  it("zooms with Ctrl and the wheel and refuses the page zoom", async () => {
    const view = await mount();
    const viewport = view.container.querySelector("[data-samva-canvas-viewport]");
    if (viewport === null) throw new Error("No canvas viewport");

    const zoomIn = wheel(-100, { ctrlKey: true });
    act(() => {
      viewport.dispatchEvent(zoomIn);
    });
    expect(zoomIn.defaultPrevented).toBe(true);
    const zoomedIn = storeOf().getState().canvasZoom;
    expect(zoomedIn).toBeGreaterThan(100);

    const zoomOut = wheel(100, { ctrlKey: true });
    act(() => {
      viewport.dispatchEvent(zoomOut);
    });
    expect(zoomOut.defaultPrevented).toBe(true);
    const zoomedOut = storeOf().getState().canvasZoom;
    expect(zoomedOut).toBeLessThan(Number(zoomedIn));
  });

  it("leaves a plain wheel to scroll", async () => {
    const view = await mount();
    const viewport = view.container.querySelector("[data-samva-canvas-viewport]");
    if (viewport === null) throw new Error("No canvas viewport");
    const scroll = wheel(-100, { ctrlKey: false });
    act(() => {
      viewport.dispatchEvent(scroll);
    });
    expect(scroll.defaultPrevented).toBe(false);
    expect(storeOf().getState().canvasZoom).toBe(100);
  });

  it("zooms with ⌘= typed inside the editor and ignores one typed outside it", async () => {
    const view = await mount();
    const frame = view.getByTestId("frame");
    const inside = new KeyboardEvent("keydown", {
      key: "=",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      frame.dispatchEvent(inside);
    });
    expect(inside.defaultPrevented).toBe(true);
    await waitFor(() => expect(storeOf().getState().canvasZoom).toBe(110));

    const outside = new KeyboardEvent("keydown", {
      key: "=",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(outside);
    });
    expect(outside.defaultPrevented).toBe(false);
    expect(storeOf().getState().canvasZoom).toBe(110);

    act(() => {
      frame.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", metaKey: true, bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(storeOf().getState().canvasZoom).toBe(100));
  });
});

describe("stale preview notice", () => {
  it("is absent while the preview is current", async () => {
    const view = await mount({ chrome: { showChecks: vi.fn() } });
    expect(view.queryByTestId("canvas.preview-stale")).toBeNull();
  });

  it("gives the reason without a checks button when the shell has no checks to show", async () => {
    const view = await mount();
    await act(() =>
      emitChange(view.editor, { origin: "agent", staleReason: "Unexpected token in welcome.tsx" }),
    );
    const notice = await view.findByTestId("canvas.preview-stale");
    expect(notice.textContent).toContain("Unexpected token in welcome.tsx");
    expect(view.queryByTestId("canvas.preview-stale.checks")).toBeNull();
  });

  it("opens the checks from the notice", async () => {
    const showChecks = vi.fn();
    const view = await mount({ chrome: { showChecks } });
    await act(() =>
      emitChange(view.editor, { origin: "agent", staleReason: "Unexpected token in welcome.tsx" }),
    );
    const notice = await view.findByTestId("canvas.preview-stale");
    expect(notice.textContent).toContain("Unexpected token in welcome.tsx");
    fireEvent.click(view.getByTestId("canvas.preview-stale.checks"));
    expect(showChecks).toHaveBeenCalledTimes(1);
  });
});
