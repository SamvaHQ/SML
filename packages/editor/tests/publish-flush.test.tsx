/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { contractVersion, type EditableEditorDocument } from "@samva/editor/host";
import type { AsyncEditorHost } from "@samva/editor/host";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import { EditorProvider } from "../src/state/provider";
import { useEditorProbe, type EditorProbe } from "./store-probe";

afterEach(cleanup);

type Api = EditorProbe;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const INITIAL: EditableEditorDocument = {
  id: "tpl_1",
  name: "Welcome",
  rev: "rev_1",
  origin: {
    kind: "tsx",
    file: "src/Welcome.tsx",
    authoredSource: "export default () => <Email />",
  },
  access: { kind: "editable" },
  variables: [],
  metadata: {},
  channel: "email",
  preview: { status: "current" },
  fixtures: ["welcome"],
  fixture: "welcome",
  render: {
    revision: "rev_1",
    subject: "Welcome",
    html: '<body data-samva-instance="0"><h1 data-samva-instance="0.0">Old</h1></body>',
    text: "Old",
    selections: [],
  },
  diagnostics: [],
  incompatibilities: [],
};

const mount = (host: AsyncEditorHost) => {
  const ref: { current: Api | null } = { current: null };
  function Probe() {
    ref.current = useEditorProbe();
    return null;
  }
  render(
    <EditorProvider host={host}>
      <Probe />
    </EditorProvider>,
  );
  return (): Api => {
    if (ref.current === null) throw new Error("context not mounted");
    return ref.current;
  };
};

describe("flushSaves — publish waits for pending saves", () => {
  it("resolves immediately when nothing is queued", async () => {
    const host: AsyncEditorHost = {
      contractVersion,
      access: "editable",
      sourceAccess: "editable",
      document: {
        open: async () => ({ initial: INITIAL, close: () => {} }),
      },
      writer: {
        save: () => Promise.resolve({ rev: "rev_1" }),
      },
    };
    const api = mount(host);
    await waitFor(() => expect(api().doc).not.toBeNull());

    let flushed = false;
    let revision = "";
    await api()
      .flushSaves()
      .then((acked) => {
        flushed = true;
        revision = acked;
      });
    expect(flushed).toBe(true);
    expect(revision).toBe("rev_1");
  });

  it("stays pending until the in-flight save acks, then resolves", async () => {
    // The host's save is gated so the persist stays in flight — flushSaves must
    // not resolve until it acks, which is exactly what publish awaits.
    const gate = deferred<{ rev: string }>();
    const host: AsyncEditorHost = {
      contractVersion,
      access: "editable",
      sourceAccess: "editable",
      document: {
        open: async () => ({ initial: INITIAL, close: () => {} }),
      },
      writer: {
        save: () => gate.promise,
      },
    };
    const api = mount(host);
    await waitFor(() => expect(api().doc).not.toBeNull());

    // Queue a persist; the drain calls host.save and blocks on the gate.
    act(() => api().replaceAuthoredSource("export default () => <Email><Text>New</Text></Email>"));

    let flushed = false;
    let revision = "";
    const flushing = api()
      .flushSaves()
      .then((acked) => {
        flushed = true;
        revision = acked;
      });
    // A microtask turn is enough for a premature resolve to surface.
    await Promise.resolve();
    expect(flushed).toBe(false);

    // Ack the save → the drain settles → flushSaves resolves.
    await act(async () => {
      gate.resolve({ rev: "rev_2" });
      await flushing;
    });
    expect(flushed).toBe(true);
    expect(revision).toBe("rev_2");
  });
});
