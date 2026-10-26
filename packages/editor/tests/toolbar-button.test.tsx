/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";

import { EditorShell } from "../src/chrome/shell";
import { EditorToolbarButton } from "../src/shell";
import { EditorProvider } from "../src/state/provider";
import { Popover, PopoverContent, PopoverTrigger } from "../src/ui/popover";
import { mockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Every element measures as a frame of `width`, so the shell resolves that layout on mount. */
const stubFrame = (width: number) =>
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

const mountShell = async (width: number) => {
  stubFrame(width);
  const editor = await mockEditor();
  const ref = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  const view = render(
    <EditorProvider host={editor.host}>
      <EditorShell
        contributions={[
          {
            slot: "toolbar.actions",
            id: "history",
            render: () => (
              <EditorToolbarButton
                ref={ref}
                data-testid="test.history"
                icon={<svg data-testid="test.history.icon" />}
                label="History"
                onClick={onClick}
              />
            ),
          },
        ]}
      />
    </EditorProvider>,
  );
  await waitFor(() => expect(view.getByTestId("topbar.preview")).toBeTruthy());
  return { view, ref, onClick };
};

describe("EditorToolbarButton", () => {
  it("matches the Preview button and shows its label while the bar is wide", async () => {
    const { view, ref, onClick } = await mountShell(1440);
    const button = view.getByTestId("test.history");
    const preview = view.getByTestId("topbar.preview");
    expect(button.textContent).toBe("History");
    expect(button.className).toBe(preview.className);
    expect(button.getAttribute("data-slot")).toBe(preview.getAttribute("data-slot"));
    expect(button.getAttribute("data-editor-control")).toBe("");
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("folds to an icon with the same label once the bar folds Preview", async () => {
    const { view } = await mountShell(1100);
    const button = view.getByTestId("test.history");
    const preview = view.getByTestId("topbar.preview");
    expect(preview.textContent).toBe("");
    expect(button.textContent).toBe("");
    expect(view.getByTestId("test.history.icon")).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("History");
    expect(button.className).toBe(preview.className);
  });

  it("serves as a popover trigger", async () => {
    stubFrame(1440);
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <Popover>
          <PopoverTrigger
            render={<EditorToolbarButton data-testid="test.trigger" icon={<svg />} label="Notes" />}
          />
          <PopoverContent data-testid="test.panel">Panel</PopoverContent>
        </Popover>
      </EditorProvider>,
    );
    const trigger = view.getByTestId("test.trigger");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(trigger);
    expect(await view.findByTestId("test.panel")).toBeTruthy();
  });
});
