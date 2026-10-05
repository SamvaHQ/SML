import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { EmailDiagnostic, TemplateDiagnostic } from "@samva/markup/diagnostics";
import type { RenderedIrWhatsApp } from "@samva/markup/render";
import { renderIrPreview, type EmailElementSelection } from "@samva/markup/render";

import {
  emailCompatibility,
  renderChannelFixture,
  renderEmailFixtures,
  type CompiledEntry,
  type TemplateChannel,
} from "./compile";
import { isObject } from "./internal/guards";
import { isWithin, projectPath, templateDirectories } from "./layout";
import { compileBase, restoreBase } from "./local-assets";
import { loadProject, type LoadedProject, type ProjectOptions } from "./project";

// Node-side repository backing the Vite editor surface. A template is one TSX
// file compiled to IR without running it; the store exposes canonical authored
// code beside what each channel of the template shows. Email is one render of a
// declared fixture, stamped with instance paths so a click in the canvas
// resolves to the element of the source that produced it. A template that
// declares several channels is several documents over the same file. A save
// checks both the revision and the current disk source, writes the file, then
// recompiles and publishes what moved.

/** Maximum UTF-8 bytes in one local authored entry. */
export const EDITOR_MAX_SOURCE_BYTES = 1024 * 1024;

/** The refusal both the store and the dev-server route return for an oversized entry. */
export const EDITOR_SOURCE_TOO_LARGE_MESSAGE = `Authored source exceeds the ${
  EDITOR_MAX_SOURCE_BYTES / (1024 * 1024)
} MiB limit.`;

export interface EditorTemplate {
  /**
   * The document identity: the project-relative path of the TSX entry, with `#sms` or `#whatsapp`
   * appended for those channels of a template that declares them.
   */
  readonly id: string;
  readonly name: string;
  readonly channel: TemplateChannel;
  readonly sourceKind: "tsx";
}

export interface EditorCatalogDiagnostic {
  readonly upgrade?: string | undefined;
  readonly file: string;
  readonly severity: EmailDiagnostic["severity"];
  readonly code: string;
  readonly message: string;
}

export interface EditorCatalog {
  readonly templates: ReadonlyArray<EditorTemplate>;
  readonly diagnostics: ReadonlyArray<EditorCatalogDiagnostic>;
}

/** A template input, with the sample its schema declares for the preview. */
interface EditorVariable {
  readonly name: string;
  readonly sample?: string | undefined;
  readonly required: boolean;
}

/**
 * One render of one declared fixture. `html` carries `data-samva-instance` on every element,
 * which is what an editor resolves a click through; a delivered message never has it.
 * `revision` is the document revision the render was taken at.
 */
interface EditorEmailRender {
  readonly revision: string;
  readonly subject: string;
  readonly preheader?: string | undefined;
  readonly html: string;
  readonly text: string;
  readonly selections: ReadonlyArray<EmailElementSelection>;
}

/** What the email lane shows: one build of the entry, seen through one fixture. */
interface EditorEmailContent {
  readonly channel: "email";
  readonly preview: { readonly status: "current" };
  /** The fixture names the template declares. Empty when the entry did not build. */
  readonly fixtures: ReadonlyArray<string>;
  /** The declared fixture being viewed. Null when the template declares none. */
  readonly fixture: string | null;
  /** Null when the entry did not build or the fixture did not render; `diagnostics` says which. */
  readonly render: EditorEmailRender | null;
  readonly diagnostics: ReadonlyArray<EmailDiagnostic>;
  /** Target-client findings across the declared fixtures. */
  readonly incompatibilities: ReadonlyArray<EmailDiagnostic>;
}

/** One render of an SMS or WhatsApp channel for the viewed fixture. */
type EditorChannelRender =
  | { readonly revision: string; readonly text: string }
  | ({ readonly revision: string } & RenderedIrWhatsApp);

/** What an SMS or WhatsApp lane shows. */
interface EditorChannelContent {
  readonly channel: "sms" | "whatsapp";
  readonly preview: { readonly status: "current" };
  readonly fixtures: ReadonlyArray<string>;
  readonly fixture: string | null;
  readonly render: EditorChannelRender | null;
  readonly diagnostics: ReadonlyArray<EmailDiagnostic>;
}

type EditorContent = EditorEmailContent | EditorChannelContent;

interface DocumentFields {
  readonly id: null;
  readonly name: string;
  readonly rev: string;
  readonly variables: ReadonlyArray<EditorVariable>;
  readonly metadata: Record<string, never>;
}

export type EditorSnapshot = DocumentFields &
  EditorContent & {
    readonly origin: {
      readonly kind: "tsx";
      readonly file: string;
      readonly authoredSource: string;
    };
    readonly access: { readonly kind: "editable" };
  };

export type StoreChange = EditorContent & {
  readonly id: string;
  readonly rev: string;
  /** Present so the read-only source panel advances too. */
  readonly authoredSource?: string | undefined;
  readonly sourceClient?: string | undefined;
};

/** Why a fixture could not be shown. `missing` is a document that is not here. */
export type FixtureOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "missing" | "refused"; readonly error: string };

interface CachedDocument {
  readonly template: EditorTemplate;
  /** Project-relative path of the TSX entry the document is a view of. */
  readonly file: string;
  readonly content: EditorContent;
  readonly authoredSource: string;
  readonly rev: string;
  readonly variables: ReadonlyArray<EditorVariable>;
  /** The compile this document renders from; absent when the entry did not build. */
  readonly compiled: CompiledEntry | undefined;
}

export interface EditorFileStoreOptions extends ProjectOptions {
  /** Called after every project load, so a host can report what the brand resolved to. */
  readonly onProject?: ((project: LoadedProject) => void) | undefined;
}

const hashSource = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);

const deriveName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.tsx$/, "");

/** The document id for one channel of an entry. Email is the entry's own path. */
export const documentId = (entryPath: string, channel: TemplateChannel): string =>
  channel === "email" ? entryPath : `${entryPath}#${channel}`;

/** The entry path and channel a document id names. */
export const parseDocumentId = (
  id: string,
): { readonly file: string; readonly channel: TemplateChannel } => {
  const cut = id.lastIndexOf("#");
  const channel = cut === -1 ? undefined : id.slice(cut + 1);
  return channel === "sms" || channel === "whatsapp"
    ? { file: id.slice(0, cut), channel }
    : { file: id, channel: "email" };
};

const catalogFinding = (file: string, item: TemplateDiagnostic): EditorCatalogDiagnostic => ({
  file,
  severity: item.severity,
  code: item.code,
  message: item.message,
  ...(item.upgrade === undefined ? {} : { upgrade: item.upgrade }),
});

/** A template's input contract is a JSON Schema, so its variables are that schema's top-level properties. */
const variablesOf = (schema: Readonly<Record<string, unknown>>): ReadonlyArray<EditorVariable> => {
  const properties = schema["properties"];
  if (!isObject(properties)) return [];
  const required = schema["required"];
  const names = Array.isArray(required) ? required : [];
  return Object.entries(properties).map(([name, property]) => {
    const examples = isObject(property) ? property["examples"] : undefined;
    const example = Array.isArray(examples) ? examples[0] : undefined;
    return {
      name,
      required: names.includes(name),
      ...(typeof example === "string" ? { sample: example } : {}),
    };
  });
};

const chooseFixture = (
  fixtures: ReadonlyArray<string>,
  wanted: string | undefined,
): string | null =>
  wanted !== undefined && fixtures.includes(wanted) ? wanted : (fixtures[0] ?? null);

/** One preview render of the viewed fixture, or null when the renderer refuses it. */
const previewRender = (
  entry: CompiledEntry,
  fixture: string,
  revision: string,
  assetBase: string | undefined,
): EditorEmailRender | null => {
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Plain library boundary: the renderer signals a refused render by throwing, and the delivered pass already reported why.
  try {
    const preview = renderIrPreview(
      entry.ir,
      entry.fixtures[fixture],
      entry.brandPlugin === undefined ? {} : { brandPlugin: entry.brandPlugin },
    );
    return {
      revision,
      subject: preview.subject,
      ...(preview.preheader === undefined ? {} : { preheader: preview.preheader }),
      html: restoreBase(preview.html, assetBase),
      text: preview.text,
      selections: preview.selections,
    };
  } catch {
    return null;
  }
};

interface Built {
  readonly content: (revision: string, fixture: string | undefined) => EditorContent;
  /** What this build is; the revision is its digest with the source. */
  readonly identity: string;
}

/** Everything one channel of one entry shows, computed once per compile. */
const buildChannel = (
  entry: CompiledEntry,
  channel: TemplateChannel,
  assetBase: string | undefined,
): Built => {
  const fixtures = Object.keys(entry.fixtures);
  if (channel === "email") {
    // Every declared fixture renders as it will be delivered: that render is what the findings
    // and the client checks describe. The viewed fixture renders once more with instance paths.
    const delivered = renderEmailFixtures(entry);
    const diagnostics = [
      ...entry.diagnostics,
      ...delivered.flatMap((result) => result.diagnostics),
    ];
    const incompatibilities = emailCompatibility(entry, delivered);
    return {
      identity: JSON.stringify({
        diagnostics,
        incompatibilities,
        fixtures: delivered.map((result) => ({
          fixture: result.fixture,
          subject: result.rendered?.subject ?? null,
          preheader: result.rendered?.preheader ?? null,
          html: result.rendered?.html ?? null,
          text: result.rendered?.text ?? null,
        })),
      }),
      content: (revision, wanted) => {
        const fixture = chooseFixture(fixtures, wanted);
        return {
          channel: "email",
          preview: { status: "current" },
          fixtures,
          fixture,
          render: fixture === null ? null : previewRender(entry, fixture, revision, assetBase),
          diagnostics,
          incompatibilities,
        };
      },
    };
  }
  const rendered = fixtures.map((fixture) => ({
    fixture,
    result: renderChannelFixture(entry, channel, fixture),
  }));
  const diagnostics = [
    ...entry.diagnostics,
    ...rendered.flatMap(({ result }) => (result.ok ? [] : result.diagnostics)),
  ];
  return {
    identity: JSON.stringify({ diagnostics, rendered }),
    content: (revision, wanted) => {
      const fixture = chooseFixture(fixtures, wanted);
      const result = rendered.find((item) => item.fixture === fixture)?.result;
      return {
        channel,
        preview: { status: "current" },
        fixtures,
        fixture,
        render:
          result?.ok !== true
            ? null
            : result.channel === "sms"
              ? { revision, text: result.text }
              : { revision, ...result.message },
        diagnostics,
      };
    },
  };
};

/** Two builds of one document differ when what the editor shows differs. */
const moved = (before: CachedDocument | undefined, entry: CachedDocument): boolean => {
  if (before === undefined) return true;
  if (before.rev !== entry.rev || before.authoredSource !== entry.authoredSource) return true;
  return before.content.fixture !== entry.content.fixture;
};

export class EditorFileStore {
  private readonly projectOptions: ProjectOptions;
  private readonly options: EditorFileStoreOptions;
  private readonly root: string;
  private loaded = false;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const running = this.mutationQueue.then(operation, operation);
    this.mutationQueue = running.catch(() => undefined);
    return running;
  }
  private initialLoad: Promise<EditorCatalog> | undefined;
  private project: LoadedProject | undefined;
  private readonly entries = new Map<string, CachedDocument>();
  private readonly catalogDiagnostics: EditorCatalogDiagnostic[] = [];
  private readonly fixtures = new Map<string, string>();
  private readonly listeners = new Set<(change: StoreChange) => void>();
  private readonly catalogListeners = new Set<() => void>();

  constructor(options: EditorFileStoreOptions = {}) {
    this.options = options;
    // The renderer accepts only https asset URLs; see local-assets.ts.
    this.projectOptions = { ...options, assetBase: compileBase(options.assetBase) };
    this.root = resolve(options.root ?? process.cwd());
  }

  /** The bytes of an imported asset from the latest compile, by its content-addressed file name. */
  asset(
    fileName: string,
  ): { readonly contentType: string; readonly bytes: Uint8Array } | undefined {
    const project = this.project;
    const entry = project?.catalog.assets.find((asset) => asset.fileName === fileName);
    const bytes = entry === undefined ? undefined : project?.files[entry.path];
    return entry === undefined || bytes === undefined || typeof bytes === "string"
      ? undefined
      : { contentType: entry.contentType, bytes };
  }

  /** The directories the store scans, for a host that watches them. */
  directories(): Promise<readonly string[]> {
    return templateDirectories(this.root, this.projectOptions.dir);
  }

  private async resolvePath(entryPath: string): Promise<string | undefined> {
    if (!entryPath.endsWith(".tsx") || entryPath.includes("\0")) return undefined;
    const full = resolve(this.root, entryPath);
    const dirs = await this.directories();
    if (!dirs.some((dir) => isWithin(full, dir))) return undefined;
    const real = await realpath(full).catch(() => undefined);
    if (real === undefined) return undefined;
    const realDirs = await Promise.all(dirs.map((dir) => realpath(dir).catch(() => undefined)));
    return realDirs.some((dir) => dir !== undefined && isWithin(real, dir)) ? real : undefined;
  }

  /** The entry path of an absolute file path, when a template entry could live there. */
  entryPathFor(path: string): string | undefined {
    const full = isAbsolute(path) ? path : join(this.root, path);
    const relative = projectPath(this.root, full);
    if (!relative.endsWith(".tsx") || relative.startsWith("..")) return undefined;
    return this.project?.catalog.templates.some((entry) => entry.entryPath === relative) === true ||
      this.project?.catalog.failures.some((entry) => entry.entryPath === relative) === true
      ? relative
      : undefined;
  }

  private build(
    entry: CompiledEntry,
    channel: TemplateChannel,
    authoredSource: string,
    id: string,
    fixture: string | undefined,
  ): CachedDocument {
    const built = buildChannel(entry, channel, this.options.assetBase);
    const rev = hashSource(authoredSource + built.identity);
    const content = built.content(rev, fixture);
    return {
      template: { id, name: deriveName(entry.entryPath), channel, sourceKind: "tsx" },
      file: entry.entryPath,
      content,
      authoredSource,
      rev,
      variables: variablesOf(entry.ir.schema),
      compiled: entry,
    };
  }

  private catalogSnapshot(): EditorCatalog {
    return {
      templates: [...this.entries.values()]
        .map((entry) => entry.template)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      diagnostics: [...this.catalogDiagnostics],
    };
  }

  private ensureLoaded(): Promise<EditorCatalog> {
    if (this.loaded) return Promise.resolve(this.catalogSnapshot());
    if (this.initialLoad !== undefined) return this.initialLoad;
    const loading = this.rebuild(false);
    this.initialLoad = loading;
    void loading.then(
      () => {
        if (this.initialLoad === loading) this.initialLoad = undefined;
      },
      () => {
        if (this.initialLoad === loading) this.initialLoad = undefined;
      },
    );
    return loading;
  }

  private async rebuild(emitDocuments: boolean): Promise<EditorCatalog> {
    const previous = new Map(this.entries);
    const project = await loadProject(this.projectOptions);
    this.project = project;
    this.options.onProject?.(project);
    this.entries.clear();
    this.catalogDiagnostics.length = 0;
    this.catalogDiagnostics.push(...project.diagnostics.map((item) => catalogFinding("", item)));

    for (const compiled of project.catalog.templates) {
      const source = project.files[compiled.entryPath];
      const authoredSource = typeof source === "string" ? source : "";
      for (const channel of compiled.channels) {
        const id = documentId(compiled.entryPath, channel);
        this.entries.set(
          id,
          this.build(compiled, channel, authoredSource, id, this.fixtures.get(id)),
        );
      }
    }
    // An entry that stops building keeps its documents and says why: a null render carrying the
    // findings, not an old preview. An entry that never built has no document yet, only findings.
    for (const failed of project.catalog.failures) {
      const source = project.files[failed.entryPath];
      const authoredSource = typeof source === "string" ? source : "";
      this.catalogDiagnostics.push(
        ...failed.diagnostics.map((item) => catalogFinding(failed.entryPath, item)),
      );
      for (const [id, before] of previous) {
        if (before.file !== failed.entryPath) continue;
        this.entries.set(id, {
          ...before,
          content: {
            ...before.content,
            fixtures: [],
            fixture: null,
            render: null,
            diagnostics: failed.diagnostics,
          },
          authoredSource,
          rev: hashSource(authoredSource + JSON.stringify(failed.diagnostics)),
          variables: [],
          compiled: undefined,
        });
      }
    }
    this.loaded = true;

    if (emitDocuments) {
      for (const [id, entry] of this.entries) {
        if (moved(previous.get(id), entry)) this.publishEntry(id, entry);
      }
    }
    for (const listener of this.catalogListeners) listener();
    return this.catalogSnapshot();
  }

  async catalog(): Promise<EditorCatalog> {
    return this.ensureLoaded();
  }

  /**
   * Recompile the project after a template, partial, theme or asset changed.
   * `changed` names the file whose change asked for this refresh.
   *
   * This store writes template files itself, so an editor save comes back as a
   * change event indistinguishable from an author's own edit in another program.
   * Recompiling for it would republish the document with no client attached,
   * which is exactly how a foreign edit reaches the editor. A changed file that
   * still holds the bytes the current compile read is already built, so there is
   * nothing to publish and nothing to rebuild. Every other path is a real change.
   */
  async refreshAll(
    options: {
      readonly documents?: boolean | undefined;
      readonly changed?: string | undefined;
    } = {},
  ): Promise<EditorCatalog> {
    const loading = this.initialLoad;
    if (loading !== undefined) await loading;
    else if (!this.loaded) return this.ensureLoaded();
    return this.serialize(async () =>
      (await this.alreadyBuilt(options.changed))
        ? this.catalogSnapshot()
        : this.rebuild(options.documents ?? true),
    );
  }

  /** True when `path` still holds the exact bytes the latest compile read from it. */
  private async alreadyBuilt(path: string | undefined): Promise<boolean> {
    if (path === undefined || this.project === undefined) return false;
    const full = isAbsolute(path) ? path : join(this.root, path);
    const found = this.project.files[projectPath(this.root, full)];
    if (found === undefined) return false;
    const known = typeof found === "string" ? Buffer.from(found, "utf8") : found;
    const disk = await readFile(full).catch(() => undefined);
    if (disk === undefined) return false;
    return Buffer.from(known).equals(disk);
  }

  async list(): Promise<ReadonlyArray<EditorTemplate>> {
    return (await this.catalog()).templates;
  }

  async open(id: string): Promise<EditorSnapshot | undefined> {
    if (!this.loaded) await this.ensureLoaded();
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    return {
      id: null,
      name: entry.template.name,
      rev: entry.rev,
      variables: entry.variables,
      metadata: {},
      ...entry.content,
      origin: { kind: "tsx", file: entry.file, authoredSource: entry.authoredSource },
      access: { kind: "editable" },
    };
  }

  /**
   * Serialize editor saves and atomically replace the complete entry after a fresh disk check.
   * Arbitrary external writers do not participate in this queue: the final check and rename
   * are not a filesystem compare-and-swap, so authors must resolve overlapping saves externally.
   */
  async saveSource(
    id: string,
    baseRev: string,
    authoredSource: string,
    client?: string,
  ): Promise<
    | { readonly ok: true; readonly rev: string }
    | {
        readonly ok: false;
        readonly kind: "missing" | "refused" | "conflict";
        readonly error: string;
        readonly actualRev?: string;
      }
  > {
    if (Buffer.byteLength(authoredSource, "utf8") > EDITOR_MAX_SOURCE_BYTES)
      return { ok: false, kind: "refused", error: EDITOR_SOURCE_TOO_LARGE_MESSAGE };
    await this.ensureLoaded();
    return this.serialize(async () => {
      const entry = this.entries.get(id);
      const path = entry === undefined ? undefined : await this.resolvePath(entry.file);
      if (entry === undefined || path === undefined)
        return { ok: false, kind: "missing", error: "Template not found." };
      const disk = await readFile(path, "utf8");
      if (entry.rev !== baseRev || disk !== entry.authoredSource) {
        await this.rebuild(true);
        return {
          ok: false,
          kind: "conflict",
          error: "Source changed on disk. Reload before saving.",
          actualRev: this.entries.get(id)?.rev ?? entry.rev,
        };
      }
      const temporary = `${path}.${randomUUID()}.tmp`;
      const mode = (await stat(path)).mode;
      const file = await open(temporary, "wx", mode);
      // oxlint-disable-next-line samva/no-try-catch-or-throw -- filesystem resource cleanup boundary
      try {
        await file.writeFile(authoredSource, "utf8");
        await file.chmod(mode);
        await file.sync();
        await file.close();
        if ((await readFile(path, "utf8")) !== disk) {
          await this.rebuild(true);
          return {
            ok: false,
            kind: "conflict",
            error: "Source changed on disk. Reload before saving.",
            actualRev: this.entries.get(id)?.rev ?? entry.rev,
          };
        }
        await rename(temporary, path);
      } finally {
        await file.close().finally(() => rm(temporary, { force: true }));
      }
      const previous = new Map(this.entries);
      await this.rebuild(false);
      for (const [changedId, changed] of this.entries) {
        if (moved(previous.get(changedId), changed))
          this.publishEntry(changedId, changed, changedId === id ? client : undefined);
      }
      const saved = this.entries.get(id);
      return saved === undefined
        ? { ok: false, kind: "missing", error: "The saved entry is no longer discoverable." }
        : { ok: true, rev: saved.rev };
    });
  }

  /**
   * Show another declared fixture of a document. It re-renders the same
   * compile, so the revision does not move; the resulting document reaches every
   * watcher on the change stream, attributed to the client that asked.
   *
   * It runs in the mutation queue for the same reason a save does: the viewed
   * fixture is part of the entry, and a rebuild that straddled the switch would
   * take its own snapshot from before it and its render from after it, then
   * publish the difference with no client.
   */
  async viewFixture(id: string, fixture: string, client?: string): Promise<FixtureOutcome> {
    if (!this.loaded) await this.ensureLoaded();
    return this.serialize(async () => {
      const entry = this.entries.get(id);
      if (entry === undefined) return { ok: false, kind: "missing", error: "template not found" };
      if (!entry.content.fixtures.includes(fixture) || entry.compiled === undefined) {
        return {
          ok: false,
          kind: "refused",
          error: `Template declares no fixture named ${JSON.stringify(fixture)}.`,
        };
      }
      const next = this.build(
        entry.compiled,
        entry.template.channel,
        entry.authoredSource,
        id,
        fixture,
      );
      this.fixtures.set(id, fixture);
      this.entries.set(id, next);
      this.publishEntry(id, next, client);
      return { ok: true };
    });
  }

  private publishEntry(id: string, entry: CachedDocument, client?: string): void {
    const change: StoreChange = {
      id,
      rev: entry.rev,
      authoredSource: entry.authoredSource,
      ...(client === undefined ? {} : { sourceClient: client }),
      ...entry.content,
    };
    for (const listener of this.listeners) listener(change);
  }

  subscribe(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeCatalog(listener: () => void): () => void {
    this.catalogListeners.add(listener);
    return () => this.catalogListeners.delete(listener);
  }
}
