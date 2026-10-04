---
name: sml
description: Author, check, render and repair Samva email templates written as static-profile TSX (defineTemplate). Use when creating or editing a file under templates/ or emails/, fixing template diagnostics, or previewing a template.
---

# Authoring Samva templates

A template is one `.tsx` file that default-exports `defineTemplate` from `@samva/markup`. It is
ordinary JSX, HTML and Tailwind written in a static profile: the compiler reads it without running
it and produces a JSON IR. Every preview and every send renders that IR against the input, so
nothing you write executes at send time.

## The loop

Write, check, render, look, repair. Repeat until the check is clean.

```bash
samva templates check                       # compile every template, print diagnostics with fixes
samva templates render --fixture no-tracking  # subject, preheader, text and HTML for one fixture
samva templates snapshot                    # desktop and mobile PNGs, light and dark
samva templates dev                         # local editor with every fixture rendered
```

Add `--json` for diagnostics as data: each has a `code`, a location, a severity and a `fix`. Apply
the fix the diagnostic names rather than rewriting around it. Without the CLI, call
`compileTemplate` from `@samva/markup/compiler` and `renderIr` from `@samva/markup/render`.

## Upgrades

When a diagnostic has an `upgrade` field in `@samva/markup/contract.json`, follow that recipe
for every affected entry while preserving project edits and entry paths. The Upgrades section of
`generated/reference.md` renders the same recipes. Check every converted entry and render its
fixtures before saving the project.

## Shape

```tsx
import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { fmt } from "@samva/markup/fmt";
import { jsonSchema } from "@samva/markup/input-schema";

export default defineTemplate({
  id: "order-shipped",
  schema: jsonSchema<{ name: string; total: number; currency: string; trackingUrl?: string }>({
    type: "object",
    properties: {
      name: { type: "string" },
      total: { type: "number" },
      currency: { type: "string" },
      trackingUrl: { type: "string" },
    },
    required: ["name", "total", "currency"],
    additionalProperties: false,
  }),
  fixtures: {
    default: { name: "Ada", total: 84, currency: "EUR", trackingUrl: "https://example.com/t/1" },
    "no-tracking": { name: "Ada", total: 84, currency: "EUR" },
  },
  email: {
    subject: (input) => `${input.name}, your order shipped`,
    body: (input) => (
      <Email>
        <h1 className="text-2xl font-semibold">Hi {input.name}, it shipped.</h1>
        <p>Total {fmt.money(input.total, input.currency)}</p>
        {input.trackingUrl && <a href={input.trackingUrl}>Track package</a>}
      </Email>
    ),
  },
});
```

- `id` is lowercase kebab-case and is the template's public handle.
- Put templates in `templates/` (`emails/` also works). Import only `@samva/markup` and files in
  the project; there are no dependencies to install.
- `subject` and `preheader` belong to the `email` channel, never to `<Email>`.
- Declare at least one fixture, and one per branch: default, missing optional fields, many items.

## The static profile

Use these forms; they are what models already write for React.

| Form                | Example                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| Text and attributes | `{input.name}`, `href={input.trackingUrl}`, template strings                |
| Condition           | `{input.trackingUrl && <A />}`, `{input.vip ? <A /> : <B />}`               |
| Comparison          | `===`, `!==`, `<`, `>`, `!`, `&&`, `\|\|`, `.length`                        |
| Loop                | `input.items.map((item) => <Row />)`                                        |
| Filter and count    | `input.items.filter((item) => item.done).length`                            |
| Grid                | `<Columns each={input.deals} per={2}>{(deal) => <Column />}</Columns>`      |
| Formatter           | `fmt.money`, `fmt.number`, `fmt.date`, `fmt.time`, `fmt.plural`, `fmt.list` |
| Partial             | any project component, inlined at compile time                              |
| Conditional class   | `className={input.vip ? "bg-amber-100" : "bg-white"}`                       |

Anything else is a diagnostic: other calls (`reduce`, `Math.floor`, `Date.now`), statements in a
body (`const`, `if`, loops), imports outside the project, hooks, event handlers,
`dangerouslySetInnerHTML`, and class names built at run time. There is no escape hatch. When the
profile cannot express something, compute it where the message is sent and add a field to the
schema.

## Data

- The schema is a literal `jsonSchema<Input>({ ... })` or any Standard JSON Schema converter. It
  validates every send and drives the binding checker: `input.ordr` fails with a suggestion.
- Guard optional fields before binding them: `{input.trackingUrl && ...}` (`unguarded-optional`).
- Every fixture must validate against the schema (`fixture-invalid`). Nothing is coerced and no
  defaults are inserted.
- Locale and time zone are send options; `fmt` reads them, and an explicit locale argument wins.

## Styling and components

Write HTML for content and Tailwind classes for style. Components exist only where an email client
needs something HTML cannot say: `Email`, `Section`, `Columns`/`Column`, `Button`, `Image`,
`Spacer`, `Divider`, and `BrandLogo`/`BrandFooter` from `samva:brand`. `theme.css` layers
`starter.css`, then `@import "samva:brand";`, then the project's own `@theme`. Fonts are `.woff2`
files declared with `@font-face`, and a font stack ends in a generic family.

## References

- `contract.json` (`@samva/markup/contract.json`): components with props, profile forms,
  formatters, elements and every diagnostic code, generated from the compiler.
- `generated/reference.md`: the same contract as a readable reference.
- `AGENTS.md`: the package guide, including what goes wrong and why.
