# SML — contributor guide

SML holds the Samva template toolchain: `@samva/markup` (authoring, compiler, renderer),
`@samva/vite` (local editor, dev server, build) with its embedded editor app in
`packages/vite/editor`, `@samva/editor` (the embeddable editor), and `examples/email-starter`.
Read this file, then the package's own `AGENTS.md`.

## Layout

- `packages/markup` builds first; `packages/editor` imports its published entries; the Vite
  plugin's build bundles the editor app, which imports the editor's. The root `build` script runs
  them in that order.
- Each package type-checks, tests and builds from its own directory and config. Packages import
  each other only through declared dependencies and published `exports`, never through relative
  paths or `src`; `packages/markup/tests/authoring-boundary.test.ts` enforces this.
- `examples/email-starter` is not a workspace member. It pins the published releases and installs
  from its own `bun.lock`, exactly as a template author does. `scripts/refresh-starter.ts` moves
  its pins after a release; do not point it at workspace packages.

## Commands

- `bun run build`, `bun run typecheck`, `bun run test`, `bun run test:browser`,
  `bun run starter:check`, `bun run format:check`, `bun run lint`.
- Spell package scripts as `bun run --filter @samva/<package> <script>`. Bare `bun test` starts
  Bun's runner against Vitest suites.
- `bun run check:packages` builds and audits the exact tarballs a release would publish.

## Rules

- Generated files are regenerated, not edited: `packages/markup/generated/*` through
  `bun run --filter @samva/markup codegen:contract`, and
  `packages/markup/src/email/tailwind-stylesheets.gen.ts` through `codegen:tailwind`.
- A change customers notice gets a Tegami changeset under `.tegami/`.
- Code and docs describe what the packages are now; history lives in Git.
- Template authors install `@samva/markup` and `@samva/vite`, so neither may depend on Effect.
  `@samva/editor` takes Effect, React and Base UI as peers.
