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
  it("reach the canvas from the email's own document", async () => {
    const onZoomGesture = vi.fn();
    const view = render(<EmailFrame html="<p>Hi</p>" width={600} onZoomGesture={onZoomGesture} />);
    const doc = view.container.querySelector("iframe")!.contentDocument!;
    await waitFor(() => {
      const event = chord("Equal", "=");
      doc.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
    doc.body.dispatchEvent(chord("Minus", "-"));
    doc.body.dispatchEvent(chord("Digit0", "0"));
    const plain = chord("Equal", "=", { ctrlKey: false });
    doc.body.dispatchEvent(plain);

    expect(plain.defaultPrevented).toBe(false);
    expect(onZoomGesture.mock.calls.map(([gesture]) => gesture.direction)).toEqual([
      "in",
      "out",
      "reset",
    ]);
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
