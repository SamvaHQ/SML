import type { BrandPlugin } from "../email/brand-plugin";
import type { TemplateDiagnostic } from "../email/diagnostics";
import { samvaBrandPlugin } from "../email/samva-brand-plugin";
import { Findings } from "./diagnostics";
import { lowerProject } from "./lower-project";
import { loadProject } from "./project";

// The static profile check: does this entry still read as a template the compiler accepts?
// It runs the compiler's structural and lowering checks without Tailwind, a brand, or the
// files an import would need, so a visual editor can ask it synchronously about every edit.

const DEFAULT_ENTRY = "template.tsx";
/** Findings that come from the inputs this check leaves out, not from the source. */
// `unmatched-class` is a stylesheet finding: without Tailwind every class is unmatched.
const MISSING_INPUT_CODES = new Set(["brand-unavailable", "unmatched-class"]);

const asFiles = (
  files: string | Readonly<Record<string, string | Uint8Array>>,
  entry: string,
): Readonly<Record<string, string | Uint8Array>> =>
  typeof files === "string" ? { [entry]: files } : files;

/**
 * Check an entry against the static profile. Pass the entry's source alone, or the project's files
 * and the entry's path. Imports of files that are absent are trusted to exist, and the brand,
 * Tailwind and theme are not resolved, so the result holds only findings the source itself owns.
 */
export const checkStaticProfile = (
  files: string | Readonly<Record<string, string | Uint8Array>>,
  entry: string = DEFAULT_ENTRY,
  brandPlugin: BrandPlugin = samvaBrandPlugin,
): readonly TemplateDiagnostic[] => {
  const findings = new Findings();
  const project = loadProject(asFiles(files, entry), entry, findings, {
    brandPlugin,
    lenient: true,
  });
  if (project === undefined) return findings.items;
  lowerProject({ entry, brand: undefined, brandPlugin }, project, findings, {
    assets: [],
    stylesheets: new Map(),
    tailwindSheet: undefined,
    urlFor: (path) => `https://assets.invalid/${path}`,
  });
  const unresolved = [...project.unresolved];
  return findings.items.filter(
    (item) =>
      !MISSING_INPUT_CODES.has(item.code) &&
      !item.code.startsWith("tailwind-") &&
      !unresolved.some(
        (name) => item.message.includes(`<${name}`) || item.message.includes(`\`${name}\``),
      ),
  );
};

const key = (item: TemplateDiagnostic): string => `${item.code}\0${item.message}`;

/**
 * The errors in `after` that `before` did not already have, compared by code and message so a
 * finding that only moved does not count as new.
 */
export const introducedProfileErrors = (
  before: readonly TemplateDiagnostic[],
  after: readonly TemplateDiagnostic[],
): readonly TemplateDiagnostic[] => {
  const known = new Map<string, number>();
  for (const item of before)
    if (item.severity === "error") known.set(key(item), (known.get(key(item)) ?? 0) + 1);
  const added: TemplateDiagnostic[] = [];
  for (const item of after) {
    if (item.severity !== "error") continue;
    const remaining = known.get(key(item)) ?? 0;
    if (remaining > 0) known.set(key(item), remaining - 1);
    else added.push(item);
  }
  return added;
};

/**
 * The forms the static profile reads, as the contract publishes them. Each `example` is an
 * expression or element that `tests/static-profile-forms.test.ts` compiles clean inside a body
 * with the shared schema, so the table cannot list a form the compiler refuses.
 */
export const PROFILE_FORMS = [
  { form: "Text binding", example: "{input.name}", compilesTo: "bind" },
  {
    form: "Attribute binding",
    example: "{input.trackingUrl && <a href={input.trackingUrl}>Track</a>}",
    compilesTo: "bind on the attribute",
  },
  { form: "Template string", example: "`Order ${input.orderId}`", compilesTo: "concat" },
  { form: "Conditional", example: "{input.trackingUrl && <p>Track it</p>}", compilesTo: "if" },
  {
    form: "Either/or",
    example: "{input.vip ? <p>Gold</p> : <p>Standard</p>}",
    compilesTo: "if / else",
  },
  {
    form: "Conditions",
    example: "{input.items.length > 1 && input.total !== 0 && <p>Many</p>}",
    compilesTo: "a predicate (===, !==, <, >, !, &&, ||, .length)",
  },
  {
    form: "Loop",
    example: "{input.items.map((item, index) => <li key={index}>{item.title}</li>)}",
    compilesTo: "each",
  },
  {
    form: "Filtered loop or count",
    example: "{input.items.filter((item) => item.qty > 1).length}",
    compilesTo: "each with a where predicate, or a count",
  },
  {
    form: "Grid",
    example:
      "<Columns each={input.items} per={2}>{(item) => <Column><p>{item.title}</p></Column>}</Columns>",
    compilesTo: "each with a chunk size, one row per chunk",
  },
  {
    form: "Formatter",
    example: "{fmt.money(input.total, input.currency)}",
    compilesTo: "format",
  },
  {
    form: "Arithmetic",
    example: "{fmt.money(input.total * 2, input.currency)}",
    compilesTo: "an expression node, inside a formatter or condition",
  },
  {
    form: "Conditional class",
    example: '<p className={input.vip ? "bg-amber-100" : "bg-white"}>Hi</p>',
    compilesTo: "if on the attribute",
  },
] as const;

/** Forms the profile refuses, each with the code it reports. */
export const PROFILE_REJECTED = [
  {
    form: "A call other than fmt.* and .map",
    example: "{input.name.toUpperCase()}",
    code: "dynamic-expression",
  },
  {
    form: "A statement in a body",
    example: "(input) => { const label = input.name; return <Email>{label}</Email>; }",
    code: "statement-in-body",
    scope: "body",
  },
  { form: "A hook", example: "{useState(0)}", code: "hook-call" },
  {
    form: "An event handler",
    example: '<a href="/x" onClick={() => 1}>x</a>',
    code: "event-handler",
  },
  {
    form: "A class name built at run time",
    example: "<p className={`text-${input.name}`}>x</p>",
    code: "dynamic-class",
  },
] as const;
