# @samva/markup

Type-safe authoring and compilation primitives for Samva email, SMS, and WhatsApp templates. Use it
directly for TSX templates or together with `@samva/vite` for the visual editor and project build.

## For coding agents

- **SML** is the name of this toolkit, not a second syntax. An email is a TSX file that
  default-exports `defineTemplate`, written in the static profile (ordinary JSX, HTML, and Tailwind
  classes read without running). Compiling it produces the **IR**, the JSON description that
  previews and sends render.
- The package ships the `sml` skill at `skills/sml/SKILL.md`; it routes you through write, check,
  render, look, and repair. `AGENTS.md` and `contract.json` ship alongside it.
- Run `samva templates check --json` after every edit for diagnostics with `file:line:column` and a
  fix for each.

## Install

```sh
npm install --save-dev @samva/markup
```

Configure TypeScript with `jsx: "react-jsx"` and `jsxImportSource: "@samva/markup/email"`. A
template is one `.tsx` file that default-exports `defineTemplate`:

```tsx
import { defineTemplate } from "@samva/markup";
import { Button, Email, Section } from "@samva/markup/email";
import { fmt } from "@samva/markup/fmt";
import { jsonSchema } from "@samva/markup/input-schema";

import { OrderRow } from "../partials/order-row";

export default defineTemplate({
  id: "order-shipped",
  schema: jsonSchema<{
    name: string;
    orderId: string;
    currency: string;
    total: number;
    items: { title: string; qty: number; price: number }[];
    trackingUrl?: string;
  }>({
    type: "object",
    properties: {
      name: { type: "string" },
      orderId: { type: "string" },
      currency: { type: "string" },
      total: { type: "number" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            qty: { type: "number" },
            price: { type: "number" },
          },
          required: ["title", "qty", "price"],
          additionalProperties: false,
        },
      },
      trackingUrl: { type: "string" },
    },
    required: ["name", "orderId", "currency", "total", "items"],
    additionalProperties: false,
  }),
  fixtures: {
    default: {
      name: "Ada",
      orderId: "A-1042",
      currency: "USD",
      total: 84,
      items: [{ title: "Linen shirt", qty: 2, price: 42 }],
      trackingUrl: "https://track.example.com/A-1042",
    },
    "no-tracking": {
      name: "Ada",
      orderId: "A-1042",
      currency: "USD",
      total: 84,
      items: [{ title: "Linen shirt", qty: 2, price: 42 }],
    },
  },
  email: {
    subject: (input) => `Order ${input.orderId} is on its way`,
    preheader: (input) => `${input.items.length} items, ${fmt.money(input.total, input.currency)}`,
    body: (input) => (
      <Email>
        <Section className="px-8 py-6">
          <h1 className="text-2xl font-semibold">Hi {input.name}, it shipped.</h1>
          {input.items.map((item) => (
            <OrderRow item={item} currency={input.currency} />
          ))}
          <p className="mt-4 font-medium">Total {fmt.money(input.total, input.currency)}</p>
          {input.trackingUrl && (
            <Button href={input.trackingUrl} width={200} height={44}>
              Track package
            </Button>
          )}
        </Section>
      </Email>
    ),
  },
});
```

A template is read, not run. `@samva/markup/compiler` parses the file and the project files it
imports without evaluating them, checks every binding against the schema, resolves Tailwind and CSS
against the markup, and produces the template's IR: JSON, versioned (`"sml": 1`), carrying the
markup, the bindings, the conditions, the loops and the formatters. `@samva/markup/render`
renders that IR against an input. It is a pure function with no dependencies, so nothing executes
at send time.

```ts
import { renderIr } from "@samva/markup/render";
import { compileTemplate } from "@samva/markup/compiler";

const compiled = await compileTemplate({
  files, // the project's files by path; binary files become content-addressed assets
  entry: "templates/order-shipped.tsx",
  assetBase: "https://assets.example.com",
  tailwind: { css: files["theme.css"] },
});
if (compiled.ir === undefined) throw new Error(compiled.diagnostics.map(String).join("\n"));

const { subject, preheader, html, text } = renderIr(compiled.ir, compiled.fixtures.default, {
  locale: "en-US",
  timeZone: "UTC",
});
```

### The static profile

The profile is the subset of TSX the compiler reads without running it: the forms an agent already
writes for React. Anything else is a compile error that names the fix.

| Form                | Example                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| Text binding        | `{input.name}`                                                           |
| Attribute binding   | `href={input.trackingUrl}`                                               |
| Template string     | `` `Order ${input.orderId}` ``                                           |
| Conditional         | `{input.trackingUrl && <Button … />}`                                    |
| Either/or           | `{input.vip ? <Gold /> : <Standard />}`                                  |
| Conditions          | `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `&&`, `\|\|`, `.length`         |
| Loop                | `{input.items.map((item, i) => <Row … />)}`                              |
| Filter              | `input.steps.filter((step) => step.done).map(…)`, `.filter(…).length`    |
| Grid                | `<Columns each={input.deals} per={2}>{(deal) => <Column … />}</Columns>` |
| Formatter           | `fmt.money(input.total, input.currency)`                                 |
| Partial             | `<OrderRow item={item} />`, with props and `children`                    |
| Conditional class   | `className={input.vip ? "bg-amber-100" : "bg-white"}`                    |
| Destructured params | `body: ({ name, items }) => …`                                           |
| Arithmetic          | `item.price * item.qty`, inside a formatter argument or a condition      |

A `.filter` callback takes the item and one condition from the same grammar as `&&` and `?:`; it
chains before `.map(...)` or `.length`. `<Columns each per>` lays a list out in rows of `per` cells
(one row without `per`): the child is a function from an item, and its index within the row, to a
`Column`. A `Column` that states no `width` takes an equal share of the row, whole percent rounded
down, and a last row with fewer items keeps that share, so it leaves empty space instead of
stretching. Both lower to a loop in the IR, so nothing is computed at send time.

Rejected, each with its own diagnostic: calls other than `fmt.*` and `.map` (`dynamic-expression`),
statements in a body (`statement-in-body`), imports other than `@samva/markup` and project files
(`non-project-import`), event handlers, hooks and `dangerouslySetInnerHTML`, class names built at
run time (`dynamic-class`), and recursion (`recursive-partial`). There is no escape hatch: logic the
profile cannot express is computed by the caller and sent in the payload.

Each diagnostic has a stable `code`, the exact `file:line:column`, a one-sentence `message` and a
`fix`. `unknown-field` names the field and suggests the nearest one, `unguarded-optional` marks an
optional field read outside a guard, and `fixture-invalid` names the fixture that no longer matches
the schema.

Only `@samva/markup` and files inside the project can be imported, so a project has no other
dependency to install. A fixture is data: a literal, or constants and imported assets assembled from
literals.

### Formatters

`@samva/markup/fmt` is the only set of functions a body may call. Each one is deterministic `Intl`
with the locale and time zone the render supplies; the template's `locale` is the default and an
explicit argument overrides it.

| Formatter                              | Example                                            | Output        |
| -------------------------------------- | -------------------------------------------------- | ------------- |
| `fmt.money(amount, currency, locale?)` | `fmt.money(84, "EUR", "de")`                       | 84,00 €       |
| `fmt.number(n, options?, locale?)`     | `fmt.number(1234.5, { maximumFractionDigits: 0 })` | 1,235         |
| `fmt.date(iso, style?, locale?)`       | `fmt.date(input.shippedAt, "medium")`              | Sep 29, 2026  |
| `fmt.time(iso, style?, locale?)`       | `fmt.time(input.slot, "short")`                    | 3:30 PM       |
| `fmt.plural(n, forms, locale?)`        | `fmt.plural(n, { one: "item", other: "items" })`   | items         |
| `fmt.list(values, locale?)`            | `fmt.list(["Ada", "Grace"])`                       | Ada and Grace |

### Channels

One template carries one schema and a body for each channel it supports. `@samva/markup/sms` and
`@samva/markup/whatsapp` export the channel components (`Sms`; `WhatsApp` with `WhatsApp.Header`,
`.Body`, `.Footer`, `.Buttons`, `.UrlButton`, `.QuickReplyButton`, `.PhoneButton` and
`.CopyCodeButton`). Their names are distinct per channel, so a wrong prop fails in the type checker.
WhatsApp bindings compile to Meta's positional `{{1}}` placeholders (`whatsappTemplate`), and a
conditional in a WhatsApp text part is refused because Meta templates cannot branch. The platform
gates these channels.

### Explicit template inputs

`@samva/markup` exports `defineTemplate` and `TemplateInput`.
The schema must implement Standard **JSON Schema** v1; a validator-only Standard Schema is
insufficient. `Schema.toStandardJSONSchemaV1` (Effect) and Zod 4 schemas support caller-input
inference, including named fixtures. `TemplateInput<typeof template>` extracts the caller type.
Rendering receives input unchanged.

The portable profile uses JSON Schema 2020-12. Supported validation keywords are `type`, `enum`,
`const`, `required`, numeric bounds and `multipleOf`, string lengths and `pattern`, object/array
size bounds, `uniqueItems`, `properties`, `patternProperties`, `additionalProperties`,
`dependentSchemas`, `propertyNames`, `items`, `prefixItems`, `contains`, `allOf`, `anyOf`, `oneOf`,
`not`, `if`, `then`, `else`, `$defs`, and local JSON Pointer `$ref`. Boolean schemas are supported.
Remote references, alternative dialects, `$id`, dynamic references, `format`, and unknown keywords
fail. Regex constraints use the validator's Unicode JavaScript regular-expression semantics.

`title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, and `$comment`
are annotations retained in the complete schema but excluded from `validationIdentity`. Defaults
are never inserted, values are never coerced, and extra properties are never removed. Identity
sorts schema object keys; it is a canonical document, not a semantic-equivalence proof.

Converters must export portable input and output schemas with equal validation documents.
Transforms that cannot export output, differing input/output documents, and non-JSON exports fail.
Custom library refinements are not portable merely because their validator works: converters must
reject unsupported refinements instead of silently dropping them. This interface cannot detect an
arbitrary dishonest or lossy converter. The tested Effect and Zod fixtures cover structural nested
objects, arrays, primitive constraints, and rejection of nonportable exports.

The pinned Zod/Effect adapter rejects lazy/suspended schema nodes before executing their getters;
author recursive contracts directly using local JSON Schema references. Custom predicate metadata
is checked for these vendors, but a converter-supplied JSON Schema constraint remains its contract.

### Authoring with an agent

The package ships what an agent needs without any other source. `AGENTS.md` opens with the model:
a template is TSX in the static profile that compiles to IR, and nothing runs at send time.
`@samva/markup/contract.json` lists the components with their props, the profile's forms, the
formatters, the HTML elements and every diagnostic code with its fix; it is generated from the
compiler, so it matches the version you installed. `skills/sml/SKILL.md` is the `sml` skill: it
routes an agent through write, check, render, look and repair. Run `samva templates check --json`
for diagnostics an agent can apply.

### Previewing a render

`renderIrPreview(ir, input)` from `@samva/markup/render` renders a fixture the way `renderIr` does
and stamps `data-samva-instance` on every element. Its `selections` map each stamped element to the
line and column of the JSX that produced it, so an editor can select an element on the canvas and
edit the source at that span. A delivered message never carries the attribute.

Portable validation uses `@cfworker/json-schema` without runtime code generation. The
2020-12 meta-schema is checked at every supported schema position, and the explicit profile rejects
keywords outside its contract before interpretation. The AJV dependency supplies static meta-schema
JSON; its code generator is not invoked in a loaded template.
