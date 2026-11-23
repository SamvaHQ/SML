# Review rules

SML is the Samva template toolchain: @samva/markup, @samva/editor, and @samva/vite, plus
examples/email-starter. Follow root AGENTS.md, then the package AGENTS.md for the tree you are in.
Build order is markup, then editor, then vite. Prefer logic findings over style.

This file is for whoever reviews a change, person or tool. A rule applies to a change that touches a
file its `Applies to` patterns match. Cite the rule's id in a finding. Skip generated output
(`*.gen.ts`, `bun.lock`, `dist/`, `.samva/`, snapshots, and the vendored
`packages/markup/src/json-schema/`); review the source that produces it.

## sml-build-order

- Severity: high
- Applies to: `package.json`, `packages/markup/**`, `packages/editor/**`, `packages/vite/**`

Build @samva/markup first, then @samva/editor, then @samva/vite. The root build script runs them in
that order because the editor imports markup's published entries and the Vite plugin build bundles
packages/vite/editor, which imports the editor. Do not reorder that script or make one package
compile against another's source.

## sml-no-relative-package-imports

- Severity: high
- Applies to: `packages/**`

Packages import each other only through declared dependencies and published exports, never through
relative paths or another package's src. packages/markup/tests/authoring-boundary.test.ts enforces
this.

## sml-email-starter-pins

- Severity: high
- Applies to: `package.json`, `examples/email-starter/**`, `scripts/refresh-starter.ts`

examples/email-starter is not a workspace member. It pins the published @samva/markup and
@samva/vite releases and installs from its own bun.lock. Do not add it to the root workspaces array
or point it at workspace packages. scripts/refresh-starter.ts moves its pins after a release.

## sml-generated-not-edited

- Severity: high
- Applies to: `packages/markup/**`

Generated files are regenerated, not edited. packages/markup/generated/* comes from bun run --filter
@samva/markup codegen:contract, and packages/markup/src/email/tailwind-stylesheets.gen.ts comes from
codegen:tailwind. Do not hand-edit the vendored JSON Schema dialect in
packages/markup/src/json-schema.

## sml-tegami-changeset

- Severity: high
- Applies to: `packages/**`, `.tegami/**`

A change customers notice gets a Tegami changeset under .tegami/. A change that makes previously
valid templates fail adds an upgrade recipe to the diagnostic code it reports, so hosted and local
agents can migrate projects.

## sml-no-effect-dependency

- Severity: high
- Applies to: `packages/markup/package.json`, `packages/vite/package.json`,
  `packages/editor/package.json`

Template authors install @samva/markup and @samva/vite, so neither may list Effect in dependencies
or peerDependencies. @samva/editor takes Effect, React, and Base UI as peers.

## sml-no-throw-outside-tests

- Severity: high
- Applies to: `packages/markup/src/**`, `packages/editor/src/**`, `packages/vite/src/**`,
  `packages/vite/editor/src/**`

throw, try/catch, built-in Error construction, and hand-rolled object guards are lint errors outside
tests and tooling (samva/no-try-catch-or-throw, samva/no-error-constructor, and
samva/no-hand-rolled-object-guard in scripts/oxlint-plugin-samva.js). A real boundary takes an
inline oxlint-disable naming the rule and the reason.

## sml-email-parity-digests

- Severity: high
- Applies to: `packages/markup/**`

packages/markup/tests/email-parity.test.ts pins the compiler's published output to golden digests
that Samva's hosted runtime also asserts. Change those digests only for an intended output change,
and say so in the Tegami changeset.

## sml-static-profile

- Severity: high
- Applies to: `packages/markup/**`

A template body is read, not run. The compiler produces versioned JSON IR, and rendering is a pure
function of that IR and the input. Do not add an execution path, a raw-HTML escape hatch, or a body
that computes over its input. New findings go in DIAGNOSTIC_CODES with a fix.

## sml-editor-session

- Severity: high
- Applies to: `packages/editor/**`

The editor never compiles. The host owns render truth and the editor mounts the render produced from
the template IR. Each EditorProvider owns one vanilla zustand store; do not add a module-level store
or zustand middleware. Effect Atom owns host application and server state; zustand owns
editor-internal state. A visual edit stays inside the static profile: applySourceReplacements runs
with a ProfileGuard, and a conditional className is refused rather than overwritten.

## sml-vite-compile-then-render

- Severity: high
- Applies to: `packages/vite/**`

Every check, render, and preview is compileTemplate from @samva/markup/compiler followed by
renderIr. Do not execute a template module. buildTemplates, renderTemplate, and renderChannel return
discriminated results with an ok field and do not throw for a finding about source. Do not commit or
hand-edit .samva/; it is generated and gitignored.
