# Rendered email baseline

Captured from `feat/semantic-ir` at `2b40779294e8b7986e6f0a851788d423d4d31927`, with no
compiler, renderer, or starter changes. Each `.subject.golden`, `.preheader.golden`, `.html.golden`, and `.text.golden` file
contains the exact rendered UTF-8 bytes, with no extra newline or normalization. An absent
preheader has no file and is distinguished from an empty preheader in `manifest.json`. The `.golden`
suffix keeps formatters from rewriting captured HTML bytes.

The corpus covers every built-in email component, three brand configurations, Outlook button
fallbacks and links without fallbacks, static columns with gaps, repeated columns with and without
chunking, empty/single/odd/even item lists, inline styles, responsive styles, theme dark-mode CSS,
and light/dark brand logos. Dark-mode rules are part of the full HTML; rendering has no separate
dark-mode output option. The existing parity project and its digest constants are imported without
modification. `starter-project.json` freezes every starter TSX source and its theme stylesheets;
the test also checks them against the current starter, so new entries or fixtures cannot silently
escape the baseline.

Authored templates are read by `compileTemplate` and rendered with `render(..., { channel:
"email", locale: "en-US", timeZone: "UTC" })`; no authored template is evaluated.

Run from the repository root:

```sh
bun run --filter @samva/markup test -- tests/rendered-email-baseline.test.ts
```

A mismatch is a hard stop. Inspect the exact field diff; do not rewrite these captured files to
make a compiler or renderer change pass. There is deliberately no snapshot update or regeneration
mode.
