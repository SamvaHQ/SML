# @samva/markup agent guide

`@samva/markup` is the authoring language and compiler for Samva templates. A template is one TSX
file in a static profile that default-exports `defineTemplate`: ordinary JSX, HTML and Tailwind that
a compiler reads without running. The compiler produces a versioned JSON IR, and a pure renderer
turns the IR and an input into subject, preheader, HTML and text, so nothing executes at send time.
A body that would compute over its input is a diagnostic, not a second mode: compute the value in
the caller and send it in the payload. The package is plain TypeScript with no application runtime;
the local editor, project builds, and exports live in `@samva/vite`.

## Entry points

Authoring entries are what a template file imports:

- `@samva/markup` — `defineTemplate({ id, schema, fixtures, locale?, email?, sms?, whatsapp? })`,
  `SmlTemplate`, `TemplateInput`, and `TEMPLATE_ID_PATTERN` (lowercase kebab-case, the rule the CLI
  and API slugs share). `email` is `{ subject, preheader?, body }`; each is a function of the
  validated input.
- `@samva/markup/email` — email primitives (`Email`, `Section`, `Columns`, `Button`, and the rest of
  its exports). They generate table layout and classic-Outlook fallbacks. Set
  `jsxImportSource: "@samva/markup/email"`; the runtime is `@samva/markup/email/jsx-runtime`.
- `@samva/markup/fmt` — `fmt.money`, `number`, `date`, `time`, `plural` and `list`: the only
  functions a body may call.
- `@samva/markup/sms` and `@samva/markup/whatsapp` — the channel components (`Sms`; `WhatsApp` with
  `WhatsApp.Header`, `Body`, `Footer`, `Buttons`, `UrlButton`, `QuickReplyButton`, `PhoneButton`,
  `CopyCodeButton`). `whatsappTemplate` derives Meta's positional `{{n}}` text.
- `@samva/markup/input-schema` — `inputSchema`, which turns any Standard JSON Schema into the
  portable JSON Schema and validator a template's input is checked against.
- `samva:brand` — `BrandLogo` (light logo, swapped for the dark one where the client honors dark
  mode) and `BrandFooter` (company, postal address, social links and the unsubscribe row the send
  path fills). The compiler binds them to the brand the build resolves; add
  `"types": ["@samva/markup/samva-brand"]` to the project's tsconfig for `tsc`. In `theme.css`,
  `@import "samva:brand";` layers the brand theme; `samva:brand/<slug>` names one brand. These are
  Samva's brand plugin (`samvaBrandPlugin` from `@samva/markup/brand`), the default; a host that
  delivers mail itself passes its own `BrandPlugin` as `brandPlugin` to `compileTemplate`,
  `renderIr` and `renderBrandFooter` to rename the brand import, the footer markers, the
  unsubscribe placeholder and the unsubscribe link's no-track marker.

Tooling entries are what a host (Vite, the CLI, the editor, the API, the template agent) imports:

- `@samva/markup/compiler` — `compileTemplate`, which reads a project's files and returns the IR,
  the fixtures, the assets and the diagnostics; `checkTemplateCompatibility` checks each fixture
  against the client matrix and locates findings at source. `checkStaticProfile(source | files,
entry?)` is the synchronous structural check: it runs the compiler's lowering without Tailwind, a
  brand or the files an import names, and returns only findings the source itself owns.
  `introducedProfileErrors(before, after)` is what a visual edit is refused on. It also holds the
  compiler's building blocks (`transformProject`, Tailwind, the cascade, CSS), the brand footer and
  sample renders (`renderBrandFooter`, `renderBrandSample`), and `TEMPLATE_NAME_PATTERN`. It imports no Vite, esbuild, or Node builtins, so it runs in any
  JavaScript host.
- `@samva/markup/diagnostics` — source spans and line maps, the `DIAGNOSTIC_CODES` registry with
  each code's fix and upgrade recipe, and `EmailDiagnostic`/`EmailCompileError`. It does not load
  the compiler, so a host that only reports imports it.
- `@samva/markup/render` — `renderIr(ir, input, { locale, timeZone })`, `renderIrSms` and
  `renderIrWhatsApp`; the IR types and `SML_IR_VERSION`; `renderIrPreview(ir, input)`, the render an
  editor shows, with an instance path (`INSTANCE_PATH_ATTRIBUTE`) on every element and the
  `selections` that map each one to its TSX span; `compileEmail`, the HTML serializer and text
  derivation; the email element table; SMS segment counts. Its import closure excludes the
  compiler's libraries (`tests/entry-closure.test.ts`): it is the send-time security boundary and
  what the API bundles.
- `@samva/markup/edit` — the code transforms behind visual edits (`inspectSourceElement`,
  `literalReplacement`, `expressionReplacement`, `classNameEdit`, `structuralReplacements`,
  `applySourceReplacements` with a `ProfileGuard`); form reads and exact edits for the `sms` and
  `whatsapp` channel bodies (`readSmsChannel`, `editSmsChannel`, `readWhatsAppChannel`,
  `editWhatsAppChannel`), where text between expressions is editable and every expression,
  conditional or element is a locked segment; and JSX source locations. Browser-safe: Babel parser
  only.
- `@samva/markup/brand` — brand records and their CSS model (`parseBrandCss`, `printBrandCss`), the
  footer markers a send reads (`renderedFooterMarkers`, `withoutUnsubscribeRow`), and project
  assets (`isAssetPath`, `ASSET_CONTENT_TYPES`, `assetUrl`): which imported files become
  content-addressed assets. The send path imports it, so its closure holds only the css-tree parser
  `theme.css` needs; rendering a footer compiles Tailwind and lives in `./compiler`.

`tests/published-dependencies.test.ts` pins this list. The compiler's libraries (Babel, Tailwind,
css-tree, caniemail) are dependencies, because a template project depends on this package alone and
`samva templates check` runs its installed compiler.

The package ships what an agent needs to author without this repository:

- `@samva/markup/contract.json` (`generated/contract.json`) — components with their props, the
  static-profile forms and the forms it refuses, formatters, HTML elements, channel specs and every
  diagnostic code with its fix. `@samva/markup/reference.md` renders the same contract for reading.
  `bun run codegen:contract` writes both from the modules that own each fact (component and `Fmt`
  interfaces, `PROFILE_FORMS`, `DIAGNOSTIC_CODES`, the element table), and a test fails when they
  drift.
- `skills/sml/SKILL.md` — the `sml` skill: the write, check, render, look, repair loop, the static
  profile and the data rules, for an agent that edits a template project.

Read the contract before authoring. Import only subpaths declared in `package.json` `exports`.

## How you hurt yourself here

- **Computing in a body.** A body is read, not run. A call other than `fmt.*` and `.map`, a
  statement (`const`, `if`, a loop), an import outside `@samva/markup` and the project, a hook, an
  event handler and `dangerouslySetInnerHTML` are each a diagnostic with a code, a location and a
  fix. Compute the value in the caller and send it in the payload. There is no escape hatch.
- **Chunking or counting in a body.** `items.reduce`, index arithmetic and `filter` helpers are
  calls the profile refuses. Use `<Columns each={list} per={n}>{(item) => <Column … />}</Columns>`
  for a grid and `.filter(condition)` before `.map` or `.length`; the condition is a `&&` / `?:`
  condition over the item.
- **Building a class name at run time.** Tailwind reads literal classes. `className={`text-${size}`}`
  is `dynamic-class`; choose between literal lists instead: `input.vip ? "bg-amber-100" : "bg-white"`.
- **Reading an optional field unguarded.** Binding `input.trackingUrl` outside
  `input.trackingUrl && …` is `unguarded-optional`; a misspelled field is `unknown-field` with the
  nearest match; a fixture that stopped matching the schema is `fixture-invalid`.
- **Reporting a finding without a registry entry.** `Findings.add` and the lowerer accept only
  codes in `DIAGNOSTIC_CODES` (`src/diagnostic-codes.ts`), which holds each code's meaning and fix.
  Add the entry with the code; the contract and the docs read it.
- **Putting the subject or preheader on `<Email>`.** They belong to the channel (`email.subject`,
  `email.preheader`); `<Email>` has no `preheader` prop.
- **Passing a string where you want markup.** Nothing an author passes as a string becomes markup;
  strings render as escaped text. There is no raw-HTML escape hatch: compatibility markup comes only
  from the email primitives.
- **Using an element or attribute the serializer does not allow.** `@samva/markup/render` is
  the one table behind both the JSX intrinsic prop types and the serializer's allowlist, so an
  unsupported element or attribute fails at typecheck and again at compile with a source location.
- **Naming a template or fixture like a path.** A template id and a fixture key are both written
  into file paths, so each must match `TEMPLATE_NAME_PATTERN`, one plain path segment.
  `defineTemplate` throws a `TypeError` where the name is declared. Code that builds a path from these
  names imports the pattern instead of restating it.
- **Declaring a webfont as if every client loads it.** A project font is an ordinary `@font-face`
  in the project's CSS (usually `theme.css`) whose `src` is a `.woff2` file in the project, named
  by a path relative to that stylesheet; the compiler serves it as a content-addressed asset and
  hides the rule from classic Outlook. Gmail and Outlook never load it, so a `font-family` stack
  that names a project font must end in a generic (`sans-serif`, `serif`, `monospace`) or the
  render fails with `email-font-fallback`. Only WOFF2 is accepted; an `https:` `src` stays an
  external reference.
- **Expecting the schema library to do the validation.** A template's input schema is converted to
  a portable JSON Schema and validated by that document, not by the library that produced it. A
  refinement that the converter cannot export is refused, and defaults are never inserted or values
  coerced. The README lists the supported keywords.

## Rules

- **Email entries default-export `defineTemplate`** from a `.tsx` file. The definition owns a
  stable, project-unique kebab-case `id`, an input schema, at least one fixture, and one body per
  channel. Helper modules are ordinary imports, not catalog entries; a partial is a function from
  props (and `children`) to JSX that the compiler inlines. A fixture is data: literals, constants
  and imported assets.
- **The IR is the artifact.** Rendering is a pure function of the IR and the input. The renderer
  escapes per context, applies the serializer's URL and style rules to every bound value, and
  rejects unsafe input rather than sanitizing it.
- **Failures are typed.** Compilation reports diagnostic values with a code, a location and a fix:
  `compileTemplate` returns them beside the IR, and an error finding leaves no IR. A declaration the compiler cannot
  accept at all, such as an invalid name or a nonportable input schema, throws a `TypeError`.
- **Data models are plain types.** Markup's data models are TypeScript types, not schema
  declarations, so there is no schema library to adopt to consume them. Unions discriminate on
  `type`; only error classes carry `_tag`. The input schema is the one
  place a Standard Schema is accepted, and which library produces it is yours to choose.

## Proving your setup

- `tsc --noEmit` over the template project catches unsupported elements, attributes, and props.
- `compileTemplate` reports every static-profile, binding and fixture finding with a source
  location, and `renderIr(compiled.ir, fixture)` proves one fixture's output without executing the
  template.
- `samva templates check` (from `@samva/cli`) compiles every entry and renders every fixture,
  reporting findings with source locations.
- `renderIrPreview(compiled.ir, fixture)` returns the same document with the source spans an editor
  selects by.
