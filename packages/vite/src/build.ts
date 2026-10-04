import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import markupPackage from "@samva/markup/package.json" with { type: "json" };
import type { RenderedIrEmail, RenderedIrWhatsApp, TemplateIr } from "@samva/markup/render";

import {
  emailCompatibility,
  finding,
  hasErrors,
  renderChannelFixture,
  renderEmailFixtures,
  type CompiledEntry,
  type TemplateChannel,
} from "./compile";
import { isDeliverableBase } from "./local-assets";
import {
  createProjectSession,
  loadProject,
  type LoadedProject,
  type ProjectOptions,
} from "./project";

/** The compiler a build ran, as a publication records it. */
export const COMPILER = `@samva/markup@${markupPackage.version}`;

/** One declared input rendered through every channel the template declares. */
export interface FixtureBuild {
  readonly name: string;
  readonly input: unknown;
  readonly ok: boolean;
  readonly email?: Pick<RenderedIrEmail, "subject" | "preheader" | "html" | "text"> | undefined;
  readonly sms?: string | undefined;
  readonly whatsapp?: RenderedIrWhatsApp | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
}

/** A template's IR, its input contract, and what each declared fixture rendered. */
export interface TemplateBuild {
  /** The id the definition declares. */
  readonly template: string;
  readonly channels: readonly TemplateChannel[];
  readonly ok: boolean;
  /** Project-relative source of the entry. */
  readonly source: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly ir: TemplateIr;
  readonly fixtures: readonly FixtureBuild[];
  /** Compile findings, brand findings and asset-base findings. */
  readonly diagnostics: readonly EmailDiagnostic[];
  /** Target-client findings across the email fixtures. */
  readonly compatibility: readonly EmailDiagnostic[];
}

/** One template entry of the project. `template` is absent when the entry did not compile. */
export interface BuildFile {
  /** Project-relative path of the entry. */
  readonly id: string;
  readonly kind: "tsx";
  readonly ok: boolean;
  readonly template?: TemplateBuild | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
}

export interface BuildTemplatesResult {
  readonly compilerVersion: string;
  /** Template entries, sorted by path; helper modules have no entry here. */
  readonly files: readonly BuildFile[];
  /** Findings about the project as a whole: the brand, a duplicate id. */
  readonly diagnostics: readonly EmailDiagnostic[];
  readonly ok: boolean;
}

export interface BuildTemplatesOptions extends ProjectOptions {}

export interface TemplateBuildSession {
  readonly build: () => Promise<BuildTemplatesResult>;
  readonly subscribe: (listener: (path: string) => void) => () => void;
  readonly close: () => Promise<void>;
}

/**
 * A build needs an https base for imported assets and reports one finding when it has none, so a
 * template that imports an asset still compiles and renders and the finding is the only noise.
 */
const PLACEHOLDER_ORIGIN = "https://assets.invalid";

const withCompileBase = (options: BuildTemplatesOptions): BuildTemplatesOptions => ({
  ...options,
  assetBase: isDeliverableBase(options.assetBase ?? "") ? options.assetBase : PLACEHOLDER_ORIGIN,
});

const assetFindings = (
  entry: CompiledEntry,
  assetBase: string | undefined,
): readonly EmailDiagnostic[] => {
  if (entry.assets.length === 0) return [];
  if (assetBase === undefined || assetBase === "")
    return [
      finding(
        "missing-asset-base",
        "error",
        "Imported email assets require --asset-base with their HTTPS serving origin.",
      ),
    ];
  return /^https:\/\//i.test(assetBase)
    ? []
    : [
        finding(
          "invalid-asset-base",
          "error",
          "Email check and build require an HTTPS --asset-base; relative URLs belong to templates export.",
        ),
      ];
};

const buildEntry = (entry: CompiledEntry, assetBase: string | undefined): BuildFile => {
  const email = entry.channels.includes("email") ? renderEmailFixtures(entry) : [];
  const fixtures = Object.entries(entry.fixtures).map(([name, input]): FixtureBuild => {
    const rendered = email.find((result) => result.fixture === name);
    const sms = entry.channels.includes("sms")
      ? renderChannelFixture(entry, "sms", name)
      : undefined;
    const whatsapp = entry.channels.includes("whatsapp")
      ? renderChannelFixture(entry, "whatsapp", name)
      : undefined;
    const diagnostics = [
      ...(rendered?.diagnostics ?? []),
      ...[sms, whatsapp].flatMap((result) => (result?.ok === false ? result.diagnostics : [])),
    ];
    return {
      name,
      input,
      ok: !hasErrors(diagnostics),
      ...(rendered?.rendered === undefined
        ? {}
        : {
            email: {
              subject: rendered.rendered.subject,
              preheader: rendered.rendered.preheader,
              html: rendered.rendered.html,
              text: rendered.rendered.text,
            },
          }),
      ...(sms?.ok === true && sms.channel === "sms" ? { sms: sms.text } : {}),
      ...(whatsapp?.ok === true && whatsapp.channel === "whatsapp"
        ? { whatsapp: whatsapp.message }
        : {}),
      diagnostics,
    };
  });
  const compatibility = emailCompatibility(entry, email);
  const diagnostics = [...entry.diagnostics, ...assetFindings(entry, assetBase)];
  const ok =
    !hasErrors(diagnostics) && !hasErrors(compatibility) && fixtures.every((fixture) => fixture.ok);
  const template: TemplateBuild = {
    template: entry.id,
    channels: entry.channels,
    ok,
    source: entry.entryPath,
    inputSchema: entry.ir.schema,
    ir: entry.ir,
    fixtures,
    diagnostics,
    compatibility,
  };
  return { id: entry.entryPath, kind: "tsx", ok, template, diagnostics };
};

const summarize = (project: LoadedProject, assetBase: string | undefined): BuildTemplatesResult => {
  const built = project.catalog.templates.map((entry) => buildEntry(entry, assetBase));
  const failed = project.catalog.failures.map((entry): BuildFile => ({
    id: entry.entryPath,
    kind: "tsx",
    ok: false,
    diagnostics: entry.diagnostics,
  }));
  const files = [...built, ...failed].sort((left, right) => (left.id < right.id ? -1 : 1));
  return {
    compilerVersion: COMPILER,
    files,
    diagnostics: project.diagnostics,
    ok: !hasErrors(project.diagnostics) && files.every((file) => file.ok),
  };
};

/**
 * Compile every template in a project and render every fixture it declares
 * through each of its channels, then check the email fixtures against the
 * client matrix. Nothing is evaluated.
 */
export const buildTemplates = async (
  options: BuildTemplatesOptions = {},
): Promise<BuildTemplatesResult> =>
  summarize(await loadProject(withCompileBase(options)), options.assetBase);

/** A watcher and compiler over a project, for `check --watch`. */
export const createTemplateBuildSession = (
  options: BuildTemplatesOptions = {},
): TemplateBuildSession => {
  const session = createProjectSession(withCompileBase(options));
  let closed = false;
  return {
    build: async () => summarize(await session.load(), options.assetBase),
    subscribe: session.subscribe,
    close: async () => {
      if (closed) return;
      closed = true;
      await session.close();
    },
  };
};
