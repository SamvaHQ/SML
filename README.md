# SML

SML is the toolkit for Samva templates. A template is one TSX file; the compiler reads it without
running it, checks it against a static profile, and compiles it to SML IR, which the renderer
turns into the message for each fixture. Ask questions about the code on
[DeepWiki](https://deepwiki.com/SamvaHQ/SML).

## Packages

| Package                                            | What it is                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@samva/markup`](packages/markup)                 | Authoring components, the compiler, diagnostics and the renderer                |
| [`@samva/vite`](packages/vite)                     | The local visual editor, dev server, build, render and export, as a Vite plugin |
| [`@samva/editor`](packages/editor)                 | The embeddable editor the Vite plugin serves, for hosts that mount their own    |
| [`examples/email-starter`](examples/email-starter) | A standalone template project pinned to the published packages                  |

`packages/vite/editor` is the reference composition of `@samva/editor`; its build ships inside
`@samva/vite`.

## Start a template project

```sh
cp -r examples/email-starter my-templates
cd my-templates
bun install --frozen-lockfile
bun run dev
```

Each package README covers its API. `@samva/markup` also ships an agent skill and a contract
(`@samva/markup/contract.json`, `@samva/markup/reference.md`) for coding agents.

## Develop

Requires Bun 1.4.4 or newer and Node 24.

```sh
bun install
bun run build          # markup, then the editor, then vite with its embedded editor
bun run typecheck
bun run test           # Vitest, each package under its own config
bun run test:browser   # Chromium suites for the editor and the Vite plugin
bun run starter:check  # the starter installs from its lockfile and builds outside the workspace
bun run format:check
bun run lint
```

Run one package's scripts with `bun run --filter @samva/<package> <script>`. Use `bun run test`,
not bare `bun test`, which starts Bun's own runner instead of Vitest.

### Try a change in another project

Install the packages the way a release would publish them, not through a workspace link, so a
missing export or a build-order slip shows up before release:

- `bun run pack:local` builds and packs the three packages into `dist/local` and prints each one's
  `file:` specifier. Use it where the consuming project declares the package (a dependency or a
  catalog entry) and again under `overrides`, since `@samva/vite` depends on `@samva/markup` by
  range.
- Every pull request and `main` commit publishes preview packages to
  [pkg.pr.new](https://pkg.pr.new); the pull request comment lists their install URLs.

## Releases

The three packages release together as the `authoring` group with Tegami. Add a changeset under
`.tegami/` with a change that customers will notice. A change that makes previously valid templates
fail adds an `upgrade` recipe to the diagnostic code it reports, so hosted and local agents can
migrate projects. A scheduled workflow opens the Version Packages pull request; merging it
publishes to npm from GitHub Actions with provenance, after `scripts/check-packages.ts` builds and
audits every tarball.

`bun run starter:check` installs `examples/email-starter` from its committed lockfile and runs
`tests/starter-manifest.test.js`. Before publishing, that test can install the exact packed
`@samva/markup` and `@samva/vite` tarballs instead of the registry pins. Run it from
`examples/email-starter`:

```bash
SAMVA_STARTER_MARKUP_TARBALL=/absolute/path/samva-markup.tgz \
SAMVA_STARTER_VITE_TARBALL=/absolute/path/samva-vite.tgz \
  bun test ./tests/starter-manifest.test.js
```

Only the temporary copy's dependency pins change. The committed starter stays on the published
versions.

After an authoring release publishes `@samva/markup` or `@samva/vite`, `scripts/refresh-starter.ts`
pins `examples/email-starter` to those versions, resolves `bun.lock` against them, rewrites
`starter-manifest.json`, and opens the pull request that carries all three. The Version Packages
pull request never edits that directory: the lock records the integrity of published tarballs,
which exist only after publish.

Both pull requests come from the workflow token, so GitHub holds their `check` run until a
maintainer approves it from the pull request's Checks tab. A later push to the same branch starts
no run; close and reopen the pull request to check the new head.

## License

[MIT](LICENSE)
