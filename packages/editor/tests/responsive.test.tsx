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
import { EditorProvider } from "../src/state/provider";
import { type EditorLayoutMode } from "../src/state/store";
import { mockEditor, withVersions } from "./mock-host";
import { useEditorProbe } from "./store-probe";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const host = async () => (await mockEditor()).host;

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

  it("keeps the canonical workspace split above 980px and uses focused tablet panes", async () => {
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
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant content</div>,
            },
          ]}
        />
      </EditorProvider>,
    );

    const workspace = await waitFor(() =>
      view.container.querySelector('[data-agent-workspace-layout="split"]'),
    );
    expect(workspace).toBeTruthy();
    expect(view.getByTestId("agent-column.resize")).toBeTruthy();
    expect(view.getByTestId("design-rail")).toBeTruthy();
    expect(
      view.container.querySelector('[role="tablist"][aria-label="Workspace view"]'),
    ).toBeTruthy();
    const visualTab = view.getByTestId("workspace.tab.visual");
    expect(visualTab.getAttribute("role")).toBe("tab");
    expect(visualTab.getAttribute("aria-selected")).toBe("true");
    expect(visualTab.getAttribute("aria-pressed")).toBeNull();
    const previewPane = document.getElementById(visualTab.getAttribute("aria-controls") ?? "");
    expect(previewPane?.getAttribute("role")).toBe("tabpanel");
    // The view panel is named by the tab that opens it, so the two cannot drift.
    expect(previewPane?.getAttribute("aria-labelledby")).toBe(visualTab.id);
    fireEvent.click(view.getByTestId("workspace.tab.source"));
    expect(view.getByTestId("workspace.tab.source").getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("source-workspace.authored-tsx")).toBeTruthy();
    fireEvent.click(view.getByTestId("workspace.tab.visual"));
    const layersTab = view.getByTestId("design.tab.layers");
    expect(layersTab.getAttribute("aria-selected")).toBe("true");
    const designPanel = document.getElementById(layersTab.getAttribute("aria-controls") ?? "");
    expect(designPanel?.getAttribute("role")).toBe("tabpanel");
    fireEvent.click(view.getByTestId("design.tab.inspector"));
    const inspectorTab = view.getByTestId("design.tab.inspector");
    expect(inspectorTab.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById(inspectorTab.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect(designPanel?.getAttribute("aria-labelledby")).toBe(inspectorTab.id);
    expect(view.getByTestId("inspector")).toBeTruthy();

    act(() => notify(800));
    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="focused"]')).toBeTruthy(),
    );
    expect(view.queryByTestId("agent-column.resize")).toBeNull();
    expect(view.getByTestId("agent-workspace.tab.design")).toBeTruthy();
    expect(view.container.querySelector('[role="tablist"][aria-label="Editor pane"]')).toBeTruthy();
    for (const pane of ["assistant", "preview", "design"] as const) {
      const tab = view.getByTestId(`agent-workspace.tab.${pane}`);
      expect(tab.getAttribute("role")).toBe("tab");
      const paneNode = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      expect(paneNode?.getAttribute("role")).toBe("tabpanel");
      // The panel takes its name from the tab that opens it, never a restated literal.
      expect(paneNode?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(tab.querySelector("svg")).not.toBeNull();
      expect(tab.getAttribute("title")).toBeTruthy();
    }
    expect(view.getByTestId("agent-workspace.tab.assistant").textContent).toContain("Assistant");
    // Selecting a workspace view tab reveals the pane that hosts its panel.
    fireEvent.click(view.getByTestId("workspace.tab.source"));
    expect(view.getByTestId("agent-workspace.tab.preview").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      document
        .getElementById(
          view.getByTestId("workspace.tab.source").getAttribute("aria-controls") ?? "",
        )
        ?.closest("[hidden]"),
    ).toBeNull();
    fireEvent.click(view.getByTestId("agent-workspace.tab.design"));
    expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true);
    expect(view.getByTestId("design-rail").closest("[hidden]")).toBeNull();

    act(() => notify(600));
    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="focused"]')).toBeTruthy(),
    );
    expect(view.getByTestId("agent-workspace.tab.assistant").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(view.queryByTestId("agent-workspace.tab.design")).toBeNull();
    // Narrow drops the Design tab, so its pane must not claim a tabpanel no tab controls.
    expect(
      view.container.querySelectorAll('[role="tabpanel"][aria-labelledby$="-tab-design"]'),
    ).toHaveLength(0);
    expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(false);

    fireEvent.click(view.getByTestId("agent-workspace.tab.preview"));
    await waitFor(() => expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true));
    expect(view.getByTestId("test.agent-panel")).toBeTruthy();
  });

  it("reveals the host's review surface from the panel's deep-link in every layout", async () => {
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
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("test.open-review")).toBeTruthy());
    // A diff arriving on its own never moves the reader; the rail stays on Layers.
    expect(view.getByTestId("design.tab.layers").getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("design.tab.review").textContent).toContain("3");
    fireEvent.click(view.getByTestId("test.open-review"));
    expect(view.getByTestId("design.tab.review").getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("test.review-content")).toBeTruthy();

    // The focused layouts open the pane that carries the rail, with Review selected.
    act(() => notify(800));
    await waitFor(() =>
      expect(view.container.querySelector('[data-agent-workspace-layout="focused"]')).toBeTruthy(),
    );
    // The wide deep-link left Review selected, so the focused workspace opens on Design.
    expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true);
    // The pane toggle carries the host's one badge.
    expect(view.getByTestId("agent-workspace.tab.design").textContent).toContain("3");
    fireEvent.click(view.getByTestId("agent-workspace.tab.preview"));
    await waitFor(() => expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true));
    fireEvent.click(view.getByTestId("test.open-review"));
    await waitFor(() => expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true));
    expect(view.getByTestId("design.tab.review").getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("test.review-content")).toBeTruthy();

    // Narrow has no Design rail: the deep-link opens no pane the layout lacks.
    act(() => notify(600));
    await waitFor(() => expect(view.queryByTestId("agent-workspace.tab.design")).toBeNull());
    fireEvent.click(view.getByTestId("agent-workspace.tab.preview"));
    await waitFor(() => expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(true));
    fireEvent.click(view.getByTestId("test.open-review"));
    await waitFor(() =>
      expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(false),
    );
    expect(view.queryByTestId("test.review-content")).toBeNull();

    // The narrow deep-link focused the Assistant, the pane that carries the
    // review there. Growing back to compact keeps the reader on it rather than
    // dropping them onto a Design pane they never opened.
    act(() => notify(800));
    await waitFor(() => expect(view.getByTestId("agent-workspace.tab.design")).toBeTruthy());
    expect(view.getByTestId("agent-column").hasAttribute("hidden")).toBe(false);
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
      width: 980,
      height: 900,
      top: 0,
      right: 980,
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
