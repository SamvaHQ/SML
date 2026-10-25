/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import type { AsyncEditableEditorHost, DocumentChange, PageRender } from "@samva/editor/host";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import { INSTANCE_PATH_ATTRIBUTE, type EmailElementSelection } from "@samva/markup/edit";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { CanvasPane } from "../src/chrome/canvas-pane";
import { ChecksPanel } from "../src/chrome/checks-panel";
import { PreviewChromeProvider } from "../src/chrome/preview-context";
import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import type { EditorStore } from "../src/state/store";
import { mockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

let capturedStore: EditorStore | null = null;

function StoreCapture() {
  capturedStore = useEditorStoreApi();
  return null;
}

const storeOf = (): EditorStore => {
  if (capturedStore === null) throw new Error("No editor store captured");
  return capturedStore;
};

type PageSource = NonNullable<Extract<DocumentChange, { channel: "email" }>["render"]>;

const CHART_NOTE = "Readers get the chart's figures as a table.";

/** A degradation finding in the shape the compiler reports it (`degradationFindings`). */
const degradation = (
  component: string,
  note: string,
  chains: EmailDiagnostic["origins"][],
): EmailDiagnostic => ({
  code: "email-component-degradation",
  severity: "warning",
  message: `<${component}>: ${note}`,
  origins: chains[0] ?? [],
  occurrences: chains,
  compatibility: { assessment: "degradation", title: note },
});

interface Options {
  /** Hide the host's `render`, as a host without web targets does. */
  readonly webless?: boolean;
  /** Which of the email's selections the page also renders. */
  readonly pageKeeps?: (selection: EmailElementSelection) => boolean;
  readonly chart?: boolean;
  readonly pageFails?: boolean;
  /** Called on every web render the host is asked for. */
  readonly onPageRequest?: () => void;
}

/**
 * The mock host with a web target: the page is the email's own markup and selections (so the two
 * share authored identities), and a Chart finding located at the first two authored elements.
 */
const hostWithPage = async (options: Options = {}) => {
  const editor = await mockEditor();
  let email: PageSource | null = null;
  const findings = (source: PageSource | null): ReadonlyArray<EmailDiagnostic> => {
    email = source;
    if (options.chart !== true) return [];
    const chains = (source?.selections ?? [])
      .filter((entry) => entry.authored)
      .slice(0, 2)
      .map((entry) => entry.origins.slice(0, 1))
      .filter((origins) => origins.length > 0);
    return [degradation("Chart", CHART_NOTE, chains)];
  };
  const decorateChange = (change: DocumentChange): DocumentChange =>
    change.channel === "email" ? { ...change, incompatibilities: findings(change.render) } : change;
  const open = editor.host.document.open;
  const host: AsyncEditableEditorHost = {
    ...editor.host,
    ...(options.webless === true
      ? {}
      : {
          render: async (_entry: string, _fixture: string, _target: "email" | "web") => {
            options.onPageRequest?.();
            if (options.pageFails === true || email === null) return null;
            const page: PageRender = {
              kind: "page",
              revision: email.revision,
              html: email.html,
              selections: email.selections.filter(options.pageKeeps ?? (() => true)),
            };
            return page;
          },
        }),
    document: {
      ...editor.host.document,
      open: async (onChange) => {
        const opened = await open((change) => onChange(decorateChange(change)));
        const initial = opened.initial;
        return {
          ...opened,
          initial:
            initial.channel === "email"
              ? { ...initial, incompatibilities: findings(initial.render) }
              : initial,
        };
      },
    },
  };
  return host;
};

const mount = async (options: Options = {}) => {
  const host = await hostWithPage(options);
  const view = render(
    <EditorProvider host={host}>
      <StoreCapture />
      <div data-samva-editor-theme="host">
        <PreviewChromeProvider
          value={{ hostBusy: false, openInNewTab: vi.fn(), showChecks: undefined }}
        >
          <CanvasPane />
        </PreviewChromeProvider>
        <ChecksPanel />
      </div>
    </EditorProvider>,
  );
  await view.findByTestId("preview-bar");
  await waitFor(() => expect(storeOf().getState().render).not.toBeNull());
  return view;
};

const toWeb = async (view: Awaited<ReturnType<typeof mount>>) => {
  fireEvent.click(view.getByTestId("preview-bar.target.web"));
  await view.findByTestId("canvas.page-frame");
};

const pageDocument = (view: Awaited<ReturnType<typeof mount>>) => {
  const document_ = view.container.querySelector("iframe")?.contentDocument;
  if (document_ === null || document_ === undefined) throw new Error("No frame document");
  return document_;
};

const firstAuthored = () => {
  const entry = storeOf()
    .getState()
    .render?.selections.find((selection) => selection.authored && selection.tag !== "html");
  if (entry === undefined) throw new Error("The mock renders no authored element");
  return entry;
};

describe("Email | Web toggle", () => {
  it("is absent when the host has no web render", async () => {
    const view = await mount({ webless: true });
    expect(view.queryByTestId("preview-bar.target.web")).toBeNull();
    expect(view.queryByTestId("checks.email-differences")).toBeNull();
  });

  it("starts on Email and keeps email-only controls off the Web target", async () => {
    const view = await mount();
    expect(view.getByTestId("preview-bar.target.email").getAttribute("aria-pressed")).toBe("true");
    expect(view.getByTestId("preview-bar.size")).toBeTruthy();
    expect(view.getByTestId("preview-bar.open")).toBeTruthy();

    await toWeb(view);
    expect(view.getByTestId("preview-bar.target.web").getAttribute("aria-pressed")).toBe("true");
    expect(view.queryByTestId("preview-bar.size")).toBeNull();
    expect(view.queryByTestId("preview-bar.open")).toBeNull();
    expect(view.getByTestId("preview-bar.fixture")).toBeTruthy();
    expect(view.getByTestId("canvas.device.mobile")).toBeTruthy();

    fireEvent.click(view.getByTestId("preview-bar.target.email"));
    await view.findByTestId("canvas.frame");
    expect(view.queryByTestId("canvas.page-frame")).toBeNull();
    expect(view.getByTestId("preview-bar.size")).toBeTruthy();
  });

  it("applies the device width to the web page", async () => {
    const view = await mount();
    await toWeb(view);
    fireEvent.click(view.getByTestId("canvas.device.mobile"));
    await waitFor(() => expect(view.getByTestId("canvas.page-frame").style.width).toBe("375px"));
  });

  it("shows a calm empty state while the page is not available", async () => {
    const view = await mount({ pageFails: true });
    fireEvent.click(view.getByTestId("preview-bar.target.web"));
    const empty = await view.findByTestId("canvas.page-unbuilt");
    expect(empty.textContent).toContain("No preview yet");
    expect(view.queryByTestId("canvas.page-frame")).toBeNull();
  });

  it("is session-only", async () => {
    const view = await mount();
    await toWeb(view);
    expect(Object.keys(localStorage).join()).not.toMatch(/target|web/i);
  });
});

describe("web frame", () => {
  it("keeps the selection across the toggle and outlines the page element", async () => {
    const view = await mount();
    const entry = firstAuthored();
    storeOf().getState().actions.select(entry.instancePath);
    await toWeb(view);
    const selection = storeOf().getState().selection;
    expect(selection.kind === "element" && selection.instancePath).toBe(entry.instancePath);
    await waitFor(() =>
      expect(pageDocument(view).querySelector("[data-samva-chip]")).not.toBeNull(),
    );

    fireEvent.click(view.getByTestId("preview-bar.target.email"));
    await view.findByTestId("canvas.frame");
    const back = storeOf().getState().selection;
    expect(back.kind === "element" && back.instancePath).toBe(entry.instancePath);
  });

  it("draws no outline for a selection the page does not render, and keeps it", async () => {
    const entry = (await mockEditor(), undefined);
    void entry;
    const view = await mount({ pageKeeps: (selection) => selection.tag === "html" });
    const selected = firstAuthored();
    storeOf().getState().actions.select(selected.instancePath);
    await toWeb(view);
    expect(pageDocument(view).querySelector("[data-samva-chip]")).toBeNull();
    const selection = storeOf().getState().selection;
    expect(selection.kind === "element" && selection.instancePath).toBe(selected.instancePath);
  });

  it("selects the email element a clicked page element corresponds to, without following links", async () => {
    const view = await mount();
    await toWeb(view);
    const entry = firstAuthored();
    const target = pageDocument(view).querySelector(
      `[${INSTANCE_PATH_ATTRIBUTE}="${entry.instancePath}"]`,
    );
    if (target === null) throw new Error("The page lacks the element");
    fireEvent.click(target);
    await waitFor(() => {
      const selection = storeOf().getState().selection;
      expect(selection.kind === "element" && selection.instancePath).toBe(entry.instancePath);
    });

    const link = pageDocument(view).querySelector("a[href]");
    if (link !== null) expect(fireEvent.click(link)).toBe(false);
  });
});

describe("a web page that failed to render", () => {
  it("asks the host again when the preview is refreshed", async () => {
    const requests = vi.fn();
    const view = await mount({ onPageRequest: requests });
    await toWeb(view);
    expect(requests).toHaveBeenCalledTimes(1);
    storeOf().getState().actions.refreshPreview();
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
  });
});

describe("a text edit that could not be saved", () => {
  it("says so above the web page", async () => {
    const view = await mount();
    await toWeb(view);
    expect(view.queryByTestId("canvas.page-save-error")).toBeNull();
    storeOf().setState({ sourceEditError: "Couldn't save this change. Try again." });
    expect((await view.findByTestId("canvas.page-save-error")).textContent).toContain(
      "Couldn't save this change",
    );
  });
});

describe("a web page behind the email", () => {
  it("ignores a click on a page that is for an earlier revision", async () => {
    const view = await mount();
    await toWeb(view);
    const entry = firstAuthored();
    const page = storeOf().getState().pageRender;
    if (page === null) throw new Error("The page did not render");
    // An edit landed; the page for it has not arrived, so what is on screen is stale.
    storeOf().setState({ pageRender: { ...page, revision: "an-earlier-revision" } });
    storeOf().getState().actions.selectFromPage(entry.instancePath);
    expect(storeOf().getState().selection.kind).not.toBe("element");
  });
});

describe("Email differences", () => {
  it("lists a Chart row that equals the degradation diagnostic", async () => {
    const view = await mount({ chart: true });
    const diagnostics = storeOf()
      .getState()
      .checks.flatMap((check) => check.diagnostics ?? [])
      .filter((item) => item.compatibility?.assessment === "degradation");
    const rows = view.getAllByTestId("checks.email-differences.row");
    expect(rows).toHaveLength(diagnostics.length);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const [diagnostic] = diagnostics;
    expect(diagnostic?.message.startsWith("<Chart>")).toBe(true);
    expect(row?.textContent).toContain("Chart");
    expect(row?.textContent).toContain(diagnostic?.compatibility?.title);
    expect(row?.textContent).toContain(CHART_NOTE);
    expect(row?.textContent).toContain("2 places");
    expect(view.getByTestId("checks.email-differences").textContent).toContain(
      "Some parts of this page are simpler in email.",
    );
  });

  it("says the two match when nothing differs", async () => {
    const view = await mount();
    expect(view.getByTestId("checks.email-differences.empty").textContent).toBe(
      "This looks the same in email and on the web.",
    );
    await toWeb(view);
    expect(view.queryByTestId("preview-bar.differences")).toBeNull();
  });

  it("Show returns to Email and selects the first instance", async () => {
    const view = await mount({ chart: true });
    await toWeb(view);
    fireEvent.click(view.getByTestId("checks.email-differences.show"));
    await view.findByTestId("canvas.frame");
    expect(storeOf().getState().previewTarget).toBe("email");
    const selection = storeOf().getState().selection;
    expect(selection.kind === "element" && selection.instancePath).toBe(
      firstAuthored().instancePath,
    );
  });

  it("offers a chip on Web that opens the Checks tab", async () => {
    const view = await mount({ chart: true });
    expect(view.queryByTestId("preview-bar.differences")).toBeNull();
    await toWeb(view);
    const chip = view.getByTestId("preview-bar.differences");
    expect(chip.textContent).toBe("1 differ in email");
    fireEvent.click(chip);
    expect(storeOf().getState().activeWorkTab).toBe("checks");
  });
});
