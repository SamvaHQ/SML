# @samva/markup

Type-safe authoring and compilation primitives for Samva email, SMS, and WhatsApp templates. Use it
directly for TSX templates or together with `@samva/vite` for the visual editor and project build.

## For coding agents

- **SML** is the name of this toolkit, not a second syntax. An email is a TSX file that
  default-exports `defineTemplate`, written in the static profile (ordinary JSX, HTML, and Tailwind
  classes read without running). Compiling it produces the **compiled template**, the JSON description that
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
against the markup, and produces a semantic document: JSON, versioned (`"sml": 2`), carrying
components, block and inline content, bindings, conditions, loops, formatters, and source positions.
`@samva/markup/render` lowers that document to the requested target against an input. Rendering is
pure, with no authored code or external I/O at send time.

```ts
import { compileTemplate } from "@samva/markup/compiler";
import { render } from "@samva/markup/render";

const compiled = await compileTemplate({
  files, // the project's files by path; binary files become content-addressed assets
  entry: "templates/order-shipped.tsx",
  assetBase: "https://assets.example.com",
  tailwind: { css: files["theme.css"] },
});
if (compiled.template === undefined) throw new Error(compiled.diagnostics.map(String).join("\n"));

const { subject, preheader, html, text } = render(compiled.template, compiled.fixtures.default, {
  target: "email",
  locale: "en-US",
  timeZone: "UTC",
});
```

Every email template also has a web target. It returns the page body and hints for the host's page
shell; the host owns the document head, canonical URL, indexing, and access control.

```ts
const page = render(compiled.template, compiled.fixtures.default, { target: "web" });
// page.html is semantic HTML; page.headHints carries the styles and document hints.
```

Web renders retain the template background by default. A publication shell that supplies its own
page background can omit the generated root background:

```ts
const page = render(template, input, { target: "web", rootBackground: "transparent" });
```

This omits the web root's default `--color-background` fill. Authored background styles, nested
components, theme tokens, and email rendering are unchanged. `rootBackground: "template"` is the
default.

Email lowering preserves email layout, Outlook fallbacks, subject, preheader, and plain text.
Web lowering uses semantic elements and supplies styles separately from the HTML body. Both read
the same authored components and source positions. `COMPONENT_DEGRADATIONS` from
`@samva/markup/compatibility` declares what each component loses in email.
`templateEmailDegradations(compiled.template)` locates those declarations in the authored source;
`checkCompatibility` reports content degradations alongside client HTML findings. A `same`
declaration records that content is preserved and adds no finding.

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
stretching. Both lower to a loop in the compiled template, so nothing is computed at send time.

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
`.CopyCodeButton` and `.FlowButton`). Their names are distinct per channel, so a wrong prop fails in the type checker.
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
a template is TSX in the static profile that compiles to a compiled template, and nothing runs at send time.
`@samva/markup/contract.json` lists the components with their props, the profile's forms, the
formatters, the HTML elements and every diagnostic code with its fix; it is generated from the
compiler, so it matches the version you installed. `skills/sml/SKILL.md` is the `sml` skill: it
routes an agent through write, check, render, look and repair. Run `samva templates check --json`
for diagnostics an agent can apply.

### Previewing a render

`previewEmail(template, input)` from `@samva/markup/edit` renders a fixture the way `render` does
and stamps `data-samva-instance` on every element. Its `selections` map each stamped element to the
line and column of the JSX that produced it, so an editor can select an element on the canvas and
edit the source at that span. A delivered message never carries the attribute.

Portable validation uses `@cfworker/json-schema` without runtime code generation. The
2020-12 meta-schema is checked at every supported schema position, and the explicit profile rejects
keywords outside its contract before interpretation. The AJV dependency supplies static meta-schema
JSON; its code generator is not invoked in a loaded template.

## Markdown newsletter issues

`@samva/markup/markdown` parses newsletter prose into the same semantic document as TSX. Files
carry YAML frontmatter and CommonMark prose, with static tags from SML's email component set:

```md
---
title: October product news
date: 2026-10-28
slug: october-product-news
topic: product
preheader: What shipped this month
seo:
  description: October updates from the team
  image: https://example.com/october.png
gate:
  leadIn: 2
---

# What shipped

Read the **latest updates**.

<Button href="https://example.com/updates">See every update</Button>
```

`title`, `slug`, and `topic` are required nonempty strings. The slug is lowercase kebab-case.
`date` is an optional valid ISO calendar date (`YYYY-MM-DD`); invalid dates such as `2026-02-29`
are diagnosed at the YAML value. `preheader` is optional text; `seo` accepts optional `title`, `description`, and an absolute HTTPS
`image`; `gate.leadIn` counts leading top-level content blocks before a host-owned subscription
wall. SML preserves this metadata; the host owns SEO tags, gating, and publication. Unknown fields,
invalid YAML, raw HTML, unknown components, expressions, spreads, and nonliteral props are errors.
Use explicit `[label](url)` links; angle autolinks are outside this grammar.
Numeric and boolean props use quoted values (`height="24"`, `stack="false"`); bare boolean flags
mean true. Fenced code is literal content, including any HTML or braces inside it.

A layout is an ordinary email-only `defineTemplate` entry containing one static `<IssueContent />`
imported from `@samva/markup/email`. The directive takes no props or children and must sit outside
conditions and loops. It disappears during compilation before styles are applied.

The same import provides `<IssueTitle />` and `<IssueDate />` to insert the issue's own metadata:

```tsx
<h1><IssueTitle /></h1>
<p><IssueDate /></p>
<IssueContent />
```

`IssueTitle` inserts frontmatter `title` as escaped text and takes no props. `IssueDate` inserts
frontmatter `date` as escaped text, or nothing when it is absent. It follows `fmt.date` conventions:
medium style, `en-US` locale, UTC (`2026-10-28` becomes `Oct 28, 2026`). Optional literal `style`
(`short`, `medium`, `long`, `full`) and `locale` props select another format, for example
`<IssueDate style="long" locale="en-GB" />` produces `28 October 2026`.
Formatting happens during compilation; the layout's locale and render-time locale/time zone do not
change this text. Both directives work in email and web output, may repeat, take no children, and
must stay outside conditions and loops, including inside partials. They are valid only in issue
layouts compiled with `compileIssue`, never in ordinary templates or Markdown prose. Style their
surrounding HTML elements rather than passing classes to the directives.

```ts
import { compileIssue, parseIssue } from "@samva/markup/markdown";
import { render } from "@samva/markup/render";

const parsed = parseIssue(files["issues/october.md"], "issues/october.md");
const compiled = await compileIssue({
  files,
  entry: "issues/october.md",
  layout: "layout.tsx",
  assetBase: "https://assets.example.com",
});
if (compiled.template) {
  const page = render(compiled.template, compiled.fixtures.default, { target: "web" });
}
```

`compileIssue` takes its schema, fixtures, theme and body shell from the layout; the issue slug
becomes the compiled identity, its title becomes the subject, and its preheader becomes the inbox
preview. Frontmatter is returned separately and is not injected into layout inputs. Layout and issue
nodes retain their own source files. `parseIssue` returns no usable nodes when it reports an error.

`inspectMarkdownNode` from `@samva/markup/edit` resolves a rendered origin to editable prose and
literal attributes. Pass `{ tag: "a" }` as its fourth argument to distinguish a link from a
paragraph sharing its source origin; without a tag it prefers the editable element. Feed its
property to `literalReplacement`, then call `applySourceReplacements`
with `{ markdown: { file: "issues/october.md" } }` to validate the rewritten issue. Offsets are
UTF-16, end-exclusive, and stale spans are refused. Prose edits retain ordinary punctuation;
syntax delimiters are escaped only where they could change the authored structure, and literal
line breaks or edge whitespace are encoded as character references.
