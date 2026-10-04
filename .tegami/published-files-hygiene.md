---
packages:
  "npm:@samva/markup":
    type: patch
  "npm:@samva/vite":
    type: patch
  "npm:@samva/editor":
    type: patch
---

## Published files no longer point at missing source maps

The packages no longer build source maps, so no published JavaScript or declaration file ends in a
`sourceMappingURL` comment for a `.map` file the package does not ship. Devtools and bundlers stop
requesting maps that 404.

## `@samva/editor` accepts any compatible `@samva/markup`

`@samva/editor` and `@samva/vite` both depend on `@samva/markup` with a caret range, so a project
that installs both resolves one copy of the compiler.

## The editor's mock project uses a reserved domain

`@samva/editor/mock` addresses its sample brand at `nimbus.example` instead of a registered domain.
The mock's logo URL no longer resolves, so the demo shows its alt text.
