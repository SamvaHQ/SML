# Samva email starter

One ordinary TSX email project. Clone or copy this directory, install its locked dependencies, and
author the `WelcomeEmail` entry in `templates/welcome.tsx`.

The starter intentionally contains one email entry and no source metadata or sidecar. The
compiler reads the TSX and never runs it; Git owns this TSX project as the source tree.

The checked-in `starter-manifest.json` records the canonical file list and digest used by project
creation tracers to prove that every new project starts from this exact tree.

## Start

This directory is a standalone project, inside the Samva repository or copied out of it. It pins
the published `@samva/markup` and `@samva/vite` releases, never the repository's workspace
packages, so its `bun.lock` is the same lock a customer installs from. Install that pinned
toolchain from it:

```bash
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173/` and edit `templates/welcome.tsx`. Choose a fixture to render concrete
input. Supported visual edits update the authored TSX; source remains canonical.

## Authoring

An email module default-exports a `defineTemplate` object with a stable project-unique id, a JSON
Schema input contract, named fixtures, and an `email` channel of functions of the input:

```tsx
/** @jsxImportSource @samva/markup/email */
import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "hello",
  schema: jsonSchema<{ name: string }>({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Maya" } },
  email: {
    subject: (input) => `Hello, ${input.name}`,
    body: (input) => (
      <Email>
        <p>Hello, {input.name}</p>
      </Email>
    ),
  },
});
```

A body is read, not run: it binds input values, uses `&&` and `?:` conditions, maps over input
lists and calls the `fmt.*` formatters. Compute anything else in the caller and send it in the
input. Helpers are separate modules and do not appear in the catalog. The `email` channel owns the
subject, an optional preheader and the body; plain text is derived from the semantic content.
Fixtures are checked against the schema before publication, and actual send input is validated
against the immutable publication schema.

`theme.css` is the project theme, in Tailwind v4 syntax, and it layers by `@import`:
`starter.css` holds this starter's look as theme variables (`--color-brand`, `--color-surface`,
`--font-body` and the rest), `@import "samva:brand";` when present layers your organization's
brand over it, and the file's own `@theme` block overrides both. Every color and font in `templates/`
reads those variables, so a brand restyles the whole starter. Local previews and hosted publication
builds use the version committed with the project. Build once per exact source tree;
publication consumes the committed Bun lockfile v2 or npm lockfile v3 and verifies package integrity.

## Check, build, commit, and publish

Check and build the source project locally:

```bash
bun run check
bun run build
```

The check is the no-write TypeScript gate. `samva templates check` also compiles every template and renders its declared fixtures. The browser canvas is a structural preview,
not an exact Gmail, Outlook, Apple Mail, or Yahoo renderer. Generated HTML and delivery artifacts are not source files in this starter.

For a Samva-managed project, create or clone the Artifact repository with the CLI, then use native
Git for the project history and synchronization:

```bash
samva templates init --name "Welcome email" --dir welcome-email
cd welcome-email
bun install --frozen-lockfile
bun run check
git add .
git commit -m "feat: update welcome email"
git push origin main
samva templates publish --commit HEAD --json
```

`samva templates publish` publishes the exact clean commit after confirming it is reachable from
the fetched default branch. It does not push or rewrite history. A CLI-created clone has a
repository-local Samva credential helper; ordinary `git fetch`, `git pull`, and `git push` invoke
it as needed, without storing the Artifact credential in Git config or the remote URL.

If you only copy this starter for local experimentation, `bun run dev`, `bun run check`, and
`bun run build` are the complete local loop. Connect it to a Samva-managed project before using
the publish command.

Use external HTTPS image URLs or import project assets. Delivery builds with imported assets need an
explicit HTTPS asset base; exports include content-addressed assets and their manifest. Relative
preview URLs are not suitable for delivered email.

## Release verification

`bun run starter:check` from the repository root installs this directory from its committed lock
and runs its tests; `bun run release:check` includes it. Before publishing an authoring release, the
repository also verifies the starter with both exact packed packages:

```bash
SAMVA_STARTER_MARKUP_TARBALL=/absolute/path/samva-markup.tgz \
SAMVA_STARTER_VITE_TARBALL=/absolute/path/samva-vite.tgz \
  bun test ./tests/starter-manifest.test.js
```

Only the temporary consumer's dependency pins change in that mode.

After an authoring release publishes, `scripts/refresh-starter.ts` pins this project to the
published versions, resolves `bun.lock` against them, rewrites `starter-manifest.json`, and opens
the pull request that carries all three. The Version Packages pull request never edits this
directory: the lock records the integrity of published tarballs, which exist only after publish.
