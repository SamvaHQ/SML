import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
// oxlint-disable-next-line eslint/no-restricted-imports -- inject a disk-sync failure or concurrent writer while retaining real filesystem I/O.
import { vi } from "vitest";

import {
  documentId,
  EDITOR_MAX_SOURCE_BYTES,
  EDITOR_SOURCE_TOO_LARGE_MESSAGE,
  EditorFileStore,
  parseDocumentId,
  type StoreChange,
} from "../src/editor-store";
import {
  cleanupProjects,
  emailTemplate,
  multiChannelTemplate,
  SIGNATURE_PARTIAL,
  tempProject,
} from "./support/project";

const diskSync = vi.hoisted(() => ({ before: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args);
      if (String(args[0]).endsWith(".tmp")) {
        const sync = file.sync.bind(file);
        file.sync = async () => {
          await diskSync.before?.();
          await sync();
        };
      }
      return file;
    },
  };
});

const WELCOME = emailTemplate("welcome", "Welcome", {
  imports: 'import { Signature } from "../components/signature";',
  body: '<Email><p className="text-brand">Welcome, {input.name}</p><Signature /></Email>',
});

describe("EditorFileStore", () => {
  let root: string;
  let store: EditorFileStore;
  let welcomePath: string;

  beforeEach(async () => {
    diskSync.before = undefined;
    root = await tempProject({
      "templates/welcome.tsx": WELCOME,
      "templates/nested/order.tsx": multiChannelTemplate("order"),
      "templates/notes.md": "not a template\n",
      "templates/helpers.tsx": "export const x = 1;\n",
      "components/signature.tsx": SIGNATURE_PARTIAL,
      "theme.css": "@theme { --color-brand: #123456; }\n",
    });
    welcomePath = join(root, "templates/welcome.tsx");
    store = new EditorFileStore({ root });
  });

  afterEach(cleanupProjects);

  it("lists one document per channel, sorted, with derived names", async () => {
    const list = await store.list();
    expect(list.map((template) => template.id)).toEqual([
      "templates/nested/order.tsx",
      "templates/nested/order.tsx#sms",
      "templates/nested/order.tsx#whatsapp",
      "templates/welcome.tsx",
    ]);
    expect(list.map((template) => template.channel)).toEqual(["email", "sms", "whatsapp", "email"]);
    expect(list.map((template) => template.name)).toEqual(["order", "order", "order", "welcome"]);
    expect(list.every((template) => template.sourceKind === "tsx")).toBe(true);
  });

  it("names a document by entry path and channel", () => {
    expect(documentId("templates/a.tsx", "email")).toBe("templates/a.tsx");
    expect(documentId("templates/a.tsx", "sms")).toBe("templates/a.tsx#sms");
    expect(parseDocumentId("templates/a.tsx#whatsapp")).toEqual({
      file: "templates/a.tsx",
      channel: "whatsapp",
    });
    expect(parseDocumentId("templates/a.tsx")).toEqual({
      file: "templates/a.tsx",
      channel: "email",
    });
  });

  it("scans emails/ as well as templates/", async () => {
    await mkdir(join(root, "emails"));
    await writeFile(join(root, "emails/receipt.tsx"), emailTemplate("receipt"));
    const list = await new EditorFileStore({ root }).list();
    expect(list.map((template) => template.id)).toContain("emails/receipt.tsx");
    const only = await new EditorFileStore({ root, dir: "emails" }).list();
    expect(only.map((template) => template.id)).toEqual(["emails/receipt.tsx"]);
  });

  it("opens an email document as authored code plus one stamped render of a declared fixture", async () => {
    const snapshot = (await store.open("templates/welcome.tsx"))!;
    expect(snapshot).toMatchObject({
      id: null,
      name: "welcome",
      channel: "email",
      preview: { status: "current" },
      fixtures: ["first", "second"],
      fixture: "first",
      variables: [{ name: "name", required: true, sample: "Ada" }],
      origin: { kind: "tsx", file: "templates/welcome.tsx", authoredSource: WELCOME },
      access: { kind: "editable" },
      diagnostics: [],
    });
    expect(snapshot.channel === "email" && snapshot.render).toMatchObject({
      revision: snapshot.rev,
      subject: "Welcome, Ada",
      preheader: "Preview",
    });
    if (snapshot.channel !== "email" || snapshot.render === null)
      throw new Error("expected render");
    expect(snapshot.render.html).toContain("data-samva-instance=");
    expect(snapshot.render.html).toContain("#123456");
    expect(snapshot.render.html).toContain("The Samva team");
    // Every selection resolves to the authored element that produced it.
    const paragraph = snapshot.render.selections.find((item) => item.tag === "p" && item.authored);
    expect(paragraph?.origins[0]?.fileName).toBe("templates/welcome.tsx");
  });

  it("opens the SMS and WhatsApp documents of a multi-channel template", async () => {
    const sms = (await store.open("templates/nested/order.tsx#sms"))!;
    expect(sms).toMatchObject({
      channel: "sms",
      fixtures: ["first"],
      fixture: "first",
      render: { text: "Hi Ada, your order shipped." },
      origin: { file: "templates/nested/order.tsx" },
      access: { kind: "editable" },
    });
    const whatsapp = (await store.open("templates/nested/order.tsx#whatsapp"))!;
    expect(whatsapp).toMatchObject({
      channel: "whatsapp",
      render: {
        body: "Hi Ada, your order shipped.",
        language: "en_US",
        buttons: [{ type: "quick-reply", text: "Thanks" }],
      },
    });
    expect(sms.rev).not.toBe(whatsapp.rev);
    expect(sms.origin.authoredSource).toBe(whatsapp.origin.authoredSource);
  });

  it("refuses ids outside the templates dir and non-tsx paths", async () => {
    expect(await store.open("../secret.tsx")).toBeUndefined();
    expect(await store.open("templates/notes.md")).toBeUndefined();
    expect(await store.open("templates/helpers.tsx")).toBeUndefined();
    expect(await store.saveSource("components/signature.tsx", "x", "// nope")).toMatchObject({
      ok: false,
      kind: "missing",
    });
  });

  it("saves canonical source, attributes its change, and reopens the saved entry", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));
    const source = `// saved in editor\n${WELCOME}`;
    const saved = await store.saveSource("templates/welcome.tsx", initial.rev, source, "local-tab");
    expect(saved.ok).toBe(true);
    expect(await readFile(welcomePath, "utf8")).toBe(source);
    const reopened = (await store.open("templates/welcome.tsx"))!;
    expect(reopened.origin.authoredSource).toBe(source);
    expect(reopened.rev).not.toBe(initial.rev);
    expect(changes).toContainEqual(
      expect.objectContaining({
        sourceClient: "local-tab",
        authoredSource: source,
        rev: reopened.rev,
      }),
    );
    expect(await store.saveSource("templates/welcome.tsx", initial.rev, WELCOME)).toMatchObject({
      ok: false,
      kind: "conflict",
    });
  });

  it("recompiles on save so the new copy is what the document renders", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    await store.saveSource(
      "templates/welcome.tsx",
      initial.rev,
      WELCOME.replace("Welcome, {input.name}", "Greetings, {input.name}"),
    );
    const reopened = (await store.open("templates/welcome.tsx"))!;
    expect(reopened.channel === "email" && reopened.render?.html).toContain("Greetings, Ada");
  });

  it("saves from the SMS document into the same file and moves every channel's revision", async () => {
    const path = join(root, "templates/nested/order.tsx");
    const sms = (await store.open("templates/nested/order.tsx#sms"))!;
    const email = (await store.open("templates/nested/order.tsx"))!;
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));
    const source = multiChannelTemplate("order").replace(
      "your order shipped.</Sms>",
      "it shipped.</Sms>",
    );
    const saved = await store.saveSource("templates/nested/order.tsx#sms", sms.rev, source, "tab");
    expect(saved.ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe(source);
    expect(await store.open("templates/nested/order.tsx#sms")).toMatchObject({
      render: { text: "Hi Ada, it shipped." },
    });
    expect((await store.open("templates/nested/order.tsx"))!.rev).not.toBe(email.rev);
    expect(
      changes.filter((change) => change.sourceClient === "tab").map((change) => change.id),
    ).toEqual(["templates/nested/order.tsx#sms"]);
  });

  it("refuses an authored source over the byte limit with the shared message", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    expect(
      await store.saveSource(
        "templates/welcome.tsx",
        initial.rev,
        "x".repeat(EDITOR_MAX_SOURCE_BYTES + 1),
      ),
    ).toEqual({ ok: false, kind: "refused", error: EDITOR_SOURCE_TOO_LARGE_MESSAGE });
    expect(EDITOR_SOURCE_TOO_LARGE_MESSAGE).toBe("Authored source exceeds the 1 MiB limit.");
  });

  it("replaces the file atomically, preserves its mode, and serializes competing saves", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    await chmod(welcomePath, 0o640);
    const original = await open(welcomePath, "r");
    const first = `// first\n${WELCOME}`;
    const results = await Promise.all([
      store.saveSource("templates/welcome.tsx", initial.rev, first),
      store.saveSource("templates/welcome.tsx", initial.rev, `// second\n${WELCOME}`),
    ]);
    expect(results).toMatchObject([{ ok: true }, { ok: false, kind: "conflict" }]);
    expect(await original.readFile("utf8")).toBe(WELCOME);
    await original.close();
    expect(await readFile(welcomePath, "utf8")).toBe(first);
    expect((await stat(welcomePath)).mode & 0o777).toBe(0o640);
    expect(
      (await readdir(join(root, "templates"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("preserves an external write arriving while the replacement is being synced", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    const external = `// changed during save\n${WELCOME}`;
    diskSync.before = () => writeFile(welcomePath, external);
    expect(await store.saveSource("templates/welcome.tsx", initial.rev, "// local")).toMatchObject({
      ok: false,
      kind: "conflict",
    });
    expect(await readFile(welcomePath, "utf8")).toBe(external);
    expect(
      (await readdir(join(root, "templates"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("leaves the original intact and removes the temporary file when disk sync fails", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    diskSync.before = () => Promise.reject(new Error("disk sync failed"));
    await expect(
      store.saveSource("templates/welcome.tsx", initial.rev, "// local"),
    ).rejects.toThrow("disk sync failed");
    expect(await readFile(welcomePath, "utf8")).toBe(WELCOME);
    expect(
      (await readdir(join(root, "templates"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects an external disk change before the file watcher delivers it", async () => {
    const initial = (await store.open("templates/welcome.tsx"))!;
    const external = `// external\n${WELCOME}`;
    await writeFile(welcomePath, external);
    expect(
      await store.saveSource("templates/welcome.tsx", initial.rev, "// my edit"),
    ).toMatchObject({
      ok: false,
      kind: "conflict",
    });
    expect(await readFile(welcomePath, "utf8")).toBe(external);
  });

  it("views another declared fixture at the same revision, attributed to the asking client", async () => {
    const opened = (await store.open("templates/welcome.tsx"))!;
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));

    expect(await store.viewFixture("templates/welcome.tsx", "second", "client-a")).toEqual({
      ok: true,
    });

    expect(changes).toEqual([
      expect.objectContaining({
        id: "templates/welcome.tsx",
        rev: opened.rev,
        channel: "email",
        fixture: "second",
        sourceClient: "client-a",
      }),
    ]);
    expect(await store.open("templates/welcome.tsx")).toMatchObject({
      rev: opened.rev,
      fixture: "second",
      render: { subject: "Welcome, Grace" },
    });
    // The viewed fixture survives a rebuild.
    await store.refreshAll({ documents: false });
    expect(await store.open("templates/welcome.tsx")).toMatchObject({ fixture: "second" });
  });

  it("refuses a fixture the template does not declare and a document that is not here", async () => {
    await store.catalog();
    expect(await store.viewFixture("templates/welcome.tsx", "nope")).toEqual({
      ok: false,
      kind: "refused",
      error: 'Template declares no fixture named "nope".',
    });
    expect(await store.viewFixture("templates/missing.tsx", "first")).toEqual({
      ok: false,
      kind: "missing",
      error: "template not found",
    });
  });

  it("keeps a document that stops building, with a null render and the findings", async () => {
    const opened = (await store.open("templates/welcome.tsx"))!;
    const broken = WELCOME.replace("{input.name}</p>", "{input.nmae}</p>");
    await writeFile(welcomePath, broken, "utf8");
    const catalog = await store.refreshAll();

    expect(catalog.templates).toContainEqual(
      expect.objectContaining({ id: "templates/welcome.tsx", channel: "email" }),
    );
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ file: "templates/welcome.tsx", code: "unknown-field" }),
    );
    const failed = (await store.open("templates/welcome.tsx"))!;
    expect(failed).toMatchObject({
      channel: "email",
      fixtures: [],
      fixture: null,
      render: null,
      diagnostics: [expect.objectContaining({ code: "unknown-field" })],
      origin: { authoredSource: broken },
    });
    expect(failed.rev).not.toBe(opened.rev);

    await writeFile(welcomePath, WELCOME, "utf8");
    await store.refreshAll();
    expect(await store.open("templates/welcome.tsx")).toMatchObject({
      fixture: "first",
      render: { subject: "Welcome, Ada" },
    });
  });

  it("drops a document when its file becomes an ordinary module or is deleted", async () => {
    await store.catalog();
    await writeFile(welcomePath, "export const Welcome = () => null;\n", "utf8");
    expect((await store.refreshAll()).templates.map((item) => item.id)).not.toContain(
      "templates/welcome.tsx",
    );
    await writeFile(welcomePath, WELCOME, "utf8");
    await store.refreshAll();
    await rm(welcomePath);
    await store.refreshAll();
    expect(await store.open("templates/welcome.tsx")).toBeUndefined();
  });

  it("advances the source revision even when a source edit leaves rendered output unchanged", async () => {
    const opened = (await store.open("templates/welcome.tsx"))!;
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));

    const authored = `// formatting only\n${WELCOME}`;
    await writeFile(welcomePath, authored, "utf8");
    await store.refreshAll();

    expect(changes).toContainEqual(
      expect.objectContaining({
        id: "templates/welcome.tsx",
        rev: expect.not.stringMatching(opened.rev),
        channel: "email",
        authoredSource: authored,
      }),
    );
  });

  it("recompiles the templates that import a partial when it changes", async () => {
    const opened = (await store.open("templates/welcome.tsx"))!;
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));
    const partial = join(root, "components/signature.tsx");
    await writeFile(
      partial,
      SIGNATURE_PARTIAL.replace("The Samva team", "A new signature"),
      "utf8",
    );
    await store.refreshAll({ documents: true, changed: partial });

    expect(changes.map((change) => change.id)).toEqual(["templates/welcome.tsx"]);
    const updated = (await store.open("templates/welcome.tsx"))!;
    expect(updated.rev).not.toBe(opened.rev);
    expect(updated.channel === "email" && updated.render?.html).toContain("A new signature");
    // The source did not move, only what it renders.
    expect(changes[0]).not.toHaveProperty("sourceClient");
  });

  it("recompiles every template when the theme changes", async () => {
    const opened = (await store.open("templates/welcome.tsx"))!;
    const theme = join(root, "theme.css");
    await writeFile(theme, "@theme { --color-brand: #abcdef; }\n", "utf8");
    await store.refreshAll({ documents: true, changed: theme });
    const updated = (await store.open("templates/welcome.tsx"))!;
    expect(updated.rev).not.toBe(opened.rev);
    expect(updated.channel === "email" && updated.render?.html).toContain("#abcdef");
  });

  it("treats the change event for its own write as already built, and an outside edit as a change", async () => {
    const opened = (await store.open("templates/welcome.tsx"))!;
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));

    const authored = `// saved in the editor\n${WELCOME}`;
    expect(
      await store.saveSource("templates/welcome.tsx", opened.rev, authored, "local-tab"),
    ).toMatchObject({ ok: true });
    expect(changes).toEqual([expect.objectContaining({ sourceClient: "local-tab" })]);

    // The watcher delivers the store's own write. Recompiling the project for it would
    // republish the document with no client, which is how a foreign edit reaches the editor.
    await store.refreshAll({ documents: true, changed: welcomePath });
    expect(changes).toHaveLength(1);

    // An edit this store did not make still rebuilds and still arrives unattributed.
    const outside = `// another program\n${WELCOME}`;
    await writeFile(welcomePath, outside, "utf8");
    await store.refreshAll({ documents: true, changed: welcomePath });
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({ id: "templates/welcome.tsx", authoredSource: outside });
    expect(changes[1]).not.toHaveProperty("sourceClient");
  });

  it("keeps a fixture switch attributed when a rebuild overlaps it", async () => {
    await store.catalog();
    const changes: StoreChange[] = [];
    store.subscribe((change) => changes.push(change));

    // The reader switches fixtures while a rebuild is running. The switch has to be the only
    // thing that publishes the new fixture, and it has to carry the client that asked.
    const switched = store.viewFixture("templates/welcome.tsx", "second", "client-a");
    const rebuilt = store.refreshAll({ documents: true });

    expect(await switched).toEqual({ ok: true });
    await rebuilt;
    expect(changes).toEqual([
      expect.objectContaining({
        id: "templates/welcome.tsx",
        fixture: "second",
        sourceClient: "client-a",
      }),
    ]);
  });

  it("serves the bytes of an imported asset by its content-addressed name", async () => {
    const withLogo = await tempProject({
      "assets/logo.png": new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
      "templates/logo.tsx": emailTemplate("logo", "Hello", {
        imports: 'import logo from "../assets/logo.png";',
        body: '<Email><img src={logo} alt="Samva" width="12" height="12" /></Email>',
      }),
    });
    const assets = new EditorFileStore({ root: withLogo, assetBase: "/api/assets" });
    const logo = (await assets.open("templates/logo.tsx"))!;
    if (logo.channel !== "email" || logo.render === null) throw new Error("expected render");
    const match = /src="\/api\/assets\/([0-9a-f]+\.png)"/.exec(logo.render.html);
    expect(match).not.toBeNull();
    expect(assets.asset(match![1]!)).toMatchObject({ contentType: "image/png" });
    expect(assets.asset("missing.png")).toBeUndefined();
  });

  it("does not follow a symlink out of the templates dir", async () => {
    const secret = join(root, "secret.tsx");
    await writeFile(secret, WELCOME, "utf8");
    await symlink(secret, join(root, "templates/link.tsx"));

    expect(await store.open("templates/link.tsx")).toBeUndefined();
    expect(await readFile(secret, "utf8")).toBe(WELCOME);
  });
});
