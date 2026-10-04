/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { LockedAction } from "../src/chrome/locked-action";
import { EditorShell } from "../src/chrome/shell";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { mockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const host = async () => (await mockEditor()).host;

const stubWideShell = () => {
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
};

describe("public editor chrome", () => {
  it("routes an exact compatibility finding into the Assistant", async () => {
    stubWideShell();
    const check = {
      id: "compat:font-size",
      severity: "warn" as const,
      label: "Font size",
      detail: "1 finding",
      diagnostics: [
        {
          code: "caniemail/font-size",
          severity: "warning" as const,
          message: "Review the font size",
          origins: [],
          clients: ["Outlook"],
        },
      ],
    };
    const view = render(
      <EditorProvider host={await host()} checks={[check]}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: ({ workspace }) => (
                <div data-testid="test.assistant-finding">
                  {workspace.diagnosticAssistance?.check.id ?? "none"}
                </div>
              ),
            },
          ]}
        />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId("statusbar.checks-trigger"));
    fireEvent.click(await view.findByTestId("check.fix-with-assistant"));

    await waitFor(() =>
      expect(view.getByTestId("test.assistant-finding").textContent).toBe(check.id),
    );
    expect(view.queryByTestId("template-agent.diagnostic-fixes")).toBeNull();
  });

  it("labels a finding with an upgrade recipe as an upgrade", async () => {
    stubWideShell();
    const check = {
      id: "definition:legacy",
      severity: "error" as const,
      label: "Legacy definition",
      detail: "1 finding",
      diagnostics: [
        {
          code: "legacy-definition",
          severity: "error" as const,
          message: "The entry default-exports something other than defineTemplate.",
          origins: [],
        },
      ],
    };
    const view = render(
      <EditorProvider host={await host()} checks={[check]}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: ({ workspace }) => (
                <div data-testid="test.assistant-finding">
                  {workspace.diagnosticAssistance?.check.id ?? "none"}
                </div>
              ),
            },
          ]}
        />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId("statusbar.checks-trigger"));
    const upgrade = await view.findByTestId("check.upgrade-with-assistant");
    expect(upgrade.textContent).toBe("Upgrade with Assistant");
    expect(view.queryByTestId("check.fix-with-assistant")).toBeNull();
    fireEvent.click(upgrade);

    await waitFor(() =>
      expect(view.getByTestId("test.assistant-finding").textContent).toBe(check.id),
    );
  });

  it("mounts host identity and controls in the canonical toolbar", async () => {
    stubWideShell();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "statusbar.headline",
              id: "guest-status",
              headline: "Preset render · your first edit saves a copy",
              saveVersion: false,
            },
            {
              slot: "toolbar.leading",
              id: "brand",
              render: () => <div data-testid="test.host-brand">Samva</div>,
            },
            {
              slot: "document.switcher",
              id: "switcher",
              render: () => (
                <button type="button" data-testid="test.template-switcher">
                  Welcome email
                </button>
              ),
            },
            {
              slot: "toolbar.actions",
              id: "history",
              render: () => (
                <button type="button" data-testid="test.history">
                  History
                </button>
              ),
            },
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant</div>,
            },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("agent-column")).toBeTruthy());
    expect(view.getByTestId("test.agent-panel")).toBeTruthy();
    expect(view.getByTestId("test.host-brand")).toBeTruthy();
    expect(view.getByTestId("test.template-switcher")).toBeTruthy();
    expect(view.getByTestId("test.history")).toBeTruthy();
    expect(view.getByTestId("topbar.name")).toBeTruthy();
    expect(view.getByTestId("topbar.preview")).toBeTruthy();
    expect(view.getByTestId("topbar.undo")).toBeTruthy();
    expect(view.queryByTestId("topbar.chrome")).toBeNull();
    expect(view.getByTestId("statusbar.guest").textContent).toBe(
      "Preset render · your first edit saves a copy",
    );
    expect(view.container.querySelector('nav[aria-label="Editor panels"]')).toBeNull();
    expect(view.container.querySelector('[data-agent-workspace-layout="split"]')).toBeTruthy();
    expect(view.getByTestId("design-rail")).toBeTruthy();
  });

  it("pins a host canvas status over the canvas without taking it from the pointer", async () => {
    stubWideShell();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant</div>,
            },
            {
              slot: "canvas.overlay",
              id: "status",
              render: () => <p data-testid="test.canvas-status">The preview is behind.</p>,
            },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("agent-column")).toBeTruthy());
    const status = view.getByTestId("test.canvas-status");
    expect(status.textContent).toContain("The preview is behind.");
    // A wait names itself; it never becomes a click target of its own, and the
    // canvas underneath keeps every pointer event.
    const slot = view.container.querySelector("[data-samva-canvas-status]");
    expect(slot?.contains(status)).toBe(true);
    expect(slot?.className).toContain("pointer-events-none");
    expect(view.container.querySelector("[data-samva-canvas-viewport]")).toBeTruthy();
  });

  it("draws nothing over the canvas while a host status has nothing to say", async () => {
    stubWideShell();
    // A host status is a live component: it renders nothing most of the time
    // and something during a wait. The element the host hands over is always
    // truthy, so the slot must draw no chrome of its own — a pill and a
    // spinner here would sit over the preview on every mount, empty.
    const QuietStatus = () => null;
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant</div>,
            },
            { slot: "canvas.overlay", id: "status", render: () => <QuietStatus /> },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("agent-column")).toBeTruthy());
    const slot = view.container.querySelector("[data-samva-canvas-status]");
    expect(slot).toBeTruthy();
    expect(slot?.textContent).toBe("");
    expect(slot?.childElementCount).toBe(0);
    expect(slot?.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps the canvas clear when the host provides no status", async () => {
    stubWideShell();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant</div>,
            },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("agent-column")).toBeTruthy());
    expect(view.container.querySelector("[data-samva-canvas-status]")).toBeNull();
  });

  it("shows a host's locked action and the locked Publish, and hands both continuations to the host", async () => {
    stubWideShell();
    const accountGate = {
      status: "locked" as const,
      upsell: {
        reason: "Sign in and keep this draft.",
        cta: { label: "Sign in and keep this draft", href: "#sign-in" },
      },
    };
    const lockedHost = { ...(await host()), lifecycle: accountGate };
    const onLockedSend = vi.fn();
    const onLockedLifecycle = vi.fn();
    const view = render(
      <EditorProvider host={lockedHost}>
        <EditorShell
          contributions={[
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
            {
              slot: "toolbar.actions",
              id: "send",
              render: () => (
                <LockedAction
                  label="Send"
                  title="Send this template"
                  upsell={accountGate.upsell}
                  onAction={onLockedSend}
                  testId="test.send"
                />
              ),
            },
          ]}
          onLockedLifecycle={onLockedLifecycle}
        />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId("test.send"));
    expect((await view.findByTestId("test.send.cta")).textContent).toBe(
      "Sign in and keep this draft",
    );
    fireEvent.click(view.getByTestId("test.send.cta"));
    expect(onLockedSend).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByTestId("test.send.close"));

    fireEvent.click(view.getByTestId("topbar.publish"));
    expect((await view.findByTestId("lifecycle-sheet.locked-reason")).textContent).toBe(
      "Sign in and keep this draft.",
    );
    fireEvent.click(view.getByTestId("lifecycle-sheet.upsell-cta"));
    expect(onLockedLifecycle).toHaveBeenCalledTimes(1);
  });

  it("docks the host's review surface as the Design rail's Review view", async () => {
    stubWideShell();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant</div>,
            },
            {
              slot: "rail.review",
              id: "review",
              badge: <span data-testid="test.review-badge">2</span>,
              content: <div data-testid="test.review-content">Draft changes</div>,
            },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("agent-column")).toBeTruthy());
    const reviewTab = view.getByTestId("design.tab.review");
    expect(reviewTab.textContent).toContain("Review");
    expect(view.getByTestId("test.review-badge").textContent).toBe("2");
    // A new diff never moves the reader on its own: the surface mounts on selection.
    expect(view.queryByTestId("test.review-content")).toBeNull();
    fireEvent.click(reviewTab);
    expect(view.getByTestId("test.review-content")).toBeTruthy();
    expect(view.getByTestId("design-rail").textContent).toContain("Draft changes");
  });

  it("keeps Layers and Inspector as the rail's whole story without a review surface", async () => {
    stubWideShell();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            {
              slot: "rail.assistant",
              id: "assistant",
              render: () => <div data-testid="test.agent-panel">Assistant</div>,
            },
          ]}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByTestId("agent-column")).toBeTruthy());
    expect(view.getByTestId("design.tab.layers")).toBeTruthy();
    expect(view.getByTestId("design.tab.inspector")).toBeTruthy();
    expect(view.queryByTestId("design.tab.review")).toBeNull();
  });

  it("yields the guest headline to the live save note while a persist is queued", async () => {
    stubWideShell();
    type EditorStoreRef = { current: ReturnType<typeof useEditorStoreApi> | null };
    const storeRef: EditorStoreRef = { current: null };
    function StoreProbe({ target }: { readonly target: EditorStoreRef }) {
      target.current = useEditorStoreApi();
      return null;
    }
    const view = render(
      <EditorProvider host={await host()}>
        <StoreProbe target={storeRef} />
        <EditorShell
          contributions={[
            {
              slot: "statusbar.headline",
              id: "guest",
              headline: "Draft saved",
              saveVersion: false,
            },
          ]}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(storeRef.current?.getState().doc).not.toBeNull());
    expect(view.getByTestId("statusbar.guest").textContent).toBe("Draft saved");
    await act(async () => {
      storeRef.current?.getState().actions.replaceAuthoredSource("// edited source");
    });
    expect(view.getByTestId("statusbar.guest").textContent).toBe("Saving…");
  });

  it("draws a host's icon in place of the default it replaces", async () => {
    stubWideShell();
    const preview = ({ className }: { readonly className?: string }) => (
      <svg data-testid="test.host-preview-icon" className={className} />
    );
    const view = render(
      <EditorProvider host={await host()} icons={{ eye: preview }}>
        <EditorShell />
      </EditorProvider>,
    );

    const drawn = await view.findAllByTestId("test.host-preview-icon");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn[0]?.getAttribute("class")).toContain("size-[15px]");
  });

  it("reports Preview to the host's telemetry instead of a shell callback", async () => {
    stubWideShell();
    const events: Array<{ readonly name: string }> = [];
    const view = render(
      <EditorProvider host={{ ...(await host()), telemetry: (event) => events.push(event) }}>
        <EditorShell />
      </EditorProvider>,
    );

    fireEvent.click(await view.findByTestId("topbar.preview"));
    expect(events).toEqual([{ name: "preview" }]);
  });
});
