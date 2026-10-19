/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ResizeHandle } from "../src/chrome/resize";
import { EditorProvider } from "../src/state/provider";
import { mockEditor } from "./mock-host";
import { useEditorProbe } from "./store-probe";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const ROW = { left: 100, right: 1500, width: 1400 };

function Probe() {
  const { assistantWidth, chatCollapsed, rightWidth } = useEditorProbe();
  return (
    <div data-testid="probe">{`${assistantWidth}|${chatCollapsed ? "collapsed" : "open"}|${rightWidth}`}</div>
  );
}

const mount = async (side: "assistant" | "left" | "right") => {
  const { host } = await mockEditor();
  const view = render(
    <EditorProvider host={host}>
      <div data-testid="row">
        <ResizeHandle side={side} />
      </div>
      <Probe />
    </EditorProvider>,
  );
  const row = view.getByTestId("row");
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    ...ROW,
    top: 0,
    bottom: 800,
    height: 800,
    x: ROW.left,
    y: 0,
    toJSON: () => ({}),
  });
  const handle = view.container.querySelector<HTMLElement>("[data-editor-resize]");
  if (handle === null) throw new Error("Resize handle is not mounted");
  return { handle, probe: () => view.getByTestId("probe").textContent };
};

const pointer = (clientX: number) => ({
  clientX,
  pointerId: 1,
  button: 0,
  pointerType: "mouse",
});

const drag = (handle: HTMLElement, ...xs: number[]) => {
  fireEvent.pointerDown(handle, pointer(xs[0] ?? 0));
  for (const x of xs) fireEvent.pointerMove(handle, pointer(x));
};

describe("ResizeHandle", () => {
  it("sets the chat width relative to its container", async () => {
    const { handle, probe } = await mount("assistant");
    drag(handle, 600);
    expect(probe()?.split("|")[0]).toBe("500");
    expect(handle.dataset.dragging).toBe("");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.pointerUp(handle, pointer(600));
    expect(handle.dataset.dragging).toBeUndefined();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("ignores moves when no drag is active and non-primary mouse buttons", async () => {
    const { handle, probe } = await mount("assistant");
    const before = probe();
    fireEvent.pointerMove(handle, pointer(700));
    fireEvent.pointerDown(handle, { ...pointer(700), button: 2 });
    fireEvent.pointerMove(handle, pointer(700));
    expect(probe()).toBe(before);
  });

  it("clamps the chat width to its maximum", async () => {
    const { handle, probe } = await mount("assistant");
    drag(handle, 1400);
    expect(probe()?.split("|")[0]).toBe("640");
  });

  it("collapses the chat below the threshold and keeps its width", async () => {
    const { handle, probe } = await mount("assistant");
    drag(handle, 600);
    expect(probe()).toMatch(/^500\|open/);
    fireEvent.pointerMove(handle, pointer(180));
    expect(probe()).toMatch(/^500\|collapsed/);
    fireEvent.pointerMove(handle, pointer(400));
    expect(probe()).toMatch(/^300\|open/);
  });

  it("persists the chat width", async () => {
    const { handle } = await mount("assistant");
    drag(handle, 600);
    fireEvent.pointerUp(handle, pointer(600));
    expect(localStorage.getItem("samva.editor.assistantWidth")).toBe("500");
  });

  it("measures the right panel from the container's right edge", async () => {
    const { handle, probe } = await mount("right");
    drag(handle, 1200);
    expect(probe()?.split("|")[2]).toBe("300");
  });

  it("restores the body when the pointer capture is lost", async () => {
    const { handle } = await mount("assistant");
    drag(handle, 600);
    fireEvent.lostPointerCapture(handle, pointer(600));
    expect(handle.dataset.dragging).toBeUndefined();
    expect(document.body.style.cursor).toBe("");
  });

  it("steps with the arrow keys and jumps with Home and End", async () => {
    const { handle, probe } = await mount("assistant");
    const width = () => Number(probe()?.split("|")[0]);
    const start = width();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe(start + 8);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(width()).toBe(start + 8 - 24);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(width()).toBe(280);
    fireEvent.keyDown(handle, { key: "End" });
    expect(width()).toBe(640);
  });

  it("grows the right panel with ArrowLeft", async () => {
    const { handle, probe } = await mount("right");
    const width = () => Number(probe()?.split("|")[2]);
    const start = width();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(width()).toBe(start + 8);
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(width()).toBe(start + 8 - 24);
    fireEvent.keyDown(handle, { key: "End" });
    expect(width()).toBe(440);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(width()).toBe(260);
  });

  it("leaves unhandled keys alone", async () => {
    const { handle } = await mount("assistant");
    const notCancelled = fireEvent.keyDown(handle, { key: "a" });
    expect(notCancelled).toBe(true);
    expect(fireEvent.keyDown(handle, { key: "ArrowRight" })).toBe(false);
  });

  it("describes itself as a vertical separator", async () => {
    const { handle } = await mount("assistant");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-label")).toBe("Resize chat");
    expect(handle.getAttribute("aria-valuemin")).toBe("280");
    expect(handle.getAttribute("aria-valuemax")).toBe("640");
    expect(handle.getAttribute("data-testid")).toBe("agent-column.resize");
  });
});
