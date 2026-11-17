import { afterEach, describe, expect, it } from "@effect/vitest";
import type { EditorEvent, SavedVersion } from "@samva/editor/host";

import { createEditorBundle, saveStatus, type EditorBundle } from "../src/state/store";
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
  await settle();
  return { bundle, original: doc.origin.authoredSource };
};

/** One Design edit that prepends a line, against whatever the draft holds now. */
const design = (bundle: EditorBundle, line: string, coalesceKey?: string): void => {
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

/** A versions capability that records each save and numbers it. */
const numbered = (from = 12) => {
  const saves: Array<{ readonly revision: string }> = [];
  let number = from;
  const save = async (revision: string): Promise<SavedVersion> => {
    saves.push({ revision });
    number += 1;
    return { revision, number };
  };
  return { saves, save };
};

describe("Design edits", () => {
  it("are ordinary changes on the undo history, and keep the preview before the first", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const before = bundle.store.getState().render;
    design(bundle, "// one");
    await flushed(bundle);
    design(bundle, "// two");
    await flushed(bundle);
    const state = bundle.store.getState();
    expect(state.undoHistory).toHaveLength(2);
    expect(state.canvasMode).toBe("point");
    expect(state.designBase?.source).toBe(original);
    expect(state.designBase?.render).toBe(before);
    expect(source(bundle)).toBe(`// two\n// one\n${original}`);
  });

  it("merges consecutive edits under one key into one step and one change", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(withVersions(editor.host, numbered().save));
    design(bundle, "// a", "field");
    design(bundle, "// b", "field");
    await flushed(bundle);
    expect(bundle.store.getState().undoHistory).toHaveLength(1);
    expect(bundle.store.getState().version.changes).toBe(1);
  });

  it("undoes and redoes through the host writer, counting the changes back and forth", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(withVersions(editor.host, numbered().save));
    const { actions } = bundle.store.getState();
    design(bundle, "// one");
    await flushed(bundle);
    design(bundle, "// two");
    await flushed(bundle);
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "unsaved", changes: 2 });
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(`// one\n${original}`);
    expect(bundle.store.getState().version.changes).toBe(1);
    actions.redo();
    await flushed(bundle);
    expect(source(bundle)).toBe(`// two\n// one\n${original}`);
    expect(bundle.store.getState().version.changes).toBe(2);
  });

  it("compares only while there is a base, and lets go of it back at the start", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    const { actions } = bundle.store.getState();
    actions.setDesignCompare(true);
    expect(bundle.store.getState().designCompare).toBe(false);
    design(bundle, "// one");
    actions.setDesignCompare(true);
    expect(bundle.store.getState().designCompare).toBe(true);
    await flushed(bundle);
    design(bundle, "// two");
    expect(bundle.store.getState().designCompare).toBe(false);
    await flushed(bundle);
    actions.undo();
    await flushed(bundle);
    actions.undo();
    await flushed(bundle);
    expect(bundle.store.getState().designBase).toBeNull();
  });

  it("lets Design be left with changes not in a version", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    const { actions } = bundle.store.getState();
    actions.setCanvasMode("design");
    design(bundle, "// one");
    actions.setCanvasMode("point");
    expect(bundle.store.getState().canvasMode).toBe("point");
    expect(bundle.store.getState().undoHistory).toHaveLength(1);
  });

  it("never blocks a source edit, and undo walks both in the order they were made", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const { actions } = bundle.store.getState();
    design(bundle, "// design");
    actions.replaceAuthoredSource(`// source\n${source(bundle)}`);
    expect(bundle.store.getState().sourceEditError).toBeNull();
    expect(source(bundle)).toBe(`// source\n// design\n${original}`);
    await flushed(bundle);
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(`// design\n${original}`);
    actions.undo();
    await flushed(bundle);
    expect(source(bundle)).toBe(original);
  });

  it("waits for an assistant turn before an edit or entering Design", async () => {
    const editor = await mockEditor();
    const { bundle, original } = await start(editor.host);
    const { actions } = bundle.store.getState();
    actions.setHostBusy(true);
    actions.setCanvasMode("design");
    expect(bundle.store.getState().canvasMode).toBe("point");
    design(bundle, "// during a turn");
    expect(source(bundle)).toBe(original);
    expect(bundle.store.getState().sourceEditError).toContain("assistant");
  });

  it("forgets the base and the count when someone else changes the draft", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(withVersions(editor.host, numbered().save));
    design(bundle, "// one");
    await flushed(bundle);
    await emitChange(editor, { origin: "agent", authoredSource: `// agent\n${source(bundle)}` });
    const state = bundle.store.getState();
    expect(state.designBase).toBeNull();
    expect(state.version.changes).toBeNull();
    expect(saveStatus(state)).toEqual({ kind: "unsaved", changes: null });
  });
});

describe("saving a version", () => {
  it("saves the draft once, adopts the version and counts from zero again", async () => {
    const editor = await mockEditor();
    const versions = numbered();
    const events: EditorEvent[] = [];
    const { bundle } = await start({
      ...withVersions(editor.host, versions.save),
      telemetry: (event) => events.push(event),
    });
    design(bundle, "// one");
    await flushed(bundle);
    design(bundle, "// two");
    const saving = bundle.store.getState().actions.saveVersion();
    expect(bundle.store.getState().actions.saveVersion()).toBe(saving);
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "saving" });
    expect(bundle.store.getState().lifecycleBusy).toBe(true);
    const revision = await saving;
    await settle();
    const state = bundle.store.getState();
    expect(versions.saves).toHaveLength(1);
    expect(revision).toBe(versions.saves[0]?.revision);
    expect(state.doc?.rev).toBe(revision);
    expect(state.render?.revision).toBe(revision);
    expect(state.designBase).toBeNull();
    expect(state.version.changes).toBe(0);
    expect(state.lifecycleBusy).toBe(false);
    expect(saveStatus(state)).toEqual({ kind: "saved", number: 13 });
    expect(events).toContainEqual({ name: "version.save", data: { changes: 2 } });
  });

  it("resolves at once when the open revision already is the saved version", async () => {
    const editor = await mockEditor();
    const versions = numbered();
    const { bundle } = await start(withVersions(editor.host, versions.save));
    design(bundle, "// one");
    const first = await bundle.store.getState().actions.saveVersion();
    await settle();
    await expect(bundle.store.getState().actions.saveVersion()).resolves.toBe(first);
    expect(versions.saves).toHaveLength(1);
  });

  it("shows the draft as saved again when undo returns to the saved version", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(withVersions(editor.host, numbered().save));
    design(bundle, "// one");
    await bundle.store.getState().actions.saveVersion();
    await settle();
    design(bundle, "// two");
    await flushed(bundle);
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "unsaved", changes: 1 });
    bundle.store.getState().actions.undo();
    await flushed(bundle);
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "saved", number: 13 });
  });

  it("says why a save failed, keeps the changes, and saves on retry", async () => {
    const editor = await mockEditor();
    let fail = true;
    const { bundle } = await start(
      withVersions(editor.host, async (revision) =>
        fail ? Promise.reject(new Error("Storage is full.")) : { revision, number: 2 },
      ),
    );
    design(bundle, "// one");
    await expect(bundle.store.getState().actions.saveVersion()).rejects.toThrow("Storage is full.");
    const state = bundle.store.getState();
    expect(saveStatus(state)).toEqual({
      kind: "failed",
      reason: "Storage is full.",
      retry: "version",
    });
    expect(state.version.changes).toBe(1);
    expect(state.lifecycleBusy).toBe(false);
    fail = false;
    await bundle.store.getState().actions.saveVersion();
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "saved", number: 2 });
  });

  it("saves no version when the draft's write did not land", async () => {
    const editor = await mockEditor();
    const versions = numbered();
    const { bundle } = await start(withVersions(editor.host, versions.save));
    design(bundle, "// one");
    await emitChange(editor, { origin: "agent", authoredSource: "// elsewhere\n" });
    expect(bundle.store.getState().conflict).toBe(true);
    await expect(bundle.store.getState().actions.saveVersion()).rejects.toBeDefined();
    expect(versions.saves).toEqual([]);
    expect(bundle.store.getState().lifecycleBusy).toBe(false);
  });

  it("only writes the draft without the host's versions", async () => {
    const editor = await mockEditor();
    const { bundle } = await start(editor.host);
    design(bundle, "// one");
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "saving" });
    const revision = await bundle.store.getState().actions.saveVersion();
    await settle();
    expect(revision).toBe(bundle.store.getState().doc?.rev);
    expect(saveStatus(bundle.store.getState())).toEqual({ kind: "saved" });
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
