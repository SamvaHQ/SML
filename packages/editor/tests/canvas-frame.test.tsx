/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { EmailElementSelection } from "@samva/markup/render";
import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/render";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { EmailFrame } from "../src/canvas/email-frame";
import {
  firstVisibleRect,
  isCanvasActivationTarget,
  resolveInstancePath,
} from "../src/canvas/instance-dom";
import { SelectionOverlay } from "../src/canvas/selection-overlay";
import { CanvasPane } from "../src/chrome/canvas-pane";
import { ContributionsProvider, resolveContributions } from "../src/chrome/contributions";
import { useEditorStore } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { emitChange, mockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FRAME_HTML =
  "<!doctype html><html><body>" +
  `<div ${INSTANCE_PATH_ATTRIBUTE}="0"><div ${INSTANCE_PATH_ATTRIBUTE}="0.0">` +
  `<a ${INSTANCE_PATH_ATTRIBUTE}="0.0.0" href="#claim"><span id="label">Claim</span></a>` +
  '</div></div><p id="unstamped">outside</p></body></html>';

const frameDocument = (container: HTMLElement): Document => {
  const canvas = container.querySelector("iframe")?.contentDocument ?? null;
  if (canvas === null) {
    throw new Error("email frame has no document");
  }
  return canvas;
};

const box = (width: number, height: number): DOMRect =>
  ({
    top: 10,
    left: 20,
    right: 20 + width,
    bottom: 10 + height,
    width,
    height,
    x: 20,
    y: 10,
    toJSON: () => ({}),
  }) as DOMRect;

describe("resolving a click to a rendered instance", () => {
  it("walks up to the nearest stamped ancestor, and reports null outside the document", () => {
    const view = render(<EmailFrame html={FRAME_HTML} width={600} />);
    const canvas = frameDocument(view.container);

    // A click lands on the deepest node; the instance is whatever encloses it.
    expect(resolveInstancePath(canvas.getElementById("label"))).toBe("0.0.0");
    expect(resolveInstancePath(canvas.querySelector(`[${INSTANCE_PATH_ATTRIBUTE}="0.0"]`))).toBe(
      "0.0",
    );
    expect(resolveInstancePath(canvas.getElementById("unstamped"))).toBeNull();
    expect(resolveInstancePath(null)).toBeNull();
  });

  it("recognizes the targets a click would otherwise activate", () => {
    const view = render(<EmailFrame html={FRAME_HTML} width={600} />);
    const canvas = frameDocument(view.container);
    canvas.body.insertAdjacentHTML(
      "beforeend",
      '<button id="cta">Go</button><input id="submit" type="submit"><span id="plain">text</span>',
    );

    expect(isCanvasActivationTarget(canvas.getElementById("label"))).toBe(true);
    expect(isCanvasActivationTarget(canvas.getElementById("cta"))).toBe(true);
    expect(isCanvasActivationTarget(canvas.getElementById("submit"))).toBe(true);
    expect(isCanvasActivationTarget(canvas.getElementById("plain"))).toBe(false);
    expect(isCanvasActivationTarget(null)).toBe(false);
  });

  it("selects a link instead of following it, unless the click asks for navigation", () => {
    const onSelect = vi.fn();
    const view = render(<EmailFrame html={FRAME_HTML} width={600} onSelect={onSelect} />);
    const link = frameDocument(view.container).querySelector(
      `[${INSTANCE_PATH_ATTRIBUTE}="0.0.0"]`,
    )!;

    // fireEvent returns false when a listener called preventDefault: the canvas
    // is not a live email, so an ordinary click selects instead of navigating.
    expect(fireEvent.click(link)).toBe(false);
    expect(onSelect).toHaveBeenLastCalledWith("0.0.0");

    // A modified click is a deliberate "open this link", so it is left alone.
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    expect(onSelect).toHaveBeenLastCalledWith("0.0.0");
  });

  it("reports the instance a hover is over, and null when the pointer leaves", () => {
    const onHover = vi.fn();
    const view = render(<EmailFrame html={FRAME_HTML} width={600} onHover={onHover} />);
    const canvas = frameDocument(view.container);

    fireEvent.mouseMove(canvas.querySelector(`[${INSTANCE_PATH_ATTRIBUTE}="0.0.0"]`)!);
    expect(onHover).toHaveBeenLastCalledWith("0.0.0");
    fireEvent.mouseLeave(canvas);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});

describe("firstVisibleRect", () => {
  it("prefers the twin that actually laid out, and falls back to the first match", () => {
    const root = document.createElement("div");
    root.innerHTML = `<i id="a" ${INSTANCE_PATH_ATTRIBUTE}="0.1"></i><i id="b" ${INSTANCE_PATH_ATTRIBUTE}="0.1"></i>`;
    document.body.appendChild(root);

    // A renderer can emit light/dark twins at one path; the hidden one measures 0x0.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      return this.id === "b" ? box(120, 40) : box(0, 0);
    });

    expect(firstVisibleRect(root, "0.1")).toMatchObject({ width: 120, height: 40 });

    // None laid out: the first match, deterministically, rather than nothing.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => box(0, 0));
    expect(firstVisibleRect(root, "0.1")).toMatchObject({ width: 0, height: 0 });
    expect(firstVisibleRect(root, "9.9")).toBeNull();
    root.remove();
  });
});

const selectionOf = (
  instancePath: string,
  tag: string,
  overrides: Partial<EmailElementSelection> = {},
): EmailElementSelection => ({
  instancePath,
  tag,
  origins: [{ fileName: "src/Welcome.tsx", lineNumber: 20, columnNumber: 9 }],
  authored: true,
  occurrence: 1,
  occurrences: 1,
  start: 0,
  end: 1,
  ...overrides,
});

describe("SelectionOverlay", () => {
  const withTargets = (node: React.ReactNode) =>
    render(
      <>
        <i {...{ [INSTANCE_PATH_ATTRIBUTE]: "0.0.1" }} />
        <i {...{ [INSTANCE_PATH_ATTRIBUTE]: "0.0.3" }} />
        {node}
      </>,
    );

  it("outlines the selection and names it on a chip", () => {
    const view = withTargets(
      <SelectionOverlay
        renderRevision="rev_1"
        selected={selectionOf("0.0.1", "h1", { occurrence: 2, occurrences: 3 })}
        hovered={null}
      />,
    );
    expect(view.container.querySelector("[data-samva-chip]")?.textContent).toBe("h1 2 of 3");
  });

  it("says outright when the outlined element is a compiler-generated wrapper", () => {
    const view = withTargets(
      <SelectionOverlay
        renderRevision="rev_1"
        selected={selectionOf("0.0.3", "table", { authored: false })}
        hovered={null}
      />,
    );
    expect(view.container.querySelector("[data-samva-chip]")?.textContent).toBe(
      "table · generated",
    );
  });

  it("draws nothing at all when nothing is selected or hovered", () => {
    const view = withTargets(
      <SelectionOverlay renderRevision="rev_1" selected={null} hovered={null} />,
    );
    expect(view.container.querySelector("[data-samva-chip]")).toBeNull();
    expect(view.container.querySelector("[data-samva-overlay]")?.children).toHaveLength(0);
  });
});

function SelectionReadout() {
  const selection = useEditorStore((state) => state.selection);
  return (
    <output data-testid="selection">
      {selection.kind === "element" ? selection.instancePath : selection.kind}
    </output>
  );
}

describe("CanvasPane", () => {
  const mountCanvas = async () => {
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <SelectionReadout />
        <CanvasPane />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
    return { editor, view };
  };

  it("drops to document scope on the backdrop but keeps a selection made in the column", async () => {
    const { view } = await mountCanvas();
    const canvas = frameDocument(view.container);

    fireEvent.click(canvas.querySelector(`[${INSTANCE_PATH_ATTRIBUTE}="0.0.1"]`)!);
    await waitFor(() => expect(view.getByTestId("selection").textContent).toBe("0.0.1"));

    // The column stops the viewport's deselect handler, so a click that resolved
    // inside the email keeps its selection.
    fireEvent.click(view.container.querySelector("[data-canvas-zoom]")!);
    expect(view.getByTestId("selection").textContent).toBe("0.0.1");

    // The bare backdrop outside the email column is the deselect surface.
    fireEvent.click(view.container.querySelector("[data-samva-canvas-viewport]")!);
    await waitFor(() => expect(view.getByTestId("selection").textContent).toBe("document"));
  });

  it("replaces the canvas with the build's errors when the entry did not build", async () => {
    const { editor, view } = await mountCanvas();

    await act(() => emitChange(editor, { origin: "external", broken: true }));

    const unbuilt = await view.findByTestId("canvas.unbuilt");
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(unbuilt.dataset.unbuiltReason).toBe("failed");
    expect(unbuilt.textContent).toContain("No preview");
    expect(unbuilt.textContent).toContain("entry-did-not-build");
    expect(unbuilt.textContent).toContain("src/Welcome.tsx:17:5");
  });

  it("offers the failed build to the Assistant when the host supplies one", async () => {
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <ContributionsProvider
          value={resolveContributions([
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ])}
        >
          <CanvasPane />
        </ContributionsProvider>
      </EditorProvider>,
    );
    await waitFor(() => expect(view.container.querySelector("iframe")).not.toBeNull());
    await act(() => emitChange(editor, { origin: "external", broken: true }));

    const unbuilt = await view.findByTestId("canvas.unbuilt");
    expect(unbuilt.querySelector('[data-testid="check.fix-with-assistant"]')).not.toBeNull();
    expect(unbuilt.querySelector('[data-testid="check.upgrade-with-assistant"]')).toBeNull();
  });

  it("offers no Assistant action on a failed build without an assistant", async () => {
    const { editor, view } = await mountCanvas();

    await act(() => emitChange(editor, { origin: "external", broken: true }));

    const unbuilt = await view.findByTestId("canvas.unbuilt");
    expect(
      unbuilt.querySelector("[data-testid^='check.'][data-testid$='-with-assistant']"),
    ).toBeNull();
  });

  it("keeps the last good preview and names the problem with the latest edit", async () => {
    const { editor, view } = await mountCanvas();

    await act(() =>
      emitChange(editor, {
        origin: "external",
        staleReason: "Unexpected token in emails/welcome.tsx",
      }),
    );

    const stale = await view.findByTestId("canvas.preview-stale");
    expect(view.container.querySelector("iframe")).not.toBeNull();
    expect(stale.textContent).toContain("Unexpected token in emails/welcome.tsx");
    // Chrome copy names the customer's edit, never the revisions behind it.
    expect(stale.textContent).not.toMatch(/revision|render/i);
  });

  it("says an entry nothing has executed is waiting for its first build, not broken", async () => {
    const { editor, view } = await mountCanvas();

    await act(() => emitChange(editor, { origin: "external", broken: "not-built" }));

    const unbuilt = await view.findByTestId("canvas.unbuilt");
    expect(unbuilt.dataset.unbuiltReason).toBe("not-built");
    expect(unbuilt.textContent).toContain("No preview yet");
    expect(unbuilt.textContent).not.toContain("Fix the source");
  });
});
