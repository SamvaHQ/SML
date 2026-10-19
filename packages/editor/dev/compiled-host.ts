import {
  contractVersion,
  DocumentConflict,
  type AsyncEditableEditorHost,
  type DocumentChange,
  type EditableEmailDocument,
  type EmailRender,
  type Variable,
} from "@samva/editor/host";
import { compileTemplate } from "@samva/markup/compiler";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import { renderIr, renderIrPreview } from "@samva/markup/render";

import {
  NIMBUS_ENTRY_FILE,
  NIMBUS_LOGO_DATA_URI,
  NIMBUS_LOGO_URL,
  NIMBUS_TEMPLATE_TSX,
  NIMBUS_THEME_CSS,
  NIMBUS_THEME_FILE,
} from "./nimbus-template";

// A host that does what a real one does: it holds the authored TSX, compiles it with the static
// compiler in the browser, renders the viewed fixture from the IR, and answers each save with the
// render of what was saved. `?demo=workspace` runs on it so screenshots show a real email.
//
// `@samva/markup/compiler` loads caniemail, whose glob dependency reads Node's `process.platform`
// and `process.version` when it loads; `vite.config.ts` defines both for the browser.

export interface CompiledHostControls {
  readonly host: AsyncEditableEditorHost;
  /** Publish a foreign change, with the render the host produced for it. */
  readonly emit: (input: {
    readonly origin: "agent" | "external";
    readonly authoredSource?: string | undefined;
    readonly broken?: boolean | "not-built" | undefined;
    readonly staleReason?: string | undefined;
  }) => Promise<void>;
}

const VARIABLES: ReadonlyArray<Variable> = [
  { name: "firstName", sample: "Ada", required: true },
  { name: "claimUrl", sample: "https://nimbus.example/claim/ada", required: true },
];

const UNBUILT_ENTRY: EmailDiagnostic = {
  code: "entry-not-built",
  severity: "info",
  message: "This entry has not been built yet.",
  origins: [],
};

const BROKEN_ENTRY: EmailDiagnostic = {
  code: "entry-did-not-build",
  severity: "error",
  message: "The template entry did not compile.",
  origins: [],
};

type Compiled = Awaited<ReturnType<typeof compileTemplate>>;

const compile = (source: string): Promise<Compiled> =>
  compileTemplate({
    files: { [NIMBUS_ENTRY_FILE]: source, [NIMBUS_THEME_FILE]: NIMBUS_THEME_CSS },
    entry: NIMBUS_ENTRY_FILE,
    assetBase: "https://assets.nimbus.example",
    tailwind: { css: NIMBUS_THEME_CSS, cssPath: NIMBUS_THEME_FILE },
  });

/**
 * Swap the placeholder logo URL for the inline mark, moving every selection offset by what the
 * swap added before it, so the selections still describe the returned HTML.
 */
const inlineLogo = (
  html: string,
  selections: EmailRender["selections"],
): Pick<EmailRender, "html" | "selections"> => {
  const hits: number[] = [];
  for (
    let at = html.indexOf(NIMBUS_LOGO_URL);
    at !== -1;
    at = html.indexOf(NIMBUS_LOGO_URL, at + 1)
  )
    hits.push(at);
  const growth = NIMBUS_LOGO_DATA_URI.length - NIMBUS_LOGO_URL.length;
  const shift = (offset: number) => offset + growth * hits.filter((hit) => hit < offset).length;
  return {
    html: html.split(NIMBUS_LOGO_URL).join(NIMBUS_LOGO_DATA_URI),
    selections: selections.map((selection) => ({
      ...selection,
      start: shift(selection.start),
      end: shift(selection.end),
    })),
  };
};

const render = (compiled: Compiled, fixture: string, revision: string): EmailRender | null => {
  const ir = compiled.ir;
  if (ir === undefined) return null;
  const input = compiled.fixtures[fixture];
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Plain library boundary: the renderer signals a refused render by throwing; the document then shows no preview.
  try {
    const preview = renderIrPreview(ir, input);
    const delivered = renderIr(ir, input);
    return {
      revision,
      subject: preview.subject,
      ...(preview.preheader === undefined ? {} : { preheader: preview.preheader }),
      ...inlineLogo(preview.html, preview.selections),
      text: preview.text,
      // What the recipient receives: the delivered HTML, with no editor attributes.
      sentBytes: new TextEncoder().encode(delivered.html).length,
    };
  } catch {
    return null;
  }
};

export const createCompiledHost = async (): Promise<CompiledHostControls> => {
  let source = NIMBUS_TEMPLATE_TSX;
  let counter = 1;
  let previewCounter = 1;
  let compiled = await compile(source);
  let fixture: string | null = Object.keys(compiled.fixtures)[0] ?? null;
  let staleReason: string | undefined;
  let broken: boolean | "not-built" = false;
  let name = "Welcome — first bag on us";
  let metadata: EditableEmailDocument["metadata"] = {
    fromDefault: { email: "hello@nimbus.example", name: "Nimbus Coffee" },
    replyToDefault: ["support@nimbus.example"],
  };
  const listeners = new Set<(change: DocumentChange) => void>();

  const rev = () => `rev_${counter}`;
  const content = () => {
    const rendered =
      broken === false && fixture !== null
        ? render(compiled, fixture, `rev_${previewCounter}`)
        : null;
    if (rendered === null)
      return {
        channel: "email" as const,
        preview: { status: "current" as const },
        fixtures: [],
        fixture: null,
        render: null,
        diagnostics:
          broken === "not-built"
            ? [UNBUILT_ENTRY]
            : compiled.diagnostics.length > 0
              ? compiled.diagnostics
              : [BROKEN_ENTRY],
        incompatibilities: [],
      };
    return {
      channel: "email" as const,
      preview:
        staleReason === undefined
          ? { status: "current" as const }
          : { status: "stale" as const, reason: staleReason },
      fixtures: Object.keys(compiled.fixtures),
      fixture,
      render: rendered,
      diagnostics: compiled.diagnostics,
      incompatibilities: [],
    };
  };
  const publish = (origin: "self" | "agent" | "external") => {
    const change: DocumentChange = { rev: rev(), origin, authoredSource: source, ...content() };
    for (const listener of listeners) listener(change);
  };

  const host: AsyncEditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: {
      open: async (onChange) => {
        // Subscribe before taking the snapshot, so nothing published in between is lost.
        listeners.add(onChange);
        const initial: EditableEmailDocument = {
          id: "tpl_nimbus_welcome",
          name,
          rev: rev(),
          origin: { kind: "tsx", file: NIMBUS_ENTRY_FILE, authoredSource: source },
          access: { kind: "editable" },
          variables: VARIABLES,
          metadata,
          ...content(),
        };
        return { initial, close: () => void listeners.delete(onChange) };
      },
    },
    writer: {
      save: async (update) => {
        if (update.kind === "metadata") {
          name = update.patch.name ?? name;
          metadata = {
            fromDefault:
              update.patch.fromDefault === undefined
                ? metadata.fromDefault
                : (update.patch.fromDefault ?? undefined),
            replyToDefault:
              update.patch.replyToDefault === undefined
                ? metadata.replyToDefault
                : (update.patch.replyToDefault ?? undefined),
          };
          return { rev: rev() };
        }
        if (update.baseRev !== rev())
          return Promise.reject(
            new DocumentConflict({ expectedRev: update.baseRev, actualRev: rev() }),
          );
        source = update.authoredSource;
        compiled = await compile(source);
        counter += 1;
        previewCounter = counter;
        staleReason = undefined;
        if (fixture === null || !(fixture in compiled.fixtures))
          fixture = Object.keys(compiled.fixtures)[0] ?? null;
        publish("self");
        return { rev: rev() };
      },
    },
    fixtures: {
      status: "ready",
      api: {
        view: async (next) => {
          if (broken !== false || !(next in compiled.fixtures)) return;
          fixture = next;
          // A fixture switch re-renders the same build, so the revision holds.
          publish("self");
        },
      },
    },
    assets: {
      status: "ready",
      api: {
        uploadImage: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { url: `https://cdn.samva.local/${input.name}` };
        },
        fonts: {
          catalog: async () => [
            { family: "Instrument Sans", fallback: "Arial, Helvetica, sans-serif" },
            { family: "Iowan Old Style", fallback: "Georgia, 'Times New Roman', serif" },
          ],
        },
      },
    },
  };

  const emit: CompiledHostControls["emit"] = async (input) => {
    counter += 1;
    if (input.authoredSource !== undefined) {
      source = input.authoredSource;
      compiled = await compile(source);
    }
    broken = input.broken ?? broken;
    staleReason = input.staleReason;
    if (input.staleReason === undefined) previewCounter = counter;
    publish(input.origin);
  };

  return { host, emit };
};
