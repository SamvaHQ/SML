/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { DocumentChange, EditorDocument } from "@samva/editor/host";
import type { AsyncEditableEditorHost } from "@samva/editor/host";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { EditorShell } from "../src/chrome/shell";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { type EditorLayoutMode, type EditorStore } from "../src/state/store";
import { emitChange, mockEditor, withVersions } from "./mock-host";
import { useEditorProbe } from "./store-probe";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const host = async () => (await mockEditor()).host;

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

/** Capture every ResizeObserver the editor builds; the returned function resizes them all. */
const observeResizes = () => {
  const callbacks: Array<(entries: Array<{ contentRect: { width: number } }>) => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return (width: number) => {
    for (const callback of [...callbacks]) callback([{ contentRect: { width } }]);
  };
};

let capturedStore: EditorStore | null = null;

/** Renders nothing; hands the test the store of the editor it is mounted in. */
function StoreCapture() {
  capturedStore = useEditorStoreApi();
  return null;
}

/** The store of the editor mounted last. */
const storeOf = (): EditorStore => {
  if (capturedStore === null) throw new Error("No editor store captured");
  return capturedStore;
};

function CollapseProbe({ mode }: { mode: EditorLayoutMode }) {
  const { leftCollapsed, rightCollapsed, layoutMode, setLayoutMode, toggleLeft } = useEditorProbe();
  useEffect(() => setLayoutMode(mode), [mode, setLayoutMode]);
  return (
    <div>
      <div data-testid="mode">{layoutMode}</div>
      <div data-testid="state">{`${leftCollapsed ? "L" : "-"}${rightCollapsed ? "R" : "-"}`}</div>
      <button type="button" onClick={toggleLeft} data-testid="probe.toggle-left">
        Toggle left
      </button>
    </div>
  );
}

describe("container-responsive rail policy", () => {
  it("shows an externally saved revision as saved and a later draft as unsaved", async () => {
    const editor = await mockEditor();
    let publish: ((change: DocumentChange) => void) | undefined;
    let initial: EditorDocument | undefined;
    let savedRevision: string | null = null;
    const unavailable = () => Promise.reject("Lifecycle operation is not arranged");
    const wrappedHost: AsyncEditableEditorHost = {
      ...editor.host,
      document: {
        ...editor.host.document,
        open: async (onChange) => {
          publish = onChange;
          const opened = await editor.host.document.open(onChange);
          initial = opened.initial;
          return opened;
        },
      },
    };
    const view = render(
      <EditorProvider host={withVersions(wrappedHost, unavailable, async () => savedRevision)}>
        <EditorShell />
      </EditorProvider>,
    );
    const status = await view.findByTestId("statusbar.save-version");
    await waitFor(() => expect(status.dataset.saveVersionState).toBe("idle"));
    const document = initial;
    const publishChange = publish;
    if (document?.channel !== "email" || publishChange === undefined)
      throw new Error("Editor is not open");
    const change = (rev: string): DocumentChange => ({
      rev,
      origin: "external",
      authoredSource: document.origin.authoredSource,
      channel: document.channel,
      preview: document.preview,
      fixtures: document.fixtures,
      fixture: document.fixture,
      render: document.render,
      diagnostics: document.diagnostics,
      incompatibilities: document.incompatibilities,
    });

    savedRevision = "agent_saved";
    act(() => publishChange(change("agent_saved")));
    await waitFor(() => expect(status.dataset.saveVersionState).toBe("saved"));

    savedRevision = null;
    act(() => publishChange(change("next_draft")));
    await waitFor(() => expect(status.dataset.saveVersionState).toBe("idle"));
  });

  it("adopts a version revision already published by the host", async () => {
    const editor = await mockEditor();
    let publish: ((change: DocumentChange) => void) | undefined;
    let initial: EditorDocument | undefined;
    const wrappedHost: AsyncEditableEditorHost = {
      ...editor.host,
      document: {
        ...editor.host.document,
        open: async (onChange) => {
          publish = onChange;
          const opened = await editor.host.document.open(onChange);
          initial = opened.initial;
          return opened;
        },
      },
    };
    const revisions: string[] = [];
    const view = render(
      <EditorProvider
        host={withVersions(wrappedHost, async (revision) => {
          revisions.push(revision);
          const current = initial;
          if (current === undefined || publish === undefined) throw new Error("Editor is not open");
          if (current.channel !== "email") throw new Error("Expected email document");
          const materialized = `rev_${revisions.length + 1}`;
          publish({
            rev: materialized,
            authoredSource: current.origin.authoredSource,
            origin: "self",
            channel: current.channel,
            preview: current.preview,
            fixtures: current.fixtures,
            fixture: current.fixture,
            render: current.render,
            diagnostics: current.diagnostics,
            incompatibilities: current.incompatibilities,
          });
          return materialized;
        })}
      >
        <EditorShell />
      </EditorProvider>,
    );

    await view.findByTestId("topbar.save-version");
    fireEvent.click(view.getByTestId("topbar.save-version"));
    await waitFor(() => expect(revisions).toEqual(["rev_1"]));
    await waitFor(() =>
      expect(view.getByTestId("statusbar.save-version").dataset.saveVersionState).toBe("saved"),
    );
    fireEvent.click(view.getByTestId("topbar.save-version"));
    await waitFor(() => expect(revisions).toEqual(["rev_1", "rev_2"]));
  });

  it("splits chat and a tabbed work pane from 1280px and switches Chat | Preview below it", async () => {
    stubFrame(1440);
    const notify = observeResizes();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant content</div>,
            },
          ]}
        />
        <StoreCapture />
      </EditorProvider>,
    );

    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="split"]')).toBeTruthy(),
    );
    expect(view.getByTestId("agent-column.resize")).toBeTruthy();
    expect(view.getByTestId("work-pane")).toBeTruthy();
    // No third column: Layers, Inspector, Review and Checks are tabs of the work pane.
    expect(view.queryByTestId("design-rail")).toBeNull();
    expect(view.queryByTestId("workspace.tab.visual")).toBeNull();
    const previewTab = view.getByTestId("work-pane.tab.preview");
    expect(previewTab.getAttribute("role")).toBe("tab");
    expect(previewTab.getAttribute("aria-selected")).toBe("true");
    // Preview is always open and never closable.
    expect(view.queryByTestId("work-pane.close.preview")).toBeNull();

    const store = storeOf();
    act(() => store.getState().actions.openWorkTab("source"));
    expect(view.getByTestId("work-pane.tab.source").getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("source-workspace.authored-tsx")).toBeTruthy();
    fireEvent.click(view.getByTestId("work-pane.close.source"));
    expect(view.queryByTestId("work-pane.tab.source")).toBeNull();
    expect(view.getByTestId("work-pane.tab.preview").getAttribute("aria-selected")).toBe("true");

    act(() => notify(1180));
    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="focused"]')).toBeTruthy(),
    );
    expect(view.queryByTestId("agent-column.resize")).toBeNull();
    expect(view.container.querySelector('[role="tablist"][aria-label="Editor pane"]')).toBeTruthy();
    for (const pane of ["assistant", "preview"] as const) {
      const tab = view.getByTestId(`agent-workspace.tab.${pane}`);
      expect(tab.getAttribute("role")).toBe("tab");
      const paneNode = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      expect(paneNode?.getAttribute("role")).toBe("tabpanel");
      // The panel takes its name from the tab that opens it, never a restated literal.
      expect(paneNode?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(tab.querySelector("svg")).not.toBeNull();
    }
    expect(view.getByTestId("agent-workspace.tab.assistant").textContent).toContain("Chat");
    expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(false);

    fireEvent.click(view.getByTestId("agent-workspace.tab.preview"));
    await waitFor(() => expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true));
    // The host's assistant stays mounted while the preview is shown.
    expect(view.getByTestId("test.agent-panel")).toBeTruthy();
    expect(view.getByTestId("work-pane").closest("[hidden]")).toBeNull();

    // Design is reachable at every width, down to a phone.
    act(() => notify(390));
    act(() => store.getState().actions.openWorkTab("design"));
    expect(view.getByTestId("design-panel")).toBeTruthy();
    expect(view.getByTestId("inspector")).toBeTruthy();
    expect(view.getByTestId("design-panel").closest("[hidden]")).toBeNull();

    // Growing back to 1280px restores both panes without remounting the assistant.
    const panel = view.getByTestId("test.agent-panel");
    act(() => notify(1300));
    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="split"]')).toBeTruthy(),
    );
    expect(view.getByTestId("test.agent-panel")).toBe(panel);
    expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(false);
  });

  it("collapses the chat so the work pane takes the full width, and remembers it", async () => {
    stubFrame(1440);
    observeResizes();
    const contributions = [
      {
        slot: "rail.assistant" as const,
        id: "assistant",
        render: () => <div data-testid="test.agent-panel">Assistant content</div>,
      },
    ];
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell contributions={contributions} />
      </EditorProvider>,
    );
    const toggle = await view.findByTestId("work-pane.toggle-chat");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse chat");
    fireEvent.click(toggle);
    expect(view.getByTestId("agent-column").closest("[hidden]")).not.toBeNull();
    expect(view.queryByTestId("agent-column.resize")).toBeNull();
    expect(view.getByTestId("work-pane.toggle-chat").getAttribute("aria-label")).toBe("Show chat");
    view.unmount();

    const again = render(
      <EditorProvider host={await host()}>
        <EditorShell contributions={contributions} />
      </EditorProvider>,
    );
    const restored = await again.findByTestId("work-pane.toggle-chat");
    expect(restored.getAttribute("aria-label")).toBe("Show chat");
    fireEvent.click(restored);
    expect(again.getByTestId("agent-column").closest("[hidden]")).toBeNull();
    expect(again.getByTestId("agent-column.resize")).toBeTruthy();
  });

  it("marks Preview when the host changes the email while the chat is shown", async () => {
    stubFrame(1440);
    const notify = observeResizes();
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <EditorShell
          contributions={[
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ]}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("work-pane")).toBeTruthy());
    act(() => notify(1000));
    await waitFor(() => expect(view.getByTestId("agent-workspace.tab.assistant")).toBeTruthy());
    expect(view.queryByTestId("agent-workspace.preview-updated")).toBeNull();

    await act(() => emitChange(editor, { origin: "agent" }));
    expect(await view.findByTestId("agent-workspace.preview-updated")).toBeTruthy();

    fireEvent.click(view.getByTestId("agent-workspace.tab.preview"));
    await waitFor(() => expect(view.queryByTestId("agent-workspace.preview-updated")).toBeNull());
    // A change that lands while the preview is on screen is already seen.
    await act(() => emitChange(editor, { origin: "agent" }));
    fireEvent.click(view.getByTestId("agent-workspace.tab.assistant"));
    expect(view.queryByTestId("agent-workspace.preview-updated")).toBeNull();
  });

  it("keeps the work pane's tabs across mounts of the same editor", async () => {
    stubFrame(1440);
    observeResizes();
    const contributions = [
      { slot: "rail.assistant" as const, id: "assistant", render: () => <div>Assistant</div> },
    ];
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell contributions={contributions} />
        <StoreCapture />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.getByTestId("work-pane")).toBeTruthy());
    const store = storeOf();
    act(() => store.getState().actions.openWorkTab("checks"));
    act(() => store.getState().actions.openWorkTab("source"));
    view.unmount();

    const again = render(
      <EditorProvider host={await host()}>
        <EditorShell contributions={contributions} />
      </EditorProvider>,
    );
    await waitFor(() => expect(again.getByTestId("work-pane.tab.checks")).toBeTruthy());
    // Tabs keep the menu's order, and the last one shown is shown again.
    const order = [...again.container.querySelectorAll('[data-testid^="work-pane.tab."]')].map(
      (node) => node.getAttribute("data-testid"),
    );
    expect(order).toEqual([
      "work-pane.tab.preview",
      "work-pane.tab.source",
      "work-pane.tab.checks",
    ]);
    expect(again.getByTestId("work-pane.tab.source").getAttribute("aria-selected")).toBe("true");
  });

  it("reveals the host's review surface from the panel's deep-link in every layout", async () => {
    stubFrame(1440);
    const notify = observeResizes();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: (controls) => (
                <button
                  type="button"
                  data-testid="test.open-review"
                  onClick={() => controls.openReview?.()}
                />
              ),
            },
            {
              slot: "rail.review",
              id: "review",
              badge: <span data-testid="test.review-badge">3</span>,
              content: <div data-testid="test.review-content">Draft changes</div>,
            },
          ]}
        />
        <StoreCapture />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("test.open-review")).toBeTruthy());
    // A diff arriving on its own never moves the reader; Review is not even open.
    expect(view.queryByTestId("work-pane.tab.review")).toBeNull();
    fireEvent.click(view.getByTestId("test.open-review"));
    const reviewTab = view.getByTestId("work-pane.tab.review");
    expect(reviewTab.getAttribute("aria-selected")).toBe("true");
    expect(reviewTab.textContent).toContain("3");
    expect(view.getByTestId("test.review-content")).toBeTruthy();

    // Below 1280px the deep-link switches to the work pane, where the Review tab lives.
    for (const width of [1000, 600]) {
      act(() => notify(width));
      await waitFor(() => expect(view.getByTestId("agent-workspace.tab.assistant")).toBeTruthy());
      fireEvent.click(view.getByTestId("agent-workspace.tab.assistant"));
      act(() => storeOf().getState().actions.openWorkTab("preview"));
      await waitFor(() =>
        expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(false),
      );
      fireEvent.click(view.getByTestId("test.open-review"));
      await waitFor(() =>
        expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true),
      );
      expect(view.getByTestId("work-pane.tab.review").getAttribute("aria-selected")).toBe("true");
      expect(view.getByTestId("test.review-content")).toBeTruthy();
    }
  });

  it("keeps both rails docked in wide mode", async () => {
    const { getByTestId } = render(
      <EditorProvider host={await host()}>
        <CollapseProbe mode="wide" />
      </EditorProvider>,
    );
    await waitFor(() => expect(getByTestId("state").textContent).toBe("--"));
  });

  it("renders host channel controls beside the document name", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1440,
      height: 900,
      top: 0,
      right: 1440,
      bottom: 900,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "document.switcher",
              id: "channels",
              render: () => (
                <nav aria-label="Template channel variants" data-testid="test.channel-switcher">
                  <button type="button" data-testid="test.add-sms-variant">
                    Add SMS variant
                  </button>
                </nav>
              ),
            },
          ]}
        />
      </EditorProvider>,
    );

    // The channelSwitcher slot markup is test-owned; assert the shell mounts it verbatim.
    expect(view.getByTestId("test.channel-switcher")).toBeTruthy();
    expect(view.getByTestId("test.add-sms-variant")).toBeTruthy();
  });

  it("measures the full editor frame when a dashboard rail is present", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1280,
      height: 900,
      top: 0,
      right: 1280,
      bottom: 900,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "frame.start",
              id: "nav",
              render: () => <nav data-testid="test.dashboard-rail" />,
            },
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="split"]')).toBeTruthy(),
    );
    expect(observed.length).toBeGreaterThanOrEqual(1);
    const frame = observed.find((target) => target.querySelector("[data-samva-editor-theme]"));
    expect(frame?.querySelector('[data-testid="test.dashboard-rail"]')).toBeTruthy();
  });

  it("preserves a manual rail toggle across in-zone resizes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1440,
      height: 900,
      top: 0,
      right: 1440,
      bottom: 900,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    // The shell and the canvas pane each construct an observer; notify every one.
    const callbacks: Array<(entries: Array<{ contentRect: { width: number } }>) => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const notify = (width: number) => {
      for (const callback of [...callbacks]) callback([{ contentRect: { width } }]);
    };
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell />
      </EditorProvider>,
    );

    fireEvent.click(view.getByTestId("left-rail.collapse"));
    expect(view.getByTestId("shell.show-left")).toBeTruthy();

    // Resize within the wide zone: the manual collapse must survive.
    act(() => notify(1400));
    expect(view.getByTestId("shell.show-left")).toBeTruthy();

    // Crossing into the standard zone re-applies that mode's dock defaults.
    act(() => notify(1000));
    await waitFor(() => expect(view.queryByTestId("shell.show-left")).toBeNull());
  });

  it("keeps layers docked and collapses the inspector in standard mode", async () => {
    const { getByTestId } = render(
      <EditorProvider host={await host()}>
        <CollapseProbe mode="standard" />
      </EditorProvider>,
    );
    await waitFor(() => expect(getByTestId("state").textContent).toBe("-R"));
  });

  it("collapses both rails in compact mode and preserves a manual overlay reopen", async () => {
    const { getByTestId, rerender } = render(
      <EditorProvider host={await host()}>
        <CollapseProbe mode="compact" />
      </EditorProvider>,
    );
    await waitFor(() => expect(getByTestId("state").textContent).toBe("LR"));
    fireEvent.click(getByTestId("probe.toggle-left"));
    expect(getByTestId("state").textContent).toBe("-R");

    rerender(
      <EditorProvider host={await host()}>
        <CollapseProbe mode="wide" />
      </EditorProvider>,
    );
    await waitFor(() => expect(getByTestId("state").textContent).toBe("--"));
  });
});
