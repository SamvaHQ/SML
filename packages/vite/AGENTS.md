# @samva/vite agent guide

`@samva/vite` is the local authoring toolchain for Samva templates written with `@samva/markup`: a
Vite plugin that serves the visual editor, a config-free dev server, and programmatic entry points
that build, render, and export a template project. A template is one TSX file in a static profile,
and nothing here runs it: every check, render and preview is `compileTemplate` from
`@samva/markup/compiler` followed by `renderIr`, the same two steps a hosted Samva build takes, so a
local render does not drift from a published one. Publishing and hosted synchronization are not
here: they are ordinary Git plus `samva templates publish` from `@samva/cli` (see
`samva templates --help`).

## Entry points

- `@samva/vite` — `samvaEditor()`, the plugin you add to `vite.config.ts` when the defaults do not
  cover your setup. Options are typed by `SamvaEditorPluginOptions`; the README lists them.
- `@samva/vite/dev` — `startDevServer(options)`: a Vite server with no config file,
  `samvaEditor()`, and defaults. It is what `samva templates dev` starts.
- `@samva/vite/build` — `buildTemplates(options)` and `createTemplateBuildSession(options)` for
  programmatic checks and builds. The `samva` CLI loads this module from your project, not from its
  own bundle.
- `@samva/vite/render` — `renderTemplate()` and `renderChannel()`: one template and fixture to a
  plain JSON result.
- `@samva/vite/project` — the folder-of-templates surface: `loadProject()`, `compileProject()`,
  `createProjectSession()`, `exportProject()` and the render helpers over a compiled entry.

Install `@samva/markup`, `@samva/vite`, and the `vite` peer as dev dependencies of the template
project and keep them in its lockfile. The CLI's `templates check`, `templates build`,
`templates render` and the editor all resolve these packages from the project, so the lockfile is
what pins the compiler version your previews, checks, and builds use.

## How you hurt yourself here

- **Expecting a template module to run.** The compiler reads the file and never executes it, so
  top-level code, imports of constants, and helper calls do nothing. A value a template needs is
  input data, a fixture literal, or an import the static profile allows (a partial, a stylesheet,
  an asset). `samva templates check` reports what the profile refuses, with a location and a fix.
- **Expecting your Vite config to apply to templates.** Nothing about a template goes through
  Vite's module graph, so your `vite.config.ts` aliases and plugins never reach one. Import
  partials by relative path.
- **Putting templates where the project root cannot see them.** Files are addressed relative to
  the project root, which holds `theme.css`, shared imports and `.samva/`. A templates directory
  outside it is refused rather than half-read. Set `projectRoot` (plugin) or `root` (entry points)
  to a folder that contains both.
- **Scanning the wrong directories.** With no `dir`, `templates/` and `emails/` are both scanned,
  whichever exist. Setting `dir` scans only that one, so a project that keeps templates in both
  and sets `dir` loses the other.
- **Relying on a file path as template identity.** Identity is the `id` the definition declares.
  Two definitions declaring one id is a reported error, and moving a file does not change its id.
  Helper modules need no marker or exclusion list: a module is a template only if its default
  export is `defineTemplate`. An editor document is a template's path plus its channel.
- **A broken file elsewhere in the project.** The compiler reads an entry and the files it imports.
  A file it cannot parse is a finding that names the file, and it stops the templates that import
  it; the others keep their render.
- **Exporting for delivery with the default asset base.** `exportProject` renders with relative
  URLs and writes each page at `templates/<id>/<fixture>.html` beside a content-addressed `assets/`
  directory, so its default base, `DEFAULT_EXPORT_ASSET_BASE`, only works when those files are
  browsed from disk. An inbox has no directory to resolve a relative URL against, so delivery
  refuses one. For an export you will send, pass the https origin that will serve the assets.
- **Expecting the editor to overwrite concurrent edits.** The editor writes back to the entry's
  `.tsx` source after checking that the file on disk is still the revision it read, so a change you
  saved elsewhere is not overwritten; reload the entry and retry.
- **Committing or hand-editing `.samva/`.** `.samva/` holds files this package generates. It is
  gitignored, like `.next/` and `.tanstack/`, and changes inside it never recompile templates.

## Rules

- **Brand resolution belongs to the host.** Keep Samva authentication and storage in the CLI so
  standalone authoring stays independent of a Samva account. Pass the host's resolver and brand
  plugin through compilation, preview and rendering together; dropping the plugin changes footer
  and unsubscribe behavior. Brand-resolution and editor-plugin tests enforce this boundary.

- **Template entries are `.tsx`.** Discovery ignores every other extension, hidden folders and
  `node_modules`.
- **Template ids and fixture keys match `TEMPLATE_NAME_PATTERN`** from `@samva/markup/template`,
  because both are written into export paths. Code that builds a path from them imports that
  pattern instead of restating it.
- **Fixtures are validated against the template's own schema before they render.** A bad fixture is
  a finding on that template, not a runtime surprise at send time.
- **One failure stays with its template.** A refused render reports against its fixture, and an
  entry that does not compile stays in the catalog with a null render and the findings that
  stopped it; an editor document whose file stops compiling keeps its place the same way.
- **Results are values.** `buildTemplates`, `renderTemplate` and `renderChannel` return
  discriminated results with an `ok` field and never throw for a finding about your source. A
  missing `vite` peer, or a templates directory outside the project root, throws.
- **The asset base is a build input, not authored source.** The same content can be built for one
  origin and exported for another. The dev server is not an https origin, so editor previews
  reference assets through the editor's own route by path.

## Proving your setup

- `samva templates check` compiles every template, renders every declared fixture, and reports
  findings; `--watch` keeps it running while you edit.
- `samva templates dev`, or `vite` with `samvaEditor()` configured, serves the editor at the
  configured `route`; every template should appear with its fixtures, one document per channel.
- `exportProject({ root, out })` writes browsable HTML and text for every fixture and a
  `catalog.json` with the asset mapping and findings.
