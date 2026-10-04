## @samva/editor@0.11.2

### Published files no longer point at missing source maps

The packages no longer build source maps, so no published JavaScript or declaration file ends in a
`sourceMappingURL` comment for a `.map` file the package does not ship. Devtools and bundlers stop
requesting maps that 404.

### `@samva/editor` accepts any compatible `@samva/markup`

`@samva/editor` and `@samva/vite` both depend on `@samva/markup` with a caret range, so a project
that installs both resolves one copy of the compiler.

### The editor's mock project uses a reserved domain

`@samva/editor/mock` addresses its sample brand at `nimbus.example` instead of a registered domain.
The mock's logo URL no longer resolves, so the demo shows its alt text.

### The editor keeps up with rapid saves on Linux

`samvaEditor()` turns on the watcher's pending-write tracking unless the project configures its
own, so a save that lands within 50 ms of the previous one still reaches the editor on Linux. Event
streams load the template catalog before they connect, so the first edit after opening the editor
is reported as a change.
