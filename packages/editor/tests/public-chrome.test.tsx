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
import { markupEditor, SMS_TSX } from "./markup-host";
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
      unobserve() {}
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

  it("splits the checks by severity and dates the draft's last save", async () => {
    stubWideShell();
    const checks = [
      { id: "e", severity: "error" as const, label: "Broken link", detail: "" },
      { id: "w1", severity: "warn" as const, label: "Alt text", detail: "" },
      { id: "w2", severity: "warn" as const, label: "Contrast", detail: "" },
      {
        id: "t",
        severity: "info" as const,
        label: "Rendering needs verification",
        detail: "",
        diagnostics: [
          {
            code: "feature",
            severity: "info" as const,
            message: "Verify Outlook rendering",
            origins: [],
            clients: ["Outlook"],
            compatibility: { assessment: "unverified" as const, title: "Needs verification" },
          },
        ],
      },
      { id: "size", severity: "info" as const, label: "Size", detail: "12 KB" },
    ];
    let storeApi: ReturnType<typeof useEditorStoreApi> | undefined;
    const Probe = () => {
      storeApi = useEditorStoreApi();
      return null;
    };
    const view = render(
      <EditorProvider host={await host()} checks={checks}>
        <Probe />
        <EditorShell
          contributions={[
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ]}
        />
      </EditorProvider>,
    );

    const trigger = await view.findByTestId("statusbar.checks-trigger");
    expect(trigger.textContent).toBe("1 error · 2 warnings · 1 tip");
    expect(trigger.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("error");
    expect((await view.findByTestId("statusbar.draft")).textContent).toBe("Draft");
    act(() => storeApi?.setState({ draftSavedAt: Date.now() - 2 * 60_000 }));
    await waitFor(() =>
      expect(view.getByTestId("statusbar.draft").textContent).toBe("Draft · saved 2 min ago"),
    );
    // A save that stopped is not "saving": the note says so even while its source is queued.
    act(() => storeApi?.setState({ pendingAuthoredSource: "queued", conflict: true }));
    await waitFor(() =>
      expect(view.getByTestId("statusbar.draft").textContent).toBe("Draft · couldn’t save"),
    );
  });

  it("gives the assistant, the work pane tabs and the preview bar one header height and divider", async () => {
    stubWideShell();
    const view = render(
      <EditorProvider host={await host()}>
        <EditorShell
          contributions={[
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ]}
        />
      </EditorProvider>,
    );

    await view.findByTestId("preview-bar");
    const headers = [
      view.container.querySelector('[data-slot="editor-assistant-dock-header"]'),
      view.container.querySelector('[data-slot="editor-work-pane-header"]'),
      view.getByTestId("preview-bar"),
    ];
    for (const header of headers) {
      const tokens = (header?.className ?? "").split(/\s+/);
      expect(tokens).toEqual(expect.arrayContaining(["h-11", "border-b", "border-border"]));
    }
  });

  it("names the checks left to review and opens them where the layout keeps checks", async () => {
    stubWideShell();
    const unverified = {
      id: "compat:feature",
      severity: "info" as const,
      label: "Rendering needs verification",
      detail: "1 finding",
      diagnostics: [
        {
          code: "feature",
          severity: "info" as const,
          message: "Verify Outlook rendering",
          origins: [],
          clients: ["Outlook"],
          compatibility: {
            assessment: "unverified" as const,
            title: "Rendering needs verification",
          },
        },
      ],
    };
    const view = render(
      <EditorProvider
        host={await host()}
        checks={[unverified, { ...unverified, id: "compat:other" }]}
      >
        <EditorShell
          contributions={[
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ]}
        />
      </EditorProvider>,
    );

    const trigger = await view.findByTestId("statusbar.checks-trigger");
    expect(trigger.textContent).toBe("2 tips");
    expect(view.queryByTestId("work-pane.panel.checks")).toBeNull();
    fireEvent.click(trigger);
    expect((await view.findByTestId("work-pane.panel.checks")).textContent).toContain(
      "2 tips to check in specific email clients.",
    );
    view.unmount();

    const clear = render(
      <EditorProvider
        host={await host()}
        checks={[{ id: "size", severity: "info", label: "Size", detail: "12 KB" }]}
      >
        <EditorShell />
      </EditorProvider>,
    );
    // Without a docked assistant there is no Checks tab, so the checks open in a popover.
    const standalone = await clear.findByTestId("statusbar.checks-trigger");
    expect(standalone.textContent).toBe("No issues found");
    fireEvent.click(standalone);
    expect(await clear.findByTestId("statusbar.checks-popup")).toBeTruthy();
    clear.unmount();

    // A message channel has no work pane even beside a docked assistant.
    const sms = render(
      <EditorProvider host={markupEditor("sms", SMS_TSX).host} checks={[unverified]}>
        <EditorShell
          contributions={[
            { slot: "rail.assistant", id: "assistant", render: () => <div>Assistant</div> },
          ]}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(sms.queryByTestId("statusbar.checks-trigger")).toBeTruthy());
    expect(await sms.findByTestId("sms-workspace.category")).toBeTruthy();
    fireEvent.click(sms.getByTestId("statusbar.checks-trigger"));
    expect(await sms.findByTestId("statusbar.checks-popup")).toBeTruthy();
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
    expect(view.getByTestId("work-pane")).toBeTruthy();
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

  it("offers the host's review surface as a Review tab of the work pane", async () => {
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
    fireEvent.click(view.getByTestId("work-pane.add"));
    const menu = await view.findByTestId("work-pane.add-menu");
    for (const tab of ["source", "design", "review", "checks"]) {
      expect(menu.querySelector(`[data-testid="work-pane.add.${tab}"]`)).not.toBeNull();
    }
    // A new diff never moves the reader on its own: the surface mounts on selection.
    expect(view.queryByTestId("test.review-content")).toBeNull();
    fireEvent.click(view.getByTestId("work-pane.add.review"));
    const reviewTab = await view.findByTestId("work-pane.tab.review");
    expect(reviewTab.textContent).toContain("Review");
    expect(view.getByTestId("test.review-badge").textContent).toBe("2");
    expect(view.getByTestId("work-pane.panel.review").textContent).toContain("Draft changes");
  });

  it("keeps Source, Design and Checks without a review surface", async () => {
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
    fireEvent.click(view.getByTestId("work-pane.add"));
    const menu = await view.findByTestId("work-pane.add-menu");
    expect(menu.querySelector('[data-testid="work-pane.add.review"]')).toBeNull();
    fireEvent.click(view.getByTestId("work-pane.add.design"));
    expect(await view.findByTestId("design-panel")).toBeTruthy();
    expect(view.getByTestId("inspector")).toBeTruthy();
    // The Design tab's inspector leaves checks to their own tab.
    expect(
      view.getByTestId("design-panel").querySelector('section[aria-label="Needs attention"]'),
    ).toBeNull();

    fireEvent.click(view.getByTestId("work-pane.add"));
    fireEvent.click(await view.findByTestId("work-pane.add.checks"));
    expect((await view.findByTestId("work-pane.panel.checks")).textContent).toContain(
      "No problems found",
    );
    // An added tab closes from its own control; the tab before it takes over.
    fireEvent.click(view.getByTestId("work-pane.close.checks"));
    expect(view.queryByTestId("work-pane.tab.checks")).toBeNull();
    expect(view.getByTestId("work-pane.tab.design").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps fixture switching in the toolbar for a message channel", async () => {
    stubWideShell();
    const editor = markupEditor(
      "sms",
      SMS_TSX.replace(
        'fixtures: { default: { name: "Ada", code: "123456", vip: true } },',
        'fixtures: { default: { name: "Ada", code: "123456", vip: true }, returning: { name: "Grace", code: "654321" } },',
      ),
    );
    const view = render(
      <EditorProvider
        host={{ ...editor.host, fixtures: { status: "ready", api: { view: async () => {} } } }}
      >
        <EditorShell />
      </EditorProvider>,
    );

    const picker = (await view.findByTestId("topbar.fixture")) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(["default", "returning"]);
    // An SMS has no email canvas, so no preview bar carries the picker.
    expect(view.queryByTestId("preview-bar")).toBeNull();
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
    // The host's glyph stands where the default did: inside the top bar's Preview action.
    expect((await view.findByTestId("topbar.preview")).contains(drawn[0] ?? null)).toBe(true);
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
