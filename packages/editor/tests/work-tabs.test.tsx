/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { useEditorStoreApi } from "../src/state/context";
import { EditorProvider } from "../src/state/provider";
import { ADDED_WORK_TABS, type EditorStore } from "../src/state/store";
import type { CheckItem } from "../src/state/types";
import { emitChange, mockEditor, type MockEditor } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

let capturedStore: EditorStore | null = null;

/** Renders nothing; hands the test the store of the editor it is mounted in. */
function StoreCapture() {
  capturedStore = useEditorStoreApi();
  return null;
}

const storeOf = (): EditorStore => {
  if (capturedStore === null) throw new Error("No editor store captured");
  return capturedStore;
};

/** Mounts a provider over the controlled mock host and waits for its document to open. */
const mount = async (editor?: MockEditor) => {
  const host = editor ?? (await mockEditor());
  const view = render(
    <EditorProvider host={host.host}>
      <StoreCapture />
    </EditorProvider>,
  );
  await waitFor(() => expect(storeOf().getState().doc).not.toBeNull());
  return { ...view, editor: host };
};

const actions = () => storeOf().getState().actions;
const state = () => storeOf().getState();

const CHECK: CheckItem = {
  id: "check:test",
  severity: "warn",
  label: "A check",
  detail: "Something to fix.",
};

describe("work tabs", () => {
  it("starts with Preview only", async () => {
    await mount();
    expect(state().workTabs).toEqual([]);
    expect(state().activeWorkTab).toBe("preview");
  });

  it("adds tabs in the tab-bar order whatever order they open in, and activates each", async () => {
    await mount();
    actions().openWorkTab("checks");
    expect(state().activeWorkTab).toBe("checks");
    actions().openWorkTab("source");
    expect(state().activeWorkTab).toBe("source");
    actions().openWorkTab("review");
    expect(state().activeWorkTab).toBe("review");
    actions().openWorkTab("design");
    expect(state().workTabs).toEqual(ADDED_WORK_TABS);
    expect(state().activeWorkTab).toBe("design");
  });

  it("only activates a tab that is already open", async () => {
    await mount();
    actions().openWorkTab("source");
    actions().openWorkTab("checks");
    const tabs = state().workTabs;
    actions().openWorkTab("source");
    expect(state().workTabs).toBe(tabs);
    expect(state().activeWorkTab).toBe("source");
  });

  it("returns to Preview without adding a tab", async () => {
    await mount();
    actions().openWorkTab("source");
    actions().openWorkTab("preview");
    expect(state().activeWorkTab).toBe("preview");
    expect(state().workTabs).toEqual(["source"]);
  });

  it("activates the tab to the left when the active tab closes", async () => {
    await mount();
    actions().openWorkTab("source");
    actions().openWorkTab("design");
    actions().openWorkTab("checks");
    actions().closeWorkTab("checks");
    expect(state().workTabs).toEqual(["source", "design"]);
    expect(state().activeWorkTab).toBe("design");
    actions().closeWorkTab("design");
    expect(state().activeWorkTab).toBe("source");
  });

  it("activates Preview when the left-most active tab closes", async () => {
    await mount();
    actions().openWorkTab("source");
    actions().openWorkTab("design");
    actions().openWorkTab("source");
    actions().closeWorkTab("source");
    expect(state().workTabs).toEqual(["design"]);
    expect(state().activeWorkTab).toBe("preview");
  });

  it("keeps the active tab when another tab closes", async () => {
    await mount();
    actions().openWorkTab("source");
    actions().openWorkTab("design");
    actions().openWorkTab("checks");
    actions().closeWorkTab("source");
    expect(state().workTabs).toEqual(["design", "checks"]);
    expect(state().activeWorkTab).toBe("checks");
  });

  it("ignores closing a tab that is not open", async () => {
    await mount();
    actions().openWorkTab("source");
    const tabs = state().workTabs;
    actions().closeWorkTab("review");
    expect(state().workTabs).toBe(tabs);
    expect(state().activeWorkTab).toBe("source");
  });

  it("persists the open tabs and restores them on a fresh provider", async () => {
    const first = await mount();
    actions().openWorkTab("checks");
    actions().openWorkTab("source");
    expect(localStorage.getItem("samva.editor.workTabs")).toBe("source,checks");
    expect(localStorage.getItem("samva.editor.workTab")).toBe("source");
    first.unmount();

    await mount();
    expect(state().workTabs).toEqual(["source", "checks"]);
    expect(state().activeWorkTab).toBe("source");
  });

  it("persists a close", async () => {
    await mount();
    actions().openWorkTab("source");
    actions().openWorkTab("design");
    actions().closeWorkTab("design");
    expect(localStorage.getItem("samva.editor.workTabs")).toBe("source");
    expect(localStorage.getItem("samva.editor.workTab")).toBe("source");
  });

  it("falls back to Preview when the persisted active tab is not open or unknown", async () => {
    localStorage.setItem("samva.editor.workTabs", "source");
    localStorage.setItem("samva.editor.workTab", "checks");
    const closed = await mount();
    expect(state().workTabs).toEqual(["source"]);
    expect(state().activeWorkTab).toBe("preview");
    closed.unmount();

    localStorage.setItem("samva.editor.workTab", "nonsense");
    const unknown = await mount();
    expect(state().activeWorkTab).toBe("preview");
    unknown.unmount();

    localStorage.setItem("samva.editor.workTab", "preview");
    await mount();
    expect(state().activeWorkTab).toBe("preview");
  });

  it("drops unknown persisted tab names and keeps tab-bar order", async () => {
    localStorage.setItem("samva.editor.workTabs", "checks,bogus,source");
    await mount();
    expect(state().workTabs).toEqual(["source", "checks"]);
  });
});

describe("work pane entry points", () => {
  it("opens the Source tab and the source view", async () => {
    await mount();
    actions().openSource();
    expect(state().workspaceView).toBe("source");
    expect(state().workTabs).toEqual(["source"]);
    expect(state().activeWorkTab).toBe("source");
  });

  it("opens Review and focuses the preview pane", async () => {
    await mount();
    expect(state().focusedPane).toBe("assistant");
    actions().openReview();
    expect(state().workTabs).toEqual(["review"]);
    expect(state().activeWorkTab).toBe("review");
    expect(state().focusedPane).toBe("preview");
  });

  it("brings the chat into view for a diagnostic request", async () => {
    await mount();
    actions().setChatCollapsed(true);
    actions().setFocusedPane("preview");
    expect(state().chatCollapsed).toBe(true);
    actions().requestDiagnosticAssistance(CHECK);
    expect(state().diagnosticAssistance?.check).toBe(CHECK);
    expect(state().chatCollapsed).toBe(false);
    expect(state().focusedPane).toBe("assistant");
    expect(localStorage.getItem("samva.editor.chatCollapsed")).toBe("false");
  });
});

describe("chat and panes", () => {
  it("persists the chat collapse and restores it", async () => {
    const first = await mount();
    actions().setChatCollapsed(true);
    expect(localStorage.getItem("samva.editor.chatCollapsed")).toBe("true");
    first.unmount();

    await mount();
    expect(state().chatCollapsed).toBe(true);
    actions().setChatCollapsed(false);
    expect(localStorage.getItem("samva.editor.chatCollapsed")).toBe("false");
  });

  it("clamps the assistant width and persists it", async () => {
    await mount();
    actions().setAssistantWidth(100);
    expect(state().assistantWidth).toBe(280);
    actions().setAssistantWidth(900);
    expect(state().assistantWidth).toBe(640);
    expect(localStorage.getItem("samva.editor.assistantWidth")).toBe("640");
    actions().setAssistantWidth(400.4);
    expect(state().assistantWidth).toBe(400);
  });
});

describe("canvas zoom", () => {
  it("clamps a percentage and accepts Fit", async () => {
    await mount();
    actions().setCanvasZoom(30);
    expect(state().canvasZoom).toBe(50);
    actions().setCanvasZoom(250);
    expect(state().canvasZoom).toBe(200);
    actions().setCanvasZoom(133.4);
    expect(state().canvasZoom).toBe(133);
    actions().setCanvasZoom("fit");
    expect(state().canvasZoom).toBe("fit");
  });

  it("fits outside the wide layout and resets to actual size in it", async () => {
    await mount();
    expect(state().layoutMode).toBe("wide");
    actions().setLayoutMode("standard");
    expect(state().canvasZoom).toBe("fit");
    actions().setCanvasZoom(150);
    actions().setLayoutMode("wide");
    expect(state().canvasZoom).toBe(100);
    actions().setLayoutMode("compact");
    expect(state().canvasZoom).toBe("fit");
  });
});

describe("preview unseen", () => {
  it("is set by an agent change only outside the wide layout while the chat is focused", async () => {
    const { editor } = await mount();

    await emitChange(editor, { origin: "agent" });
    expect(state().previewUnseen).toBe(false);

    actions().setLayoutMode("standard");
    actions().setFocusedPane("preview");
    await emitChange(editor, { origin: "agent" });
    expect(state().previewUnseen).toBe(false);

    actions().setFocusedPane("assistant");
    await emitChange(editor, { origin: "agent" });
    expect(state().previewUnseen).toBe(true);

    actions().setFocusedPane("preview");
    expect(state().previewUnseen).toBe(false);
  });

  it("clears when the layout becomes wide or Review opens", async () => {
    const { editor } = await mount();
    actions().setLayoutMode("standard");
    await emitChange(editor, { origin: "agent" });
    expect(state().previewUnseen).toBe(true);
    actions().setLayoutMode("wide");
    expect(state().previewUnseen).toBe(false);

    actions().setLayoutMode("standard");
    await emitChange(editor, { origin: "agent" });
    expect(state().previewUnseen).toBe(true);
    actions().openReview();
    expect(state().previewUnseen).toBe(false);
  });
});

describe("refresh preview", () => {
  it("bumps the epoch and holds the refreshing flag until the snapshot returns", async () => {
    await mount();
    expect(state().previewEpoch).toBe(0);
    expect(state().previewRefreshing).toBe(false);
    actions().refreshPreview();
    expect(state().previewEpoch).toBe(1);
    expect(state().previewRefreshing).toBe(true);
    await waitFor(() => expect(state().previewRefreshing).toBe(false));
    expect(state().previewEpoch).toBe(1);
    expect(state().doc).not.toBeNull();
  });

  it("refuses edits until the reopened snapshot lands", async () => {
    await mount();
    const source = state().doc?.origin.authoredSource;
    if (source === undefined) throw new Error("Editor is not open");
    actions().refreshPreview();
    actions().replaceAuthoredSource(`${source} typed during the reopen`);
    expect(state().pendingAuthoredSource).toBeNull();
    expect(state().doc?.origin.authoredSource).toBe(source);
    await waitFor(() => expect(state().previewRefreshing).toBe(false));
    actions().replaceAuthoredSource(`${source} `);
    expect(state().pendingAuthoredSource).toBe(`${source} `);
  });

  it("waits for a metadata save before reopening the document", async () => {
    await mount();
    actions().rename("Renamed while refreshing");
    expect(state().metadataSaving).toBe(true);
    actions().refreshPreview();
    expect(state().previewEpoch).toBe(0);
    await waitFor(() => expect(state().metadataSaving).toBe(false));
    actions().refreshPreview();
    expect(state().previewEpoch).toBe(1);
  });

  it("does nothing while an edit is still pending", async () => {
    await mount();
    const source = state().doc?.origin.authoredSource;
    if (source === undefined) throw new Error("Editor is not open");
    actions().replaceAuthoredSource(`${source} `);
    expect(state().pendingAuthoredSource).not.toBeNull();
    actions().refreshPreview();
    expect(state().previewEpoch).toBe(0);
    expect(state().previewRefreshing).toBe(false);
  });
});
