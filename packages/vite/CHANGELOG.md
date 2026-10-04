## @samva/vite@0.11.1

### The bundled editor ships its dependencies' licences

`@samva/vite`'s built editor (`dist/editor`) now includes a licence notice under `dist/editor/licenses/`
for every third-party package bundled into it, such as React, Base UI, Floating UI, zustand, Effect and
Hugeicons. A package that publishes no licence file gets a notice built from the licence its
`package.json` declares.

## @samva/vite@0.11.0

### The local editor draws Hugeicons and the editor's own control styling

The editor `samva templates dev` and the Vite plugin serve now draws its icons from the Hugeicons
free set (Stroke Rounded, MIT), whose licence files ship in `dist/editor/licenses`. Toggles that are
on and the source panel take the editor's own recessed styling in light and dark mode, matching the
Samva dashboard.

### Breaking: `@samva/markup` reads brand and footer names from a brand plugin

Templates do not change: `samva:brand`, `BrandLogo`, `BrandFooter` and the unsubscribe row work as
before, because Samva's brand plugin is the default.

A host that compiles or renders templates can pass its own `BrandPlugin` as `brandPlugin` to
`compileTemplate`, `transformProject`, `projectBrandSpecifier`, `parseBrandSpecifier`,
`checkStaticProfile`, `renderIr`, `compileEmail`, `renderBrandFooter`, `renderBrandSample`,
`brandComponents`, `renderedFooterMarkers` and `withoutUnsubscribeRow`. The plugin names the brand
import, the attributes that mark the footer and its unsubscribe row, the unsubscribe link's URL
placeholder, and the attribute that marks that link as untracked.

`BrandFooter`'s unsubscribe link now carries `data-samva-no-track` instead of SES's
`ses:no-track`. A host that delivers mail through SES turns the marker into `ses:no-track` before it
sends.

`@samva/markup/brand` exports `samvaBrandPlugin` and the `BrandPlugin` type in place of
`FOOTER_ATTRIBUTE`, `UNSUBSCRIBE_ROW_ATTRIBUTE` and `UNSUBSCRIBE_URL_PLACEHOLDER`; read
`samvaBrandPlugin.footerAttribute`, `.unsubscribeRowAttribute` and `.unsubscribeUrlPlaceholder`.
`@samva/markup/compiler` no longer exports `BRAND_SPECIFIER`; read `samvaBrandPlugin.specifier`.

### Breaking: supply brand resolution to the authoring toolchain

`@samva/vite` accepts `brandResolver` and `brandPlugin` on the editor plugin and its dev, project,
build, render and export APIs. A brand import without a resolver fails with `brand-unavailable`.
Standalone callers supply a resolver; the package does not read Samva credentials, invoke the
Samva CLI or load Samva brand snapshots. The `offline` option and Samva snapshot helpers move to
the CLI.

`samva templates dev`, `check`, `build`, `render`, `snapshot` and `export` supply the Samva resolver
and brand plugin, preserving live lookup, cached snapshots and brand diagnostics.

## @samva/vite@0.10.0

### Breaking: `@samva/markup` publishes 17 entries in two tiers

Template files import `@samva/markup`, `@samva/markup/email`, `@samva/markup/fmt`,
`@samva/markup/sms`, `@samva/markup/whatsapp` and `@samva/markup/input-schema`. Email components
move from `@samva/markup/email/components` to `@samva/markup/email`, the entry `jsxImportSource`
already names. A template that still imports the old path fails with `moved-import`, which names
the replacement.

Hosts import five tooling entries:

| Entry                       | Replaces                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@samva/markup/compiler`    | `./compiler`, `./static`, `./template` (`TEMPLATE_NAME_PATTERN`), `./email/brand-footer`                                   |
| `@samva/markup/diagnostics` | `./diagnostics`, `./diagnostic-codes`, `./email/diagnostics`                                                               |
| `@samva/markup/render`      | `./ir`, `./render-ir`, `./preview`, `./email/render`, `./email/html`, `./email/text`, `./email/elements`, `./sms-segments` |
| `@samva/markup/edit`        | `./source-edit`, `./channel-edit`, `./source-locations`                                                                    |
| `@samva/markup/brand`       | `./email/brand`, `./email/assets`, `./theme-css`                                                                           |

`@samva/markup/reference.md` replaces `@samva/markup/generated/*`. `tailwindcss`, `css-tree`,
`caniemail` and `@babel/parser` are dependencies instead of optional peers, so a project that
depends on `@samva/markup` alone can run `samva templates check`.

## @samva/vite@0.9.0

### Breaking: the editor, build and render run on the compiled template, not on evaluated code

`@samva/vite` compiles every template with the static compiler from `@samva/markup` and renders the
IR, so nothing in your project is executed to preview, check, build or export it. A local render is
the render a published template produces, and top-level code in a template module no longer runs.
Templates are `defineTemplate` files; a `defineEmail` entry is reported as an error.

- **Directories.** Templates live in `templates/` by default, and `emails/` is recognized beside it.
  Set `templatesDir` on `samvaEditor()` (or `dir` on the entry points) to scan one directory
  instead; `projectRoot` names the folder that holds `theme.css`, shared imports and `.samva/` when
  it is not the Vite root. Document ids are project-relative paths, and a template that declares
  SMS or WhatsApp gets one editor document per channel over the same file.
- **`.samva/`.** The brand record `samva:brand` resolves is fetched live and cached in
  `.samva/brands/<slug>.json`, refreshed by every live fetch, and used with a warning when the API
  is unreachable. Keep `.samva` in `.gitignore`.
- **`@samva/vite/dev`** adds `startDevServer({ root, dir?, port?, host?, open? })`, a Vite dev server
  with no config file that serves the editor; `samva templates dev` runs it.
- **`@samva/vite/render`** adds `renderTemplate` and `renderChannel`, which compile a project and
  render one template and fixture to plain JSON, for `samva templates render`.
- **`@samva/vite/build`** takes one options object: `buildTemplates({ root, dir, theme, assetBase })`
  and `createTemplateBuildSession(options)`. Results carry `ok`, per-template IR, input schema,
  every fixture rendered through every declared channel, and client-compatibility findings.
- **`@samva/vite/project`** replaces `loadEmailCatalog`, `renderEmailFixtures`,
  `createEmailProjectSession` and `exportEmailProject` with `loadProject`, `compileProject`,
  `createProjectSession` and `exportProject`. Exports also write `<fixture>.sms.txt` and
  `<fixture>.whatsapp.json` for those channels.
- **Removed.** `@samva/vite/email`, `@samva/vite/emit`, the Vite config-file and alias caveats of
  the old evaluator, and the `better-result` dependency.

### Breaking: remove textual email SML APIs

`@samva/markup` removes textual email SML components and grammar types, plus the
`@samva/markup/candidate`, `/classes`, `/checks`, `/model`, `/ops`, `/registry`, and `/tsx-tracer`
subpaths. Email templates use TSX `defineEmail` modules and lower directly to subject, HTML, and text
through the email semantic tree. The structured SML language and compiler remain for SMS and
WhatsApp.

`@samva/vite` removes `darkClassCount` from the public `AuthoringValidationSummary` returned by its
emit API. Email validation no longer reports a count derived from textual email SML classes.

### Breaking: templates are `defineTemplate` in a static profile

`@samva/markup` adds `defineTemplate({ id, schema, fixtures, locale?, email, sms?, whatsapp? })` at
its root. A template is one TSX file in a static profile that the new compiler reads without running:
text and attribute bindings, template strings, `&&`, `?:`, comparisons, `||`, `.length`, `.map`,
`fmt.*` calls, arithmetic inside formatter arguments and conditions, partials with props and
children, conditional class names, `.filter(condition)` before `.map` or `.length`, and
`<Columns each per>` for grids (a `Column` without a `width` takes an equal share of its row). Everything else is a compile error with a stable code, a
`file:line:column` location and a fix.

- `@samva/markup/static` compiles a project to a versioned JSON IR (`"sml": 1`) and checks every
  binding against the input schema: `unknown-field` with a did-you-mean, `unguarded-optional`, and
  `fixture-invalid` per fixture. Tailwind, project CSS, brand themes, fonts and assets resolve at
  compile time, and `checkTemplateCompatibility` locates client findings at source.
- `@samva/markup/render-ir` renders the IR against an input as a pure, dependency-free function.
  It escapes for text, attribute and URL contexts and rejects unsafe bound values.
- `@samva/markup/fmt` adds the deterministic formatters `money`, `number`, `date`, `time`, `plural`
  and `list`, which take their locale and time zone from the render.
- `@samva/markup/sms` and `@samva/markup/whatsapp` add channel components with distinct names per
  channel; WhatsApp bindings become Meta's positional `{{n}}` placeholders.
- `id` is lowercase kebab-case, the rule the CLI and API slugs share. `subject` and `preheader`
  belong to the channel; the `Email` component no longer takes a `preheader` prop.

`defineEmail` remains for templates that compute over their input, and it stays outside the static
profile.

## @samva/vite@0.8.0

### Breaking: `@samva/markup/presets` is `@samva/markup/starters`

Every `@samva/markup/presets*` subpath is renamed to `@samva/markup/starters*`, and its exports
follow: `presetCatalog` is `starterCatalog`, `presetProject` is `starterProject`,
`presetEmailFixtures` is `starterEmailFixtures`, and every other `preset*` / `Preset*` name reads
`starter*` / `Starter*`. A public gallery entry's `presetId` is `starterId`, and the corpus
record types are `OwnedEditableStarter` and `BrandRecreationStarter`. `RECOMMENDED_THEME` and
`showcaseProjectPaths` are removed.

### Starters on theme variables

Every starter styles each color and font through a theme variable, and keeps its look in its own
`starter.css`. `@samva/markup/starters/theme` names the variables every starter defines and a
brand sets to restyle one (`STARTER_THEME_VARIABLES`: `--color-brand`, `--color-surface`,
`--font-body` and the rest; `starterThemeVariableNames` adds each color's `-dark` pair) and writes
the `theme.css` a project starts with (`starterThemeCss({ brand })`), which imports `samva:brand`
only when `brand` is true:

```css
@import "./starter.css";
@import "samva:brand";
@theme {
}
```

`var()` now resolves in a `Button`'s classic Outlook shape and in a `bgcolor`, so
`<Button backgroundColor="var(--color-brand)">` paints the theme color everywhere. Every `@theme`
in project and brand CSS compiles as `static`, so a variable a project stylesheet reads reaches
the inliner even when no utility class reads it.

### Theme imports and brand themes

A project `theme.css` layers with `@import`: another project stylesheet by relative path, then the
organization's brand, then the project's own `@theme` overrides.

```css
@import "./starter.css";
@import "samva:brand";

@theme {
  --color-accent: #0f766e;
}
```

`samva:brand` names the organization's default brand and `samva:brand/<slug>` names one brand; the
build supplies it through `compileEmailProject`'s `brand` option. `parseBrandCss` and
`printBrandCss` (`@samva/markup/theme-css`) read and write the brand theme grammar: `@theme`
variables in the color, font, text, leading, tracking, radius, spacing, container and shadow
namespaces, `--color-*` variables in a `@media (prefers-color-scheme: dark)` block, and
`@font-face` rules with https WOFF2 sources. A dark-mode color compiles to its `--color-*-dark`
theme variable, read by `dark:` utilities.

A project compiles against one brand: importing two fails with `brand-import-conflict`, and a
`samva:brand` import the build has no brand for, or whose slug names another brand, fails with
`brand-unavailable`. A brand theme outside the grammar fails with its `brand-css-*` finding.
`@samva/markup/compiler` exports `parseBrandSpecifier`, `projectBrandSpecifier` and the
`EmailBrand` types.

Breaking: any other `@import` in the theme — including `@import "tailwindcss"` — now refuses the
compile with `css-import-unresolved` instead of resolving to nothing. An `@import` with layer,
supports or media conditions, one that imports itself, or a `.css` path outside the project is
refused the same way. A theme with no utility class in use still compiles its `@font-face` rules.

### `BrandLogo` and `BrandFooter`

```tsx
import { BrandFooter, BrandLogo } from "samva:brand";
```

`BrandLogo` renders the brand's logo and swaps to its dark logo where the client honors dark mode.
It takes `width` (default 120), `alt`, `align` and `className`, and renders nothing when the brand
has no logo. `BrandFooter` takes `unsubscribeLabel` and `className`.
`BrandFooter` renders the company name, postal address, social links and an unsubscribe row; the
send path fills the unsubscribe link per delivery and never click-tracks it, and a template that
renders `BrandFooter` gets no appended footer. Add `"types": ["@samva/markup/samva-brand"]` to the
project's tsconfig so `tsc` knows the module.

### Breaking: token-table exports removed

`@samva/markup/footer`, `@samva/markup/theme`, and `@samva/markup/tokens` are removed; a brand's
footer renders through `BrandFooter`. `parseThemeCss` and `printThemeCss` are replaced by
`parseBrandCss` and `printBrandCss` in `@samva/markup/theme-css`.

### Local builds resolve `samva:brand`

`samvaEditor()`, `buildTemplates()` and `exportEmailProject()` compile a project that imports
`samva:brand` or `samva:brand/<slug>` against its organization's brand, resolved in this order:

1. Live. With `SAMVA_API_KEY` in the environment or the project's `.env` (and `SAMVA_API_URL` for
   another API), the brand is fetched from `/v1/brands`. Without one, the `samva` CLI on `PATH`
   answers `samva brands get --json` with its `samva login` session; `@samva/vite` stores no
   credential.
2. Snapshot. `.samva/brands/<slug>.json`, written by `samva brands pull [slug]`, with a
   `brand-offline` warning. The default brand reads the most recent snapshot pulled while it was
   the default.
3. Neither. The build fails with `brand-unavailable`, naming both fixes.

When the live brand's digest differs from the snapshot's, the build warns with
`brand-snapshot-stale`; run `samva brands pull` again. Warnings are build diagnostics and editor log
lines and never fail a build. The editor and `check --watch` reuse a resolution for up to 30
seconds. Keep `.samva` in `.gitignore`; a project that imports no brand needs no credentials.

`@samva/vite/project` exports `resolveProjectBrand`, `loadBrandEnv`, `BRAND_SNAPSHOT_DIR` and the
`BrandResolution`, `BrandSnapshot`, `BrandWarning` and `ResolvedBrand` types. The editor recompiles
the theme when any stylesheet it imports changes.

### Breaking: `exportEmailProject` themes the export

`exportEmailProject` drops `tailwind` and takes `root` and `theme`. `dir` holds the templates and
`root` (default `dir`) is the project: its `theme.css` themes the export as in `buildTemplates()`,
`theme` names another file or `false` disables it, and only `.tsx` files under `dir` are entries.

```ts
const receipt = await exportEmailProject({ dir: "emails", root: ".", out: "dist/email" });
```

### Project fonts in `@font-face`

A template project declares a webfont with ordinary CSS: an `@font-face` in `theme.css` (or any
imported stylesheet) whose `src` names a `.woff2` file in the project, plus a `--font-*` token in
`@theme`.

```css
@font-face {
  font-family: "Brand Sans";
  src: url("./fonts/brand-sans.woff2") format("woff2");
  font-weight: 400;
}
@theme {
  --font-brand: "Brand Sans", Helvetica, Arial, sans-serif;
}
```

The compiler serves the file as a content-addressed asset, so local previews, exports and
publications all load the same bytes, and it puts the rule in a `<style>` classic Outlook does not
read, so Outlook uses the rest of the stack instead of Times New Roman.

Breaking for projects that already declared fonts: a relative `src` that names no project file, a
source that is not WOFF2, and an `http:` or `data:` source are compile errors, and a `font-family`
stack that names a project font without ending in a generic family fails with
`email-font-fallback`. `Stylesheet` gains `fontFaces`, and `@font-face` no longer appears in
`headAtRules`.

## @samva/vite@0.7.0

### Breaking: WhatsApp `category="service"` removed

`<WhatsApp category>` accepts `marketing`, `utility`, or `authentication`, the categories Meta
approves templates under.

## @samva/vite@0.6.0

### Improve markup compilation safety

Invalid or unsafe markup is now rejected earlier, preventing malformed email output. Complex styles
and conditions also compile more reliably.

### Carry the plain-text alternative on a public preview artifact

`buildPublicTemplatePreviewArtifact` returns `text` alongside `html`, `subject` and `preheader`, so
a surface that mounts a preset's published preview has the whole executed fixture rather than its
HTML half. It is the same value `renderEmail` derived when the artifact was built; nothing is
recomputed.

## @samva/vite@0.5.0

### Breaking: a template project no longer installs Effect

- **A much smaller install:** `@samva/markup` has no Effect dependency and no `ajv` dependency, so a template project's lockfile and `node_modules` drop both graphs. The JSON Schema 2020-12 dialect the input validator checks against ships inside the package. Writing templates is unchanged: JSX, `defineEmail`, components, fixtures, and the input schema all work exactly as before, and you can still declare template input with an Effect, Zod, or plain JSON schema.
- **`@samva/vite` drops Effect too:** The Vite plugin carries no Effect dependency either, so `samva email templates build`, the editor dev server, and a template project that installs both packages resolve neither graph.
- **Breaking: compile and render results:** Everything the compiler returns is now a [better-result](https://better-result.dev) `Result`. Read a success with `Result.isOk(result)` and `result.value`, a failure with `Result.isError(result)` and `result.error`. Errors keep their names and tags — `SmlParseError`, `SmlCompileError`, `SmlOpError`, `EmailCompileError` — so code that matches on `_tag` or catches `EmailCompileError` still works.
- **Breaking: data unions discriminate on `type`:** `EmailNode` and the editor-op, corpus and gallery unions name their variant with `type` instead of `_tag` — `node.type === "Element"`, `op.type === "setProp"`. Compiler errors are unaffected: `SmlParseError`, `SmlCompileError`, `SmlOpError` and `EmailCompileError` keep `_tag`, which is their error library's own field.
- **Breaking: schema values are gone:** The package declares its data models as TypeScript types only. Runtime schema values such as `EmailDiagnostic`, `EmailElementSelection`, `SmlOpSchema`, and `SmlDocumentSchema` no longer exist; the types of the same name do, and the shapes are identical. If you decoded one of these at a boundary, declare the schema in your own project against the exported type.

## @samva/vite@0.4.0

### Faster, reliable saves in large projects

- **Saves in large projects are quick again:** Saving a template no longer re-evaluates every template in the project, so previews come back in about the time one template takes to build.
- **No false "Document changed elsewhere" banner:** Your own edits and fixture switches are recognized as yours, so the editor no longer locks the source panel and undo after a save. Edits made outside the editor are still detected.

### Breaking: every email template is a complete, editable project

- **28 templates rebuilt:** The 28 remaining single-file presets are rebuilt as showcase projects with their own stylesheet, drawn artwork, and `default` and `long-content` sample data. Marketing, digest, lifecycle, commerce, and notification templates are covered, authored for five fictional senders: Northwick, Kestrel, Northloop, Fernhollow, and Meridian. Template ids and their gallery pages are unchanged.
- **Breaking: simpler template inputs:** Repeating content such as stories, deals, agenda items, checklist steps, and order lines is a list instead of numbered fields. Images are bundled with the project instead of passed as URLs, and headline and body copy is edited in the template source rather than supplied as input. Optional sections such as sponsors, gift cards, and reminders appear only when you send them. Dates, days remaining, and step numbers come from your input, so scheduled sends never depend on the clock. If you render one of these templates with your own data, move to the new input shape; each template's sample data shows it.
- **Breaking: four presets retired:** `receipt`, `newsletter`, `promo`, and `order-delivered` are removed from the catalog, the public gallery, and the `PresetId` types. Use `order-receipt`, `product-newsletter`, and `product-launch-promo` instead.
- **Stock photography removed:** The onboarding tour and setup checklist templates now use drawn artwork, so no template depends on third-party images.

## @samva/vite@0.3.0

- **Reliable project styling:** Switching between projects or preview fixtures preserves each template's styles and avoids unexpected revision changes.
- **Better Outlook buttons:** `<Button>` sizes to its label without requiring a fixed width. Explicit widths remain supported.
- **New editable templates:** Product newsletter, order receipt, product launch promotion, and an attributed Vercel invitation, including styles, images, and sample data.
- **Richer template inputs:** Use lists and objects for repeating content such as newsletter stories and receipt items.
- **Cleaner plain-text emails:** Empty table cells no longer leave unnecessary separators.
- **For custom render integrations:** `bindStylesheets` from `@samva/markup/email/render` binds a renderer to one project's styles.

## @samva/vite@0.2.0

### Breaking: author email templates with typed input and executable TSX

Email entries now default-export `defineEmail({ id, schema, fixtures, render })` from
`@samva/markup/template`. Replace function-based email entries and `Variables<T>` placeholders
with a schema and a `render(input)` function. Set `jsxImportSource` to `@samva/markup/email`,
import email components from `@samva/markup/email/components`, and upgrade `@samva/markup` and
`@samva/vite` together to 0.2.0. Regenerate the project's dependency lockfile before publishing.

The input contract supports Standard JSON Schema, including Effect and Zod schema adapters.
`TemplateInput<typeof template>` extracts the inferred input type. Named fixtures supply preview
and validation inputs; rendering evaluates ordinary TSX, imported components, conditionals and
mapped arrays against actual input. Time and randomness must come from input or fixed `runtime`
configuration.

The shared local and hosted compiler resolves CSS, Tailwind and imported assets, validates fixture
inputs, and produces HTML, text and email-client diagnostics. Diagnostics identify known support
constraints; they do not certify rendering in every email client.

The Vite editor maps rendered instances to canonical TSX source. Literal edits preserve the
source expression; computed or structural changes use reviewed source edits. Fixture switching,
undo/redo, save/reopen and revision-conflict handling keep source edits tied to the preview.

Published email templates pin an executable, input contract, dependency graph and runtime
configuration. Existing email source must adopt the new contract and be republished; previously
published HTML snapshots are not executable publications.

## @samva/vite@0.1.2

### Reject oversized SML templates before compilation

Templates that exceed supported size, nesting, or node limits now return a validation error before
compilation.

## @samva/vite@0.1.1

### Release the 0.1.1 package family

`@samva/vite` publishes with the rest of the 0.1.1 family.

## @samva/vite@0.1.0

### Publish the Samva template authoring toolchain

`@samva/markup` and `@samva/vite` are published on npm. They provide typed TSX authoring, local
visual editing, and deterministic template builds. `samva templates push` uploads the compiled
templates.
