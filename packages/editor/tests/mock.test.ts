import { describe, expect, it } from "@effect/vitest";
import {
  DocumentConflict,
  type DocumentChange,
  type EditableEmailDocument,
} from "@samva/editor/host";
import { type EditableEditorHost } from "@samva/editor/host/effect";
import { toAsyncHost } from "@samva/editor/host/effect";
import { createMockHost, MOCK_FIXTURE_NAMES, NIMBUS_WELCOME_TSX } from "@samva/editor/mock";
import {
  emailDefinitionInstances,
  emailSelectionSiblings,
  INSTANCE_PATH_ATTRIBUTE,
} from "@samva/markup/render";
import { Effect } from "effect";

const runMock = () => Effect.runPromise(createMockHost);
const tick = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read the initial document once, in and out of a scope. */
const loadInitial = async (host: EditableEditorHost): Promise<EditableEmailDocument> => {
  const initial = await Effect.runPromise(
    Effect.scoped(host.document.open.pipe(Effect.map((opened) => opened.initial))),
  );
  if (initial.channel !== "email") {
    throw new Error(`mock returned a ${initial.channel} document`);
  }
  return initial;
};

/** The one email payload a change carries, narrowed for assertions. */
const emailChange = (change: DocumentChange) => {
  if (change.channel !== "email") {
    throw new Error(`mock published a ${change.channel} change`);
  }
  return change;
};

/** Open through the async facade and collect every change the mock publishes. */
const openCollecting = async (host: EditableEditorHost) => {
  const asyncHost = toAsyncHost(host);
  const received: DocumentChange[] = [];
  const opened = await asyncHost.document.open((change) => received.push(change));
  return { asyncHost, received, opened };
};

describe("mock document", () => {
  it("loads the Nimbus welcome entry with its declared fixtures and executed render", async () => {
    const { host } = await runMock();
    const doc = await loadInitial(host);

    expect(doc.id).toBe("tpl_nimbus_welcome");
    expect(doc.rev).toBe("rev_1");
    expect(doc.origin).toStrictEqual({
      kind: "tsx",
      file: "src/Welcome.tsx",
      authoredSource: NIMBUS_WELCOME_TSX,
    });
    expect(doc.fixtures).toStrictEqual(MOCK_FIXTURE_NAMES);
    expect(doc.fixture).toBe(MOCK_FIXTURE_NAMES[0]);
    expect(doc.diagnostics).toStrictEqual([]);
    expect(doc.variables.map((variable) => variable.name)).toStrictEqual(["firstName", "claimUrl"]);
    expect(doc.metadata.fromDefault).toStrictEqual({
      email: "hello@nimbus.coffee",
      name: "Nimbus Coffee",
    });
  });

  it("stamps every rendered element so a click resolves to exactly one selection", async () => {
    const { host } = await runMock();
    const { render } = await loadInitial(host);
    expect(render).not.toBeNull();
    if (render === null) return;

    expect(render.revision).toBe("rev_1");
    for (const selection of render.selections) {
      expect(render.html).toContain(`${INSTANCE_PATH_ATTRIBUTE}="${selection.instancePath}"`);
    }
    // Document order, so a parent always precedes its children.
    expect(render.selections.map((selection) => selection.instancePath)).toStrictEqual([
      "0",
      "0.0",
      "0.0.0",
      "0.0.1",
      "0.0.2",
      "0.0.3",
      "0.0.3.0",
      "0.0.4",
      "0.0.4.0",
      "0.0.4.0.0",
      "0.0.4.1",
      "0.0.4.1.0",
      "0.0.4.2",
      "0.0.4.2.0",
      "0.0.5",
      "0.0.5.0",
      "0.0.5.0.0",
    ]);
  });

  it("names a generated wrapper by the authoring that asked for it", async () => {
    const { host } = await runMock();
    const { render } = await loadInitial(host);
    const wrapper = render?.selections.find((selection) => selection.instancePath === "0.0.3");
    const anchor = render?.selections.find((selection) => selection.instancePath === "0.0.3.0");

    expect(wrapper?.tag).toBe("table");
    expect(wrapper?.authored).toBe(false);
    // The Outlook wrapper is not authored markup, so its first origin is the
    // Button call the author actually wrote — the same one the anchor reports.
    expect(wrapper?.origins[0]).toStrictEqual(anchor?.origins[0]);
    expect(anchor?.authored).toBe(true);
  });

  it("separates the iterations of one call site from the whole shared definition", async () => {
    const { host } = await runMock();
    const { render } = await loadInitial(host);
    const selections = render?.selections ?? [];
    const cells = selections.filter((selection) => selection.tag === "td");
    const [first] = cells;

    expect(first).toBeDefined();
    if (first === undefined) return;
    // Four cells, one authored element: the map's three plus the footer's one.
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((cell) => JSON.stringify(cell.origins[0]))).size).toBe(1);
    // Only three of them came through the loop's call site, and only the
    // instance path tells those three apart.
    expect(emailSelectionSiblings(selections, first)).toHaveLength(3);
    expect(cells.slice(0, 3).map((cell) => cell.occurrence)).toStrictEqual([1, 2, 3]);
    expect(cells.slice(0, 3).every((cell) => cell.occurrences === 3)).toBe(true);
    // Editing the definition reaches every one of them.
    expect(emailDefinitionInstances(selections, first)).toHaveLength(4);
  });
});

describe("mock save", () => {
  it("mints a new rev and publishes a self change carrying the whole payload", async () => {
    const { host } = await runMock();
    const { asyncHost, received, opened } = await openCollecting(host);
    const nextAuthoredSource = NIMBUS_WELCOME_TSX.replace(
      "your first bag is on us",
      "your first coffee is on us",
    );

    const { rev } = await asyncHost.writer.save({
      kind: "authoredSource",
      baseRev: "rev_1",
      authoredSource: nextAuthoredSource,
    });
    await tick();
    expect(rev).toBe("rev_2");
    expect(received).toHaveLength(1);

    const change = emailChange(received[0]!);
    expect(change.origin).toBe("self");
    expect(change.rev).toBe("rev_2");
    expect(change.authoredSource).toBe(nextAuthoredSource);
    expect(change.render?.revision).toBe("rev_2");
    expect(change.fixtures).toStrictEqual(MOCK_FIXTURE_NAMES);
    opened.close();
  });

  it("fails with DocumentConflict on a stale baseRev", async () => {
    const { host } = await runMock();
    const error = await Effect.runPromise(
      host.writer
        .save({
          kind: "authoredSource",
          baseRev: "rev_stale",
          authoredSource: NIMBUS_WELCOME_TSX,
        })
        .pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(DocumentConflict);
    if (error instanceof DocumentConflict) {
      expect(error.expectedRev).toBe("rev_stale");
      expect(error.actualRev).toBe("rev_1");
    }
  });
});

describe("mock metadata save (not versioned with source)", () => {
  it("keeps the rev so a source save with the pre-rename rev still succeeds", async () => {
    const { host } = await runMock();

    const renamed = await Effect.runPromise(
      host.writer.save({ kind: "metadata", patch: { name: "Renamed" } }),
    );
    expect(renamed.rev).toBe("rev_1"); // rev unchanged by a metadata save

    // The next authored-source save uses the ORIGINAL pre-rename rev and must NOT conflict.
    const saved = await Effect.runPromise(
      host.writer.save({
        kind: "authoredSource",
        baseRev: "rev_1",
        authoredSource: NIMBUS_WELCOME_TSX,
      }),
    );
    expect(saved.rev).toBe("rev_2");

    const doc = await loadInitial(host);
    expect(doc.name).toBe("Renamed");
  });

  it("emits no change on the stream", async () => {
    const { host } = await runMock();
    const { asyncHost, received, opened } = await openCollecting(host);

    await asyncHost.writer.save({ kind: "metadata", patch: { name: "Renamed" } });
    await tick();
    expect(received).toHaveLength(0);
    opened.close();
  });
});

describe("mock fixtures", () => {
  it("re-renders another declared fixture at the SAME revision", async () => {
    const { host } = await runMock();
    const { received, opened } = await openCollecting(host);
    expect(host.fixtures?.status).toBe("ready");
    if (host.fixtures?.status !== "ready") expect.fail("expected ready fixture controls");

    await Effect.runPromise(host.fixtures.api.view("returning"));
    await tick();

    const change = emailChange(received[0]!);
    expect(change.origin).toBe("self");
    expect(change.rev).toBe("rev_1");
    expect(change.fixture).toBe("returning");
    // A fixture switch changes what is rendered, never the workspace revision.
    expect(change.render?.revision).toBe("rev_1");
    expect(change.render?.subject).toContain("Grace");
    opened.close();
  });

  it("ignores a fixture the template does not declare", async () => {
    const { host } = await runMock();
    const { received, opened } = await openCollecting(host);
    if (host.fixtures?.status !== "ready") expect.fail("expected ready fixture controls");

    await Effect.runPromise(host.fixtures.api.view("nonexistent"));
    await tick();
    expect(received).toHaveLength(0);
    expect((await loadInitial(host)).fixture).toBe(MOCK_FIXTURE_NAMES[0]);
    opened.close();
  });
});

describe("mock external mutation hook", () => {
  it("publishes an agent change and moves the loaded entry with it", async () => {
    const { host, emit } = await runMock();
    const { received, opened } = await openCollecting(host);
    const agentSource = NIMBUS_WELCOME_TSX.replace("small batches", "tiny batches");

    await Effect.runPromise(emit({ origin: "agent", authoredSource: agentSource }));
    await tick();

    const change = emailChange(received[0]!);
    expect(change.origin).toBe("agent");
    expect(change.rev).toBe("rev_2");
    expect(change.authoredSource).toBe(agentSource);
    opened.close();

    expect((await loadInitial(host)).origin.authoredSource).toBe(agentSource);
  });

  it("reports an entry that stopped building as a null render with a diagnostic", async () => {
    const { host, emit } = await runMock();
    const { received, opened } = await openCollecting(host);

    await Effect.runPromise(emit({ origin: "external", broken: true }));
    await tick();

    const change = emailChange(received[0]!);
    expect(change.render).toBeNull();
    expect(change.fixtures).toStrictEqual([]);
    expect(change.fixture).toBeNull();
    expect(change.diagnostics.map((diagnostic) => diagnostic.code)).toStrictEqual([
      "entry-did-not-build",
    ]);
    expect(change.diagnostics[0]?.origins[0]?.fileName).toBe("src/Welcome.tsx");
    opened.close();
  });
});

describe("mock capabilities", () => {
  it("exposes a two-entry font catalog and uploads images", async () => {
    const { host } = await runMock();
    expect(host.assets?.status).toBe("ready");
    if (host.assets?.status === "ready") {
      const fonts = await Effect.runPromise(host.assets.api.fonts.catalog);
      expect(fonts).toHaveLength(2);
      const upload = await Effect.runPromise(
        host.assets.api.uploadImage({
          name: "hero.jpg",
          contentType: "image/jpeg",
          data: new Uint8Array([1]),
        }),
      );
      expect(upload.url).toContain("hero.jpg");
    }
  });
});
