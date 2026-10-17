---
packages:
  npm:@samva/markup:
    type: minor
  npm:@samva/vite:
    type: minor
---

## A semantic theme vocabulary, one dark-mode mechanism and a contrast check

Every project compiles over a default theme in a shadcn-style vocabulary: `background`,
`foreground`, `card`, `primary`, `secondary`, `muted`, `accent` (each with its `-foreground`),
`border`, `--radius` (with `rounded-sm` to `rounded-xl` derived from it), `--font-sans` and
`--font-heading`. `starter.css`, a brand and the project's own `@theme` set the same names, so
`bg-card` or `text-primary-foreground` resolve in any project and a theme restyles every block that
reads them. `reference.md` and `contract.json` list the tokens, their roles and their defaults;
`@samva/markup/brand` exports `THEME_COLOR_ROLES`, `THEME_TOKENS` and `DEFAULT_THEME`.

Dark mode is one mechanism: the theme's `@media (prefers-color-scheme: dark) { @theme { … } }`
block, in project CSS and brand CSS alike. The compiler gives each element whose inlined styles
read a color that block redefines a generated `sml-dark-*` class with a dark-mode rule, so a block
writes `bg-card` once. Explicit `dark:` utilities still apply after it and resolve theme colors at
their dark values. A layer that sets a color in light mode only keeps it in dark mode, and a layer
that sets `--color-primary`, `--color-secondary` or `--color-accent` without its `-foreground` gets
black or white by contrast.

Breaking: the `-dark` suffix convention is gone. Nothing lowers a dark color to
`--color-<name>-dark` any more; move those values into the dark-mode block and drop the matching
`dark:…-dark` classes. `brandTailwindCss`, `brandThemeVariables`, `darkVariableName`,
`BRAND_COLOR_VARIABLE`, `BRAND_FOREGROUND_VARIABLE` and the `brand-css-dark-conflict` finding are
removed; `brandForegroundDefaults(brand)` is `foregroundDefaults(light, dark)` over the fills.
The brand footer and logo use `text-muted-foreground`.

The primitives read the theme. `Email` paints the page color (`--color-background` by default) on
the body and, as `bgcolor`, on the wrapper table, and pads its content 16px each side (`gutter`).
`Section` treats a pixel width as a maximum, so it fits a phone. `Columns` stacks its cells below
600px (`stack={false}` keeps a row) and spaces them with `gap` in both layouts. `Button`, `Link`
and `Divider` default to the primary fill, the primary color and the border color through classes
a utility on them overrides; their explicit props are inline styles as before. These change the
compiled output of every template, so the email-parity golden digests change.

`checkEmailCompatibility` adds `email-contrast`: each fixture is judged in light and dark mode,
and text below 3:1 or a button below 1.5:1 against its surroundings is an error located at the
element; normal-size text below 4.5:1 and a button below 3:1 are warnings. New diagnostic codes:
`email-contrast`, `invalid-columns-stack`, `invalid-columns-gap` and `invalid-number-prop`.

The email starter is redesigned on the vocabulary from copyable blocks in `templates/blocks/`.
