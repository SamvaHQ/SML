import { afterEach, describe, expect, it } from "@effect/vitest";

import {
  createEditorBundle,
  designVersionMessage,
  designWaiting,
  pendingDesignEdits,
  type EditorBundle,
} from "../src/state/store";
import type { EditorPin } from "../src/state/types";
import { emitChange, mockEditor, settle, withVersions, type MockEditor } from "./mock-host";

const open: EditorBundle[] = [];
afterEach(() => {
  for (const bundle of open.splice(0)) bundle.spine.dispose();
});

const start = async (
  host: MockEditor["host"],
): Promise<{ readonly bundle: EditorBundle; readonly original: string }> => {
  const bundle = createEditorBundle(host, { hostChecks: [] });
  open.push(bundle);
  bundle.spine.open();
  for (let attempt = 0; attempt < 50 && bundle.store.getState().doc === null; attempt += 1)
    await settle(5);
  const doc = bundle.store.getState().doc;
  if (doc === null) throw new Error("the document did not open");
  return { bundle, original: doc.origin.authoredSource };
};

/** Stage one Design edit that prepends a line, against whatever the draft holds now. */
const stage = (bundle: EditorBundle, line: string, coalesceKey?: string): void => {
  const doc = bundle.store.getState().doc;
  if (doc === null) throw new Error("no document");
  bundle.store.getState().actions.applySourceEdit({
    revision: doc.rev,
    source: doc.origin.authoredSource,
    edits: [{ start: 0, end: 0, before: "", after: `${line}\n` }],
    coalesceKey,
    design: { label: line },
  });
};

const flushed = async (bundle: EditorBundle): Promise<void> => {
  await bundle.store.getState().actions.flushSaves();
  await settle();
};

const source = (bundle: EditorBundle): string =>
  bundle.store.getState().doc?.origin.authoredSource ?? "";

describe("Design draft", () => {
  it("stages edits on the draft instead of the source history and turns Design on", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const before = bundle.store.getState().render;
    stage(bundle, "// one");
    await flushed(bundle);
    stage(bundle, "// two");
    await flushed(bundle);
    const state = bundle.store.getState();
    expect(state.canvasMode).toBe("design");
    expect(state.undoHistory).toHaveLength(0);
    expect(pendingDesignEdits(state)).toBe(2);
    expect(state.designDraft?.baseSource).toBe(original);
    expect(state.designDraft?.baseRender).toBe(before);
    expect(source(bundle)).toBe(`// two\n// one\n${original}`);
  });

  it("merges consecutive edits under one key into one staged edit", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    stage(bundle, "// a", "field");
    stage(bundle, "// b", "field");
    await flushed(bundle);
    expect(pendingDesignEdits(bundle.store.getState())).toBe(1);
  });

  it("undoes, redoes and resets the staged edits through the host writer", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const { actions } = bundle.store.getState();
    stage(bundle, "// one");
    await flushed(bundle);
    stage(bundle, "// two");
    await flushed(bundle);
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(`// one\n${original}`);
    expect(pendingDesignEdits(bundle.store.getState())).toBe(1);
    actions.redo();
    await flushed(bundle);
    expect(source(bundle)).toBe(`// two\n// one\n${original}`);
    actions.resetDesign();
    await flushed(bundle);
    expect(source(bundle)).toBe(original);
    expect(bundle.store.getState().designDraft).toBeNull();
  });

  it("refuses to reset over a change made elsewhere and keeps the current work", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    stage(bundle, "// one");
    await flushed(bundle);
    const foreign = `// agent\n${source(bundle)}`;
    await emitChange(editor, { origin: "agent", authoredSource: foreign });
    bundle.store.getState().actions.resetDesign();
    expect(source(bundle)).toBe(foreign);
    expect(bundle.store.getState().sourceEditError).toContain("conflict");
  });

  it("locks compare only while there is something to compare", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    const { actions } = bundle.store.getState();
    actions.setDesignCompare(true);
    expect(bundle.store.getState().designCompare).toBe(false);
    stage(bundle, "// one");
    actions.setDesignCompare(true);
    expect(bundle.store.getState().designCompare).toBe(true);
    await flushed(bundle);
    stage(bundle, "// two");
    expect(bundle.store.getState().designCompare).toBe(false);
  });

  it("keeps Design on while edits are staged", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    const { actions } = bundle.store.getState();
    stage(bundle, "// one");
    actions.setCanvasMode("pin");
    expect(bundle.store.getState().canvasMode).toBe("design");
    await flushed(bundle);
    actions.undo();
    await flushed(bundle);
    actions.setCanvasMode("point");
    expect(bundle.store.getState().canvasMode).toBe("point");
    expect(bundle.store.getState().designDraft).toBeNull();
  });

  it("applies the staged edits as one named version", async () => {
    const editor = await mockEditor();
    const saves: Array<{ revision: string; message: string | undefined }> = [];
    const host = withVersions(editor.host, async (revision, options) => {
      saves.push({ revision, message: options?.message });
      return `${revision}_saved`;
    });
    const { bundle } = await start(host);
    stage(bundle, "// one");
    await flushed(bundle);
    stage(bundle, "// two");
    await flushed(bundle);
    const revision = bundle.store.getState().doc?.rev;
    bundle.store.getState().actions.applyDesign();
    expect(bundle.store.getState().designApply.status).toBe("applying");
    expect(bundle.store.getState().lifecycleBusy).toBe(true);
    await settle(20);
    const state = bundle.store.getState();
    expect(saves).toEqual([{ revision, message: designVersionMessage(2) }]);
    expect(designVersionMessage(1)).toBe("Design: 1 edit");
    expect(state.designDraft).toBeNull();
    expect(state.designApply.status).toBe("idle");
    expect(state.lifecycleBusy).toBe(false);
    expect(state.doc?.rev).toBe(`${revision}_saved`);
  });

  it("keeps the staged edits and says why when Apply fails", async () => {
    const editor = await mockEditor();
    const host = withVersions(editor.host, () => Promise.reject(new Error("Storage is full.")));
    const { bundle } = await start(host);
    stage(bundle, "// one");
    await flushed(bundle);
    bundle.store.getState().actions.applyDesign();
    await settle(20);
    const state = bundle.store.getState();
    expect(state.designApply).toEqual({ status: "failed", reason: "Storage is full." });
    expect(pendingDesignEdits(state)).toBe(1);
    expect(state.lifecycleBusy).toBe(false);
  });
});

describe("Design draft beside other edits", () => {
  it("refuses a source edit while edits are staged and keeps history in order after", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const { actions } = bundle.store.getState();
    stage(bundle, "// design");
    await flushed(bundle);
    actions.replaceAuthoredSource(`// source\n${source(bundle)}`);
    expect(source(bundle)).toBe(`// design\n${original}`);
    expect(bundle.store.getState().sourceEditError).toContain("Apply or reset");
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(original);
    // With nothing staged, a source edit takes the draft's place and undo reverts it.
    actions.replaceAuthoredSource(`// source\n${original}`);
    await flushed(bundle);
    expect(bundle.store.getState().designDraft).toBeNull();
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(original);
  });

  it("starts a new base once every staged edit is undone", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const { actions } = bundle.store.getState();
    stage(bundle, "// one");
    await flushed(bundle);
    actions.undo();
    await flushed(bundle);
    const moved = `// agent\n${original}`;
    await emitChange(editor, { origin: "agent", authoredSource: moved });
    stage(bundle, "// two");
    await flushed(bundle);
    expect(bundle.store.getState().designDraft?.baseSource).toBe(moved);
    actions.resetDesign();
    await flushed(bundle);
    expect(source(bundle)).toBe(moved);
  });

  it("waits for an assistant turn before staging, entering Design or applying", async () => {
    const editor = await mockEditor();
    const saves: string[] = [];
    const host = withVersions(editor.host, async (revision) => {
      saves.push(revision);
      return revision;
    });
    const { bundle } = await start(host);
    const { actions } = bundle.store.getState();
    actions.setHostBusy(true);
    actions.setCanvasMode("design");
    expect(bundle.store.getState().canvasMode).toBe("point");
    stage(bundle, "// during a turn");
    expect(pendingDesignEdits(bundle.store.getState())).toBe(0);
    actions.setHostBusy(false);
    stage(bundle, "// after");
    await flushed(bundle);
    actions.setHostBusy(true);
    actions.applyDesign();
    await settle(20);
    expect(saves).toEqual([]);
    expect(pendingDesignEdits(bundle.store.getState())).toBe(1);
  });
});

describe("Design draft around Apply and Reset", () => {
  it("folds an applied batch into the source history so Undo reverts it whole", async () => {
    const editor = await mockEditor();
    const host = withVersions(editor.host, async (revision) => revision);
    const { bundle, original } = await start(host);
    const { actions } = bundle.store.getState();
    actions.replaceAuthoredSource(`// source\n${original}`);
    await flushed(bundle);
    stage(bundle, "// one");
    await flushed(bundle);
    stage(bundle, "// two");
    await flushed(bundle);
    actions.applyDesign();
    await settle(30);
    expect(bundle.store.getState().designDraft).toBeNull();
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(`// source\n${original}`);
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(original);
  });

  it("keeps the chat waiting until a reset reaches the host", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    stage(bundle, "// one");
    await flushed(bundle);
    bundle.store.getState().actions.resetDesign();
    expect(pendingDesignEdits(bundle.store.getState())).toBe(0);
    expect(designWaiting(bundle.store.getState())).toBe(true);
    bundle.store.getState().actions.setCanvasMode("point");
    expect(bundle.store.getState().canvasMode).toBe("design");
    await flushed(bundle);
    expect(designWaiting(bundle.store.getState())).toBe(false);
  });

  it("saves no version when the staged write did not reach the draft", async () => {
    const editor = await mockEditor();
    const saves: string[] = [];
    const host = withVersions(editor.host, async (revision) => {
      saves.push(revision);
      return revision;
    });
    const { bundle } = await start(host);
    stage(bundle, "// one");
    await emitChange(editor, { origin: "agent", authoredSource: "// elsewhere\n" });
    expect(bundle.store.getState().conflict).toBe(true);
    bundle.store.getState().actions.applyDesign();
    await settle(30);
    const state = bundle.store.getState();
    expect(saves).toEqual([]);
    expect(state.designApply.status).toBe("failed");
    expect(pendingDesignEdits(state)).toBe(1);
    expect(state.conflict).toBe(true);
    expect(state.lifecycleBusy).toBe(false);
  });
});

describe("pins", () => {
  it("numbers pins, renumbers on removal, clears, and reports every change", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    const reported: Array<ReadonlyArray<EditorPin>> = [];
    bundle.setPinsListener((pins) => reported.push(pins));
    const { actions, render } = bundle.store.getState();
    const paths = render?.selections.map((entry) => entry.instancePath) ?? [];
    expect(paths.length).toBeGreaterThan(2);
    actions.addPin(paths[0]!);
    actions.addPin(paths[1]!);
    actions.addPin(paths[2]!);
    actions.addPin("not-rendered");
    const pins = bundle.store.getState().pins;
    expect(pins.map((pin) => pin.number)).toEqual([1, 2, 3]);
    expect(pins[0]).toMatchObject({
      instancePath: paths[0],
      revision: render?.revision,
      note: "",
    });
    actions.setPinNote(pins[1]!.id, "Shorten this");
    actions.removePin(pins[0]!.id);
    const left = bundle.store.getState().pins;
    expect(left.map((pin) => [pin.number, pin.instancePath, pin.note])).toEqual([
      [1, paths[1], "Shorten this"],
      [2, paths[2], ""],
    ]);
    actions.clearPins();
    expect(bundle.store.getState().pins).toEqual([]);
    expect(reported.map((list) => list.length)).toEqual([1, 2, 3, 3, 2, 0]);
  });
});
