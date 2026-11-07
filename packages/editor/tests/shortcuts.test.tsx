/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import { EmailFrame } from "../src/canvas/email-frame";
import { EditorShell } from "../src/chrome/shell";
import { EditorProvider } from "../src/state/provider";
import { mockEditor, withVersions } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// happy-dom reports a Linux user agent, so `mod` is Ctrl here.
const chord = (code: string, key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", {
    code,
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });

describe("zoom chords inside the canvas frame", () => {
  const frameDocument = (view: ReturnType<typeof render>) =>
    view.container.querySelector("iframe")!.contentDocument!;

  it("reach the canvas from the email's own document, main row and keypad", async () => {
    const onZoomGesture = vi.fn();
    const view = render(<EmailFrame html="<p>Hi</p>" width={600} onZoomGesture={onZoomGesture} />);
    const doc = frameDocument(view);
    await waitFor(() => {
      const event = chord("Equal", "=");
      doc.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
    const rest = [
      chord("Equal", "+", { shiftKey: true }),
      chord("NumpadAdd", "+"),
      chord("Minus", "-"),
      chord("Minus", "_", { shiftKey: true }),
      chord("NumpadSubtract", "-"),
      chord("Digit0", "0"),
    ];
    for (const event of rest) doc.body.dispatchEvent(event);
    const plain = chord("Equal", "=", { ctrlKey: false });
    doc.body.dispatchEvent(plain);

    expect(rest.map((event) => event.defaultPrevented)).toEqual(rest.map(() => true));
    expect(plain.defaultPrevented).toBe(false);
    expect(onZoomGesture.mock.calls.map(([gesture]) => gesture.direction)).toEqual([
      "in",
      "in",
      "in",
      "out",
      "out",
      "out",
      "reset",
    ]);
  });

  it("calls the handler the frame was last rendered with", async () => {
    const view = render(<EmailFrame html="<p>Hi</p>" width={600} />);
    const doc = frameDocument(view);
    const onZoomGesture = vi.fn();
    view.rerender(<EmailFrame html="<p>Hi</p>" width={600} onZoomGesture={onZoomGesture} />);
    await waitFor(() => {
      doc.body.dispatchEvent(chord("Digit0", "0"));
      expect(onZoomGesture).toHaveBeenCalledWith({ kind: "key", direction: "reset" });
    });
    const replaced = vi.fn();
    view.rerender(<EmailFrame html="<p>Hi</p>" width={600} onZoomGesture={replaced} />);
    doc.body.dispatchEvent(chord("Digit0", "0"));
    expect(replaced).toHaveBeenCalledTimes(1);
    expect(onZoomGesture).toHaveBeenCalledTimes(1);
  });
});

describe("save version shortcut", () => {
  it("saves a version from inside the editor and not from outside it", async () => {
    const save = vi.fn(async (revision: string) => `${revision}_saved`);
    const view = render(
      <EditorProvider host={withVersions((await mockEditor()).host, save)}>
        <EditorShell />
      </EditorProvider>,
    );
    await view.findByTestId("topbar.name");
    const control = view.container.querySelector<HTMLButtonElement>("button:not(:disabled)")!;
    control.focus();

    const outside = chord("KeyS", "s");
    act(() => {
      document.body.dispatchEvent(outside);
    });
    expect(outside.defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();

    const inside = chord("KeyS", "s");
    act(() => {
      control.dispatchEvent(inside);
    });
    expect(inside.defaultPrevented).toBe(true);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
