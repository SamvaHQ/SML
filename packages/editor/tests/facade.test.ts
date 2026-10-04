import { describe, expect, it } from "@effect/vitest";
import {
  contractVersion,
  DocumentUnavailable,
  ProjectFileExists,
  type DocumentChange,
  type DocumentError,
  type EditableEmailDocument,
  type EmailRender,
  type ReadonlyEmailDocument,
} from "@samva/editor/host";
import {
  type DocumentReader,
  type DocumentWriter,
  type EditableEditorHost,
} from "@samva/editor/host/effect";
import { toAsyncHost } from "@samva/editor/host/effect";
import { Effect, PubSub, Ref, Stream } from "effect";

const tick = (ms = 50) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const renderAt = (revision: string): EmailRender => ({
  revision,
  subject: "Welcome",
  html: '<body data-samva-instance="0"></body>',
  text: "Welcome",
  selections: [
    {
      instancePath: "0",
      tag: "body",
      origins: [{ fileName: "src/Welcome.tsx", lineNumber: 1, columnNumber: 1 }],
      authored: false,
      occurrence: 1,
      occurrences: 1,
      start: 0,
      end: 40,
    },
  ],
});

const sampleDoc: EditableEmailDocument = {
  id: "tpl_1",
  name: "Welcome",
  channel: "email",
  preview: { status: "current" },
  origin: {
    kind: "tsx",
    file: "src/Welcome.tsx",
    authoredSource: "export default () => <Email />",
  },
  access: { kind: "editable" },
  rev: "rev_1",
  fixtures: ["welcome"],
  fixture: "welcome",
  render: renderAt("rev_1"),
  diagnostics: [],
  incompatibilities: [],
  variables: [],
  metadata: {},
};

const readonlyDoc: ReadonlyEmailDocument = {
  ...sampleDoc,
  access: { kind: "readonly", reason: "This template is managed in code." },
};

const change = (origin: DocumentChange["origin"], rev: string): DocumentChange => ({
  rev,
  origin,
  authoredSource: sampleDoc.origin.authoredSource,
  channel: "email",
  preview: { status: "current" },
  fixtures: sampleDoc.fixtures,
  fixture: sampleDoc.fixture,
  render: renderAt(rev),
  diagnostics: [],
  incompatibilities: [],
});

// Store whose `open` attaches the PubSub subscription before reading the snapshot —
// mirrors the mock and every real host.
const makeHost = Effect.gen(function* () {
  const changes = yield* PubSub.unbounded<DocumentChange>();
  const revRef = yield* Ref.make("rev_1");
  const document: DocumentReader<EditableEmailDocument> = {
    open: Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const rev = yield* Ref.get(revRef);
      return {
        initial: { ...sampleDoc, rev },
        changes: Stream.fromEffectRepeat(PubSub.take(subscription)),
      };
    }),
  };
  const writer: DocumentWriter = {
    save: Effect.fnUntraced(function* () {
      const next = "rev_2";
      yield* Ref.set(revRef, next);
      yield* PubSub.publish(changes, change("self", next));
      return { rev: next };
    }),
  };
  const host: EditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document,
    writer,
  };
  return { host, changes };
});

describe("toAsyncHost document", () => {
  it("resolves open (initial) and save through runPromise", async () => {
    const { host } = await Effect.runPromise(makeHost);
    const asyncHost = toAsyncHost(host);
    expect(asyncHost.contractVersion).toBe(contractVersion);
    expect(asyncHost.sourceAccess).toBe("editable");
    const opened = await asyncHost.document.open(() => {});
    expect(opened.initial).toStrictEqual(sampleDoc);
    expect(
      await asyncHost.writer.save({
        kind: "authoredSource",
        baseRev: "rev_1",
        authoredSource: "export default () => <Email />",
      }),
    ).toStrictEqual({
      rev: "rev_2",
    });
    opened.close();
  });

  it("delivers a change published immediately after open, with no missed window", async () => {
    const { host, changes } = await Effect.runPromise(makeHost);
    const asyncHost = toAsyncHost(host);

    const received: DocumentChange[] = [];
    let resolveFirst!: (change: DocumentChange) => void;
    const firstChange = new Promise<DocumentChange>((resolve) => {
      resolveFirst = resolve;
    });
    const { close } = await asyncHost.document.open((delivered) => {
      received.push(delivered);
      resolveFirst(delivered);
    });

    // No tick between open resolving and this publish: if the subscription were
    // not already attached, the change would be lost. Delivery is awaited on a
    // promise, not a timer, so there is no race in the assertion either.
    await Effect.runPromise(PubSub.publish(changes, change("agent", "rev_2")));
    const delivered = await firstChange;
    expect(delivered.origin).toBe("agent");
    expect(delivered.channel).toBe("email");

    // No tick between close() and the next publish: the synchronous guard must
    // stop delivery immediately, even though fiber interruption is async. The
    // trailing tick gives any zombie delivery every chance to (wrongly) land.
    close();
    await Effect.runPromise(PubSub.publish(changes, change("external", "rev_3")));
    await tick();
    expect(received.map((c) => c.origin)).toStrictEqual(["agent"]);
  });
});

describe("toAsyncHost open completion signal", () => {
  it("fires onComplete and releases the document scope when the change stream ends", async () => {
    let released = 0;
    const document: DocumentReader<ReadonlyEmailDocument> = {
      open: Effect.acquireRelease(
        Effect.succeed({ initial: readonlyDoc, changes: Stream.empty }),
        () => Effect.sync(() => released++),
      ),
    };
    const asyncHost = toAsyncHost({
      contractVersion,
      access: "readonly",
      sourceAccess: "readonly",
      document,
    });
    expect(asyncHost.sourceAccess).toBe("readonly");
    expect("writer" in asyncHost).toBe(false);

    let completed = false;
    await asyncHost.document.open(
      () => {},
      undefined,
      () => {
        completed = true;
      },
    );
    await tick();
    expect(completed).toBe(true);
    expect(released).toBe(1);
  });

  it("releases the document scope without firing onComplete on close()", async () => {
    let released = 0;
    const document: DocumentReader<EditableEmailDocument> = {
      open: Effect.acquireRelease(
        Effect.succeed({ initial: sampleDoc, changes: Stream.never }),
        () => Effect.sync(() => released++),
      ),
    };
    const host: EditableEditorHost = {
      contractVersion,
      access: "editable",
      sourceAccess: "editable",
      document,
      writer: { save: () => Effect.succeed({ rev: "rev_2" }) },
    };
    const asyncHost = toAsyncHost(host);

    let completed = false;
    const { close } = await asyncHost.document.open(
      () => {},
      undefined,
      () => {
        completed = true;
      },
    );
    close();
    await tick();
    expect(completed).toBe(false);
    expect(released).toBe(1);
  });
});

describe("toAsyncHost open error path", () => {
  it("releases the document scope when opening fails", async () => {
    let released = 0;
    const document: DocumentReader<ReadonlyEmailDocument> = {
      open: Effect.acquireRelease(Effect.void, () => Effect.sync(() => released++)).pipe(
        Effect.andThen(Effect.fail(new DocumentUnavailable({ reason: "attach failed" }))),
      ),
    };
    const asyncHost = toAsyncHost({
      contractVersion,
      access: "readonly",
      sourceAccess: "readonly",
      document,
    });

    const error = await asyncHost.document.open(() => {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentUnavailable);
    expect(error).toMatchObject({ reason: "attach failed" });
    expect(released).toBe(1);
  });

  it("routes a stream failure to onError", async () => {
    let released = 0;
    const document: DocumentReader<ReadonlyEmailDocument> = {
      open: Effect.acquireRelease(
        Effect.succeed({
          initial: readonlyDoc,
          changes: Stream.fail(new DocumentUnavailable({ reason: "boom" })),
        }),
        () => Effect.sync(() => released++),
      ),
    };
    const asyncHost = toAsyncHost({
      contractVersion,
      access: "readonly",
      sourceAccess: "readonly",
      document,
    });

    const errors: DocumentError[] = [];
    await asyncHost.document.open(
      () => {},
      (error) => errors.push(error),
    );
    await tick();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(DocumentUnavailable);
    expect(released).toBe(1);
  });
});

const baseHost = (): EditableEditorHost => ({
  contractVersion,
  access: "editable",
  sourceAccess: "editable",
  document: { open: Effect.succeed({ initial: sampleDoc, changes: Stream.empty }) },
  writer: { save: () => Effect.succeed({ rev: "rev_2" }) },
});

describe("toAsyncHost fixtures", () => {
  it("maps the fixture view onto a promise and keeps the host's own return void", async () => {
    const viewed: string[] = [];
    const asyncHost = toAsyncHost({
      ...baseHost(),
      fixtures: {
        status: "ready",
        api: { view: (fixture) => Effect.sync(() => void viewed.push(fixture)) },
      },
    });
    expect(asyncHost.fixtures?.status).toBe("ready");
    if (asyncHost.fixtures?.status !== "ready") return;
    // The render arrives on the change stream, so the call itself resolves to nothing.
    expect(await asyncHost.fixtures.api.view("returning")).toBeUndefined();
    expect(viewed).toStrictEqual(["returning"]);
  });

  it("rejects with the host's typed error when the fixture cannot be rendered", async () => {
    const asyncHost = toAsyncHost({
      ...baseHost(),
      fixtures: {
        status: "ready",
        api: { view: () => Effect.fail(new DocumentUnavailable({ reason: "no such fixture" })) },
      },
    });
    if (asyncHost.fixtures?.status !== "ready") return;
    const error = await asyncHost.fixtures.api.view("missing").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentUnavailable);
  });

  it("passes a locked capability through untouched, with no api to call", () => {
    const upsell = {
      reason: "Multiple fixtures are on the Pro plan.",
      cta: { label: "Upgrade", href: "/billing" },
    };
    const asyncHost = toAsyncHost({ ...baseHost(), fixtures: { status: "locked", upsell } });
    expect(asyncHost.fixtures).toStrictEqual({ status: "locked", upsell });
  });

  it("omits the capability entirely when the host declares none", () => {
    expect(toAsyncHost(baseHost()).fixtures).toBeUndefined();
  });
});

describe("toAsyncHost lifecycle", () => {
  it("mechanically maps the Git project lifecycle", async () => {
    const publishedAt = new Date("2026-07-10T00:00:00.000Z");
    const restoredSource = "export default function Initial() {}";
    const host: EditableEditorHost = {
      ...baseHost(),
      lifecycle: {
        status: "ready",
        api: {
          inspect: Effect.succeed({
            rev: "rev_1",
            baseCommit: "a".repeat(40),
            remoteHead: "a".repeat(40),
            dirty: false,
            files: [],
            conflicts: [],
            commits: [],
          }),
          publish: () =>
            Effect.succeed({
              publicationId: "publication_2",
              commit: "a".repeat(40),
              publishedAt,
            }),
          // Restoring stages a commit: it answers with the revision and the
          // authored entry the editor must now show, never with emitted output.
          restore: () => Effect.succeed({ rev: "rev_3", authoredSource: restoredSource }),
          resolveConflict: () =>
            Effect.succeed({
              rev: "rev_4",
              baseCommit: "a".repeat(40),
              remoteHead: "a".repeat(40),
              dirty: true,
              files: [],
              conflicts: [],
              commits: [],
            }),
          updateFile: () =>
            Effect.succeed({
              rev: "rev_5",
              baseCommit: "a".repeat(40),
              remoteHead: "a".repeat(40),
              dirty: true,
              files: [],
              conflicts: [],
              commits: [],
            }),
          putAsset: (input) =>
            input.replace
              ? Effect.succeed({
                  rev: "rev_6",
                  baseCommit: "a".repeat(40),
                  remoteHead: "a".repeat(40),
                  dirty: true,
                  files: [{ path: input.path, status: "modified", content: null, binary: true }],
                  conflicts: [],
                  commits: [],
                })
              : Effect.fail(new ProjectFileExists({ path: input.path, reason: "exists" })),
        },
      },
    };
    const lifecycle = toAsyncHost(host).lifecycle;
    expect(lifecycle?.status).toBe("ready");
    if (lifecycle?.status !== "ready") return;
    expect(await lifecycle.api.inspect()).toMatchObject({ rev: "rev_1" });
    expect(await lifecycle.api.publish({ baseRev: "rev_1", commit: "a".repeat(40) })).toMatchObject(
      { publicationId: "publication_2" },
    );
    expect(await lifecycle.api.restore({ commit: "9".repeat(40), baseRev: "rev_2" })).toStrictEqual(
      {
        rev: "rev_3",
        authoredSource: restoredSource,
      },
    );
    expect(
      await lifecycle.api.updateFile({ path: "theme.ts", baseRev: "rev_4", content: "theme" }),
    ).toMatchObject({ rev: "rev_5" });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(
      await lifecycle.api.putAsset({
        path: "assets/logo.png",
        baseRev: "rev_5",
        bytes,
        replace: true,
      }),
    ).toMatchObject({ rev: "rev_6", files: [{ path: "assets/logo.png", binary: true }] });
    // The sheet tells a taken path apart from other failures by the rejection's tag.
    await expect(
      lifecycle.api.putAsset({ path: "assets/logo.png", baseRev: "rev_5", bytes, replace: false }),
    ).rejects.toMatchObject({ _tag: "ProjectFileExists", path: "assets/logo.png" });
  });
});

describe("toAsyncHost versions", () => {
  it("maps saving a version and reading the saved head onto promises", async () => {
    const host = toAsyncHost({
      ...baseHost(),
      versions: {
        status: "ready",
        api: {
          save: (revision) => Effect.succeed(`${revision}_saved`),
          savedRevision: Effect.succeed("rev_2_saved"),
        },
      },
    });
    if (host.versions?.status !== "ready") throw new Error("expected versions");
    await expect(host.versions.api.save("rev_2")).resolves.toBe("rev_2_saved");
    await expect(host.versions.api.savedRevision()).resolves.toBe("rev_2_saved");
  });
});
