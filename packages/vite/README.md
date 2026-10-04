# @samva/vite

The local editor, dev server and build for Samva templates. A template is one TSX file that
`@samva/markup` compiles without running it; this package serves the visual editor over the
compiled templates, and checks, builds, renders and exports them, so what you preview is what a
publication renders.

## Start

`samva templates dev` bundles the dev server with sensible defaults, so most projects configure
nothing and need no `vite.config.ts`:

```sh
samva templates dev
```

`samva templates init` creates a project from the canonical starter. Templates live in `templates/`,
and `emails/` is also recognized. `@samva/vite` stays a public, configurable plugin for setups
those defaults cannot cover: templates in another folder, a monorepo, or a Vite server that also
runs your other plugins.

```sh
npm install --save-dev @samva/markup @samva/vite vite
```

```ts
import { samvaEditor } from "@samva/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [samvaEditor()],
});
```

Run `vite` and open `http://localhost:5173/`. The default assumes this dev server exists only for
Samva authoring:

- editor UI: `/`
- editor API and event streams: `/api/*`
- bundled editor assets: `/assets/*`

To share a Vite server with another app, choose a route:

```ts
samvaEditor({ route: "/__samva" });
```

That mounts the UI at `/__samva/`, the API at `/__samva/api/*`, and the bundled assets at
`/__samva/assets/*`. Requests outside the configured route pass through to the rest of the Vite
middleware stack.

## Options

| Option              | Type                | Default                    | Description                                                                                                       |
| ------------------- | ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `templatesDir`      | `string`            | `templates/` and `emails/` | The one directory to scan for `.tsx` templates, relative to the project root. Unset scans whichever exist.        |
| `projectRoot`       | `string`            | the Vite root              | The folder holding `theme.css`, shared imports and `.samva/`, relative to the Vite root. Contains `templatesDir`. |
| `route`             | `string`            | `"/"`                      | Absolute editor UI route; API and assets are mounted beneath it.                                                  |
| `theme`             | `string \| false`   | `"theme.css"`              | Project theme file relative to the project root, or `false` to compile without one.                               |
| `brandResolver`     | `BrandResolver`     | unset                      | Host-owned brand lookup; required when a project imports a brand.                                                 |
| `brandPlugin`       | `BrandPlugin`       | markup default             | Brand import specifier, footer and unsubscribe behavior.                                                          |
| `authenticated`     | `boolean`           | `false`                    | Whether the host supplies authenticated editor capabilities.                                                      |
| `editorAffordances` | `EditorAffordances` | unset                      | Host-owned publishing instructions and authentication text.                                                       |

For templates in another folder of a monorepo, set `projectRoot` to a folder that contains both the
templates and the files they import; a templates directory outside the project root is an error.

## Authoring files

A template default-exports `defineTemplate` from `@samva/markup` and is written in the static
profile: ordinary JSX, HTML and Tailwind that the compiler reads and never executes. The editor
previews every declared fixture, offers source-aware edits where the source intent is unambiguous,
and saves them to the file.

```tsx
import { defineTemplate } from "@samva/markup";
import { Email, Section } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "welcome",
  schema: jsonSchema<{ firstName: string }>({
    type: "object",
    required: ["firstName"],
    properties: { firstName: { type: "string" } },
    additionalProperties: false,
  }),
  fixtures: { basic: { firstName: "Ada" } },
  email: {
    subject: (input) => `Welcome, ${input.firstName}`,
    preheader: () => "Your account is ready",
    body: (input) => (
      <Email>
        <Section>
          <h1>Welcome, {input.firstName}</h1>
        </Section>
      </Email>
    ),
  },
});
```

Any other `.tsx` module in the templates directory (a partial, a component) is an ordinary module
that templates import; a module is a template only if its default export is `defineTemplate`.
Identity is the `id` the definition declares, unique within the project. A template that declares
`sms` or `whatsapp` beside `email` shows one editor document per channel over the same file.

The browser canvas is a structural preview of Samva's modern and Outlook-safe compiler output. It
does not emulate the exact Gmail, Outlook, Apple Mail, or Yahoo rendering engines. Use
compatibility findings and inbox tests for client-specific proof.

## Theme, check, and publish

A root `theme.css` uses Tailwind v4 `@theme` syntax and may `@import` other project `.css` files
and a brand import recognized by the configured brand plugin; any other import is a compile error.
A change to the theme, a partial, or an imported stylesheet recompiles every template that reads it.

`samva templates check` and `buildTemplates()` compile every template, render every declared
fixture through each channel the template declares, and check the email output against the client
matrix. `buildTemplates()` returns `files`, one per template entry, with `ok`, the template's IR,
input schema, each fixture's rendered output, and structured diagnostics; helper modules have no
entry. A template requires at least one fixture.

```ts
import { buildTemplates } from "@samva/vite/build";

const result = await buildTemplates({ root: ".", assetBase: "https://assets.example.com/p" });
```

`buildTemplates(options)` and `createTemplateBuildSession(options)` take `root`, `dir`, `theme`,
`assetBase`, `brandResolver` and `brandPlugin`. Imported email assets require an HTTPS `assetBase`,
which names where their bytes are served in delivered messages. `createTemplateBuildSession` also reports file
changes for `check --watch`.

`samva templates build --out dist/templates.json` writes the CLI's local artifact. Check writes no
files. A successful fixture check does not prove every possible input branch.

## Render one fixture

`samva templates render` runs this package's `render` entry from your project, so it uses the
compiler version your lockfile pins. The results are plain JSON.

```ts
import { renderChannel, renderTemplate } from "@samva/vite/render";

const email = await renderTemplate({ root: ".", template: "welcome", fixture: "basic" });
// { ok: true, subject, preheader?, html, text, diagnostics } or { ok: false, diagnostics }

const sms = await renderChannel({ root: ".", template: "order", fixture: "first", channel: "sms" });
```

`template` is a template id or the project-relative path of its entry. `locale` and `timeZone`
override the formatters' defaults.

## Dev server without a config file

```ts
import { startDevServer } from "@samva/vite/dev";

const server = await startDevServer({ root: ".", port: 5173, open: true });
console.log(server.url);
await server.close();
```

`startDevServer` creates a Vite server with `configFile: false` and `samvaEditor()`, which is what
`samva templates dev` does.

## Brand resolution

`samvaEditor()`, `startDevServer()`, and the project, build, render and export APIs accept
`brandResolver` and `brandPlugin`. The resolver supplies an `EmailBrand`; the plugin defines the
brand import, footer and unsubscribe behavior. A project with no brand import runs without a
resolver or credentials. A brand import without a resolver reports `brand-unavailable`.

For example, supply a brand from your own configuration:

```ts
import { samvaEditor } from "@samva/vite";
import { samvaBrandPlugin } from "@samva/markup/brand";

samvaEditor({
  brandPlugin: samvaBrandPlugin,
  brandResolver: {
    resolve: async () => ({
      ok: true,
      brand: { slug: "local", css: "@theme { --color-primary: #2563eb; }" },
      source: "configuration",
      warnings: [],
    }),
  },
});
```

`samva templates dev/check/build/render/export` supplies the Samva resolver and brand plugin. These
commands resolve `samva:brand` from the organization's live brand or a cached
`.samva/brands/<slug>.json` snapshot. Configure Samva credentials and snapshot behavior through the
CLI; the standalone Vite plugin does not read them.

## The `.samva/` folder

`.samva/` holds files this package generates in your project, the way `.next/` and `.tanstack/`
do. Keep it in `.gitignore`. It is not part of the project's source, so changes inside it never
recompile templates.

## Publish

For a hosted project, commit and push the checked TSX tree with ordinary Git, then publish one exact
commit:

```sh
git add .
git commit -m "feat: update welcome email"
git push origin main
samva templates publish --commit HEAD
```

The CLI's repository-local credential helper obtains a short-lived Artifact credential through
Samva's credential protocol when Git needs one. It validates the repository host/path and does not
store the token in Git config or the remote URL. `templates publish` requires a clean worktree and
an exact commit reachable from the fetched `origin` default branch; it creates an immutable
publication receipt and does not push or rewrite history. Sending selects an exact immutable
publication by default; later source edits do not change that publication.

## Local export

```ts
import { exportProject } from "@samva/vite/project";

const receipt = await exportProject({ root: ".", out: "dist/email" });
```

`root` is the project: its `theme.css` themes the export, as in `buildTemplates()`; `dir` narrows
the templates directory, `theme` names another file or `false` disables it, and `brandResolver` / `brandPlugin`
configure brand resolution as described above.

Export writes `templates/<id>/<fixture>.html` and `.txt`, plus `.sms.txt` and `.whatsapp.json` for
those channels, content-addressed files under `assets/`, and `catalog.json` with the asset mapping
and findings. The default `../../assets` base resolves from each exported page. For delivery,
supply the actual HTTPS `assetBase` and serve those bytes there; relative URLs are for local
export. External HTTPS images stay external references.
