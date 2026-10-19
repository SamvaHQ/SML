import type { AssetEntry, BrandPlugin } from "@samva/markup/brand";
import { checkCompatibility } from "@samva/markup/compatibility";
import { compileTemplate } from "@samva/markup/compiler";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import type { CompiledTemplate, RenderedEmail, RenderedWhatsApp } from "@samva/markup/render";
import { render } from "@samva/markup/render";

import type { ResolvedBrand } from "./brand";
import type { ProjectFiles } from "./layout";

// The local build. A template is one TSX file in a static profile, so compiling
// it reads the project's files and never runs them: `compileTemplate` is the
// same call the hosted build makes, and rendering is `render` over the template
// it returns. Nothing local is evaluated, so a local render cannot drift from a
// published one.

export type TemplateChannel = "email" | "sms" | "whatsapp";

const CHANNELS: readonly TemplateChannel[] = ["email", "sms", "whatsapp"];

/** The channels a compiled template declares, in a fixed order. */
export const channelsOf = (template: CompiledTemplate): readonly TemplateChannel[] =>
  CHANNELS.filter((channel) => template[channel] !== undefined);

export const finding = (
  code: string,
  severity: EmailDiagnostic["severity"],
  message: string,
  extra: Partial<EmailDiagnostic> = {},
): EmailDiagnostic => ({ code, severity, message, origins: [], ...extra });

/** One entry that declares a template and compiled. */
export interface CompiledEntry {
  /** The identity the definition declares for itself (`compiled.template`). */
  readonly id: string;
  /** Project-relative path of the authored entry. */
  readonly entryPath: string;
  readonly compiled: CompiledTemplate;
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly assets: readonly AssetEntry[];
  /** Compile warnings. Errors leave no IR, so they are on a `FailedEntry` instead. */
  readonly diagnostics: readonly EmailDiagnostic[];
  readonly channels: readonly TemplateChannel[];
  readonly brandPlugin?: BrandPlugin | undefined;
}

/** An entry that is a template but did not compile. */
export interface FailedEntry {
  readonly entryPath: string;
  readonly diagnostics: readonly EmailDiagnostic[];
}

export interface CompiledProject {
  /** Sorted by id. */
  readonly templates: readonly CompiledEntry[];
  /** Entries that declare a template and did not compile, sorted by path. */
  readonly failures: readonly FailedEntry[];
  /** Candidate entries that declare no template: ordinary modules, partials and components. */
  readonly helpers: readonly string[];
  /** Project-level findings: a duplicate id. */
  readonly diagnostics: readonly EmailDiagnostic[];
  /** Every asset the templates import, deduplicated by content. */
  readonly assets: readonly AssetEntry[];
}

export interface CompileProjectInput {
  readonly files: ProjectFiles;
  /** Candidate entries, project-relative. */
  readonly entries: readonly string[];
  /**
   * Where imported assets are served from. Empty is deliberately invalid for
   * assets: no invented serving origin. A project that imports none needs none.
   */
  readonly assetBase: string;
  readonly theme?: { readonly css: string; readonly path: string } | undefined;
  readonly brand?: ResolvedBrand | undefined;
  readonly brandPlugin?: BrandPlugin | undefined;
}

const isHelper = (diagnostics: readonly EmailDiagnostic[]): boolean =>
  diagnostics.length > 0 && diagnostics.every((item) => item.code === "no-template");

const failure = (cause: unknown): EmailDiagnostic =>
  finding("compile-failed", "error", cause instanceof Error ? cause.message : String(cause));

type Compiled =
  | { readonly kind: "template"; readonly entry: CompiledEntry }
  | { readonly kind: "failed"; readonly entry: FailedEntry }
  | { readonly kind: "helper"; readonly entryPath: string };

const compileEntry = async (input: CompileProjectInput, entryPath: string): Promise<Compiled> => {
  const attempt = await compileTemplate({
    files: input.files,
    entry: entryPath,
    assetBase: input.assetBase,
    brandPlugin: input.brandPlugin,
    ...(input.brand === undefined ? {} : { brand: input.brand }),
    tailwind: input.theme === undefined ? {} : { css: input.theme.css, cssPath: input.theme.path },
  }).then(
    (compiled) => ({ ok: true as const, compiled }),
    (cause: unknown) => ({ ok: false as const, cause }),
  );
  if (!attempt.ok)
    return { kind: "failed", entry: { entryPath, diagnostics: [failure(attempt.cause)] } };
  const { compiled } = attempt;
  const template = compiled.template;
  if (template === undefined) {
    return isHelper(compiled.diagnostics)
      ? { kind: "helper", entryPath }
      : { kind: "failed", entry: { entryPath, diagnostics: compiled.diagnostics } };
  }
  return {
    kind: "template",
    entry: {
      id: template.template,
      entryPath,
      compiled: template,
      fixtures: compiled.fixtures,
      assets: compiled.assets,
      diagnostics: compiled.diagnostics,
      channels: channelsOf(template),
      brandPlugin: input.brandPlugin,
    },
  };
};

/**
 * Compile every candidate entry. An entry the compiler reports `no-template`
 * for is a helper module, not a template; that is how a partial is told apart
 * from a template without evaluating either. One failure stays with its entry.
 */
export const compileProject = async (input: CompileProjectInput): Promise<CompiledProject> => {
  const entries = [...input.entries].sort();
  const results = await Promise.all(entries.map((entryPath) => compileEntry(input, entryPath)));
  const templates: CompiledEntry[] = [];
  const failures: FailedEntry[] = [];
  const helpers: string[] = [];
  const diagnostics: EmailDiagnostic[] = [];
  const assets = new Map<string, AssetEntry>();
  const declaredBy = new Map<string, string>();
  for (const result of results) {
    if (result.kind === "helper") {
      helpers.push(result.entryPath);
      continue;
    }
    if (result.kind === "failed") {
      failures.push(result.entry);
      continue;
    }
    const { entry } = result;
    const previous = declaredBy.get(entry.id);
    if (previous !== undefined) {
      diagnostics.push(
        finding(
          "duplicate-template-id",
          "error",
          `Template id ${JSON.stringify(entry.id)} is declared by both ${previous} and ${entry.entryPath}. An id is a publication's identity, so it must name exactly one template.`,
        ),
      );
      continue;
    }
    declaredBy.set(entry.id, entry.entryPath);
    for (const asset of entry.assets) assets.set(asset.digest, asset);
    templates.push(entry);
  }
  return {
    templates: templates.sort((left, right) => (left.id < right.id ? -1 : 1)),
    failures,
    helpers,
    diagnostics,
    assets: [...assets.values()].sort((left, right) => (left.fileName < right.fileName ? -1 : 1)),
  };
};

/** A renderer refusal as findings about one fixture. */
const renderFindings = (
  cause: unknown,
  templateId: string,
  fixture: string,
): readonly EmailDiagnostic[] => {
  const carried = (cause as { readonly diagnostics?: unknown }).diagnostics;
  if (Array.isArray(carried) && carried.length > 0)
    return carried.map((item: { code: string; message: string }) =>
      finding(item.code, "error", item.message, { fixtures: [fixture] }),
    );
  return [
    finding(
      "render-failed",
      "error",
      `${templateId} could not render fixture ${JSON.stringify(fixture)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { fixtures: [fixture] },
    ),
  ];
};

/** What a fixture render reads besides the template and its input. */
export interface FixtureRenderOptions {
  /** Overrides the template's locale for formatters. */
  readonly locale?: string | undefined;
  /** IANA time zone for date and time formatters; defaults to UTC. */
  readonly timeZone?: string | undefined;
}

/** One fixture rendered through the email channel of the template it belongs to. */
export interface RenderedFixture {
  readonly templateId: string;
  readonly fixture: string;
  readonly rendered: RenderedEmail | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
}

/**
 * Render every fixture a template declares through its email channel. A fixture
 * the renderer refuses is a finding on that fixture, never a thrown error, so
 * one bad input does not take the rest of the catalog with it.
 */
export const renderEmailFixtures = (
  entry: Pick<CompiledEntry, "id" | "compiled" | "fixtures" | "brandPlugin">,
  options: FixtureRenderOptions = {},
): readonly RenderedFixture[] =>
  Object.entries(entry.fixtures).map(([fixture, input]) => {
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- Plain library boundary: the renderer signals a refused render by throwing.
    try {
      return {
        templateId: entry.id,
        fixture,
        rendered: render(entry.compiled, input, {
          channel: "email",
          ...options,
          ...(entry.brandPlugin === undefined ? {} : { brandPlugin: entry.brandPlugin }),
        }),
        diagnostics: [],
      };
    } catch (cause) {
      return {
        templateId: entry.id,
        fixture,
        rendered: undefined,
        diagnostics: renderFindings(cause, entry.id, fixture),
      };
    }
  });

/** Client-matrix findings across the fixtures that rendered. */
export const emailCompatibility = (
  entry: Pick<CompiledEntry, "compiled" | "fixtures" | "brandPlugin">,
  rendered: readonly RenderedFixture[],
): readonly EmailDiagnostic[] =>
  checkCompatibility(
    entry.compiled,
    Object.fromEntries(
      rendered
        .filter((result) => result.rendered !== undefined)
        .map((result) => [result.fixture, entry.fixtures[result.fixture]]),
    ),
    { brandPlugin: entry.brandPlugin },
  );

/** A channel's rendered output for one fixture, or the findings that stopped it. */
export type RenderedChannel =
  | { readonly ok: true; readonly channel: "sms"; readonly text: string }
  | { readonly ok: true; readonly channel: "whatsapp"; readonly message: RenderedWhatsApp }
  | { readonly ok: false; readonly diagnostics: readonly EmailDiagnostic[] };

/** Render the SMS or WhatsApp channel of one fixture. */
export const renderChannelFixture = (
  entry: Pick<CompiledEntry, "id" | "compiled" | "fixtures" | "brandPlugin">,
  channel: "sms" | "whatsapp",
  fixture: string,
  options: FixtureRenderOptions = {},
): RenderedChannel => {
  if (!Object.hasOwn(entry.fixtures, fixture))
    return {
      ok: false,
      diagnostics: [
        finding(
          "unknown-fixture",
          "error",
          `Template ${entry.id} declares no fixture named ${JSON.stringify(fixture)}.`,
        ),
      ],
    };
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Plain library boundary: the renderer signals a refused render by throwing.
  try {
    const input = entry.fixtures[fixture];
    return channel === "sms"
      ? { ok: true, channel, text: render(entry.compiled, input, { channel, ...options }).text }
      : { ok: true, channel, message: render(entry.compiled, input, { channel, ...options }) };
  } catch (cause) {
    return { ok: false, diagnostics: renderFindings(cause, entry.id, fixture) };
  }
};

export const hasErrors = (diagnostics: readonly EmailDiagnostic[]): boolean =>
  diagnostics.some((item) => item.severity === "error");
