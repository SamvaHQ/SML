import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import type { RenderedIrWhatsApp, RenderOptions } from "@samva/markup/render";

import { brandDiagnostics } from "./brand";
import {
  finding,
  hasErrors,
  renderChannelFixture,
  renderEmailFixtures,
  type CompiledEntry,
} from "./compile";
import { loadProject, type ProjectOptions } from "./project";

// One template and one fixture, compiled and rendered from the project's files.
// The programmatic render boundary returns plain JSON values.

export interface RenderTemplateInput extends ProjectOptions {
  /** A template id, or the project-relative path of its entry. */
  readonly template: string;
  readonly fixture: string;
  /** Overrides the template's locale for formatters. */
  readonly locale?: string | undefined;
  /** IANA time zone for date and time formatters; defaults to UTC. */
  readonly timeZone?: string | undefined;
}

export type RenderTemplateResult =
  | {
      readonly ok: true;
      readonly template: string;
      readonly fixture: string;
      readonly subject: string;
      readonly preheader?: string | undefined;
      readonly html: string;
      readonly text: string;
      readonly diagnostics: readonly EmailDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly EmailDiagnostic[] };

export type RenderChannelInput = RenderTemplateInput & { readonly channel: "sms" | "whatsapp" };

export type RenderChannelResult =
  | {
      readonly ok: true;
      readonly channel: "sms";
      readonly template: string;
      readonly fixture: string;
      readonly text: string;
      readonly diagnostics: readonly EmailDiagnostic[];
    }
  | {
      readonly ok: true;
      readonly channel: "whatsapp";
      readonly template: string;
      readonly fixture: string;
      readonly message: RenderedIrWhatsApp;
      readonly diagnostics: readonly EmailDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly EmailDiagnostic[] };

type Located =
  | { readonly ok: true; readonly entry: CompiledEntry; readonly diagnostics: EmailDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: EmailDiagnostic[] };

/** Compile just enough of the project to find and build the named template. */
const locate = async (input: RenderTemplateInput): Promise<Located> => {
  const byPath = input.template.endsWith(".tsx");
  const project = await loadProject(
    input,
    byPath ? [input.template.replace(/^\.\//, "")] : undefined,
  );
  const { catalog } = project;
  const entry = catalog.templates.find((candidate) =>
    byPath
      ? candidate.entryPath === input.template.replace(/^\.\//, "")
      : candidate.id === input.template,
  );
  const brand = brandDiagnostics(project.brand);
  // Two entries declaring the requested id make a render of it ambiguous, as they do the build.
  // Duplicates of other ids do not touch this template.
  const ambiguous =
    entry === undefined
      ? []
      : catalog.diagnostics.filter(
          (item) =>
            item.code === "duplicate-template-id" &&
            item.message.startsWith(`Template id ${JSON.stringify(entry.id)} `),
        );
  if (entry !== undefined && ambiguous.length === 0)
    return { ok: true, entry, diagnostics: [...brand, ...entry.diagnostics] };
  // A template requested by id whose entry did not compile has no id to match, so every failed
  // entry's findings are shown beside the not-found note.
  const failed = byPath
    ? catalog.failures.filter(
        (candidate) => candidate.entryPath === input.template.replace(/^\.\//, ""),
      )
    : catalog.failures;
  return {
    ok: false,
    diagnostics: [
      ...brand,
      ...catalog.diagnostics,
      ...failed.flatMap((candidate) => candidate.diagnostics),
      ...(entry !== undefined || (byPath && failed.length > 0)
        ? []
        : [
            finding(
              "template-not-found",
              "error",
              `No template ${JSON.stringify(input.template)} in the project${failed.length > 0 ? ", and some entries did not compile (their findings are listed)" : ""}. Known templates: ${catalog.templates.map((candidate) => candidate.id).join(", ") || "none"}.`,
            ),
          ]),
    ],
  };
};

/** Compile the project and render one fixture of one template through its email channel. */
export const renderTemplate = async (input: RenderTemplateInput): Promise<RenderTemplateResult> => {
  const located = await locate(input);
  if (!located.ok) return located;
  const { entry } = located;
  if (!entry.channels.includes("email"))
    return {
      ok: false,
      diagnostics: [
        finding("missing-channel", "error", `Template ${entry.id} declares no email channel.`),
      ],
    };
  const [rendered] = renderEmailFixtures(
    { ...entry, fixtures: pick(entry.fixtures, input.fixture) },
    renderOptions(input),
  );
  if (rendered === undefined)
    return {
      ok: false,
      diagnostics: [...located.diagnostics, unknownFixture(entry, input.fixture)],
    };
  if (rendered.rendered === undefined || hasErrors(located.diagnostics))
    return { ok: false, diagnostics: [...located.diagnostics, ...rendered.diagnostics] };
  return {
    ok: true,
    template: entry.id,
    fixture: input.fixture,
    subject: rendered.rendered.subject,
    ...(rendered.rendered.preheader === undefined
      ? {}
      : { preheader: rendered.rendered.preheader }),
    html: rendered.rendered.html,
    text: rendered.rendered.text,
    diagnostics: located.diagnostics,
  };
};

/** Compile the project and render one fixture of one template through its SMS or WhatsApp channel. */
export const renderChannel = async (input: RenderChannelInput): Promise<RenderChannelResult> => {
  const located = await locate(input);
  if (!located.ok) return located;
  const { entry } = located;
  if (!entry.channels.includes(input.channel))
    return {
      ok: false,
      diagnostics: [
        finding(
          "missing-channel",
          "error",
          `Template ${entry.id} declares no ${input.channel} channel.`,
        ),
      ],
    };
  const rendered = renderChannelFixture(entry, input.channel, input.fixture, renderOptions(input));
  if (!rendered.ok || hasErrors(located.diagnostics))
    return {
      ok: false,
      diagnostics: [...located.diagnostics, ...(rendered.ok ? [] : rendered.diagnostics)],
    };
  return rendered.channel === "sms"
    ? {
        ok: true,
        channel: "sms",
        template: entry.id,
        fixture: input.fixture,
        text: rendered.text,
        diagnostics: located.diagnostics,
      }
    : {
        ok: true,
        channel: "whatsapp",
        template: entry.id,
        fixture: input.fixture,
        message: rendered.message,
        diagnostics: located.diagnostics,
      };
};

const renderOptions = (input: RenderTemplateInput): RenderOptions => ({
  ...(input.locale === undefined ? {} : { locale: input.locale }),
  ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
});

const pick = (fixtures: Readonly<Record<string, unknown>>, name: string) =>
  Object.hasOwn(fixtures, name) ? { [name]: fixtures[name] } : {};

const unknownFixture = (entry: CompiledEntry, fixture: string): EmailDiagnostic =>
  finding(
    "unknown-fixture",
    "error",
    `Template ${entry.id} declares no fixture named ${JSON.stringify(fixture)}. Declared: ${Object.keys(entry.fixtures).join(", ")}.`,
  );
