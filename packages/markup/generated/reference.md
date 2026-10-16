# Template authoring reference

A template is one TSX file that default-exports `defineTemplate({ id, schema, fixtures, email })`
from `@samva/markup`, in `templates/` (`emails/` is also recognized). Set
`jsxImportSource: "@samva/markup/email"`. `email` is `{ subject, preheader?, body }`; each is a
function of the validated input that the compiler reads without running. The IR it produces is what
every preview and send renders (IR version 1).

## Static profile

| Form                   | Example                                                                                          | Compiles to                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Text binding           | `{input.name}`                                                                                   | bind                                                |
| Attribute binding      | `{input.trackingUrl && <a href={input.trackingUrl}>Track</a>}`                                   | bind on the attribute                               |
| Template string        | `` `Order ${input.orderId}` ``                                                                   | concat                                              |
| Conditional            | `{input.trackingUrl && <p>Track it</p>}`                                                         | if                                                  |
| Either/or              | `{input.vip ? <p>Gold</p> : <p>Standard</p>}`                                                    | if / else                                           |
| Conditions             | `{input.items.length > 1 && input.total !== 0 && <p>Many</p>}`                                   | a predicate (===, !==, <, >, !, &&, \|\|, .length)  |
| Loop                   | `{input.items.map((item, index) => <li key={index}>{item.title}</li>)}`                          | each                                                |
| Filtered loop or count | `{input.items.filter((item) => item.qty > 1).length}`                                            | each with a where predicate, or a count             |
| Grid                   | `<Columns each={input.items} per={2}>{(item) => <Column><p>{item.title}</p></Column>}</Columns>` | each with a chunk size, one row per chunk           |
| Formatter              | `{fmt.money(input.total, input.currency)}`                                                       | format                                              |
| Arithmetic             | `{fmt.money(input.total * 2, input.currency)}`                                                   | an expression node, inside a formatter or condition |
| Conditional class      | `<p className={input.vip ? "bg-amber-100" : "bg-white"}>Hi</p>`                                  | if on the attribute                                 |

Refused, each with a diagnostic that names the fix:

| Form                             | Example                                                                   | Code                 |
| -------------------------------- | ------------------------------------------------------------------------- | -------------------- |
| A call other than fmt.* and .map | `{input.name.toUpperCase()}`                                              | `dynamic-expression` |
| A statement in a body            | `(input) => { const label = input.name; return <Email>{label}</Email>; }` | `statement-in-body`  |
| A hook                           | `{useState(0)}`                                                           | `hook-call`          |
| An event handler                 | `<a href="/x" onClick={() => 1}>x</a>`                                    | `event-handler`      |
| A class name built at run time   | ``<p className={`text-${input.name}`}>x</p>``                             | `dynamic-class`      |

There is no escape hatch: compute the value where the message is sent and add it to the schema.

## Formatters

| Formatter    | Signature                                                                            |
| ------------ | ------------------------------------------------------------------------------------ |
| `fmt.money`  | `money(amount: number, currency: string, locale?: string): string`                   |
| `fmt.number` | `number(value: number, options?: Intl.NumberFormatOptions, locale?: string): string` |
| `fmt.date`   | `date(iso: string, style?: DateStyle, locale?: string): string`                      |
| `fmt.time`   | `time(iso: string, style?: DateStyle, locale?: string): string`                      |
| `fmt.plural` | `plural(count: number, forms: PluralForms, locale?: string): string`                 |
| `fmt.list`   | `list(values: readonly string[], locale?: string): string`                           |

## Components

### Email

Import from `@samva/markup/email`.

| Prop               | Type             | Notes                                                                |
| ------------------ | ---------------- | -------------------------------------------------------------------- |
| `className?`       | `string`         | CSS classes applied to the primitive's content element.              |
| `lang?`            | `string`         |                                                                      |
| `dir?`             | `"ltr" \| "rtl"` |                                                                      |
| `title?`           | `string`         | Document title; several clients use it as the fallback preview line. |
| `backgroundColor?` | `string`         |                                                                      |
| `style?`           | `EmailStyle`     | Applied to the content cell, where Yahoo and AOL keep body styling.  |
| `children?`        | `EmailChild`     |                                                                      |

### Section

Import from `@samva/markup/email`.

| Prop          | Type                            | Notes                                                                |
| ------------- | ------------------------------- | -------------------------------------------------------------------- |
| `className?`  | `string`                        | CSS classes applied to the primitive's content element.              |
| `align?`      | `"left" \| "center" \| "right"` |                                                                      |
| `width?`      | `number \| string`              |                                                                      |
| `bgcolor?`    | `string`                        |                                                                      |
| `style?`      | `EmailStyle`                    | Applied to the content cell so padding survives Outlook and Klaviyo. |
| `tableStyle?` | `EmailStyle`                    |                                                                      |
| `children?`   | `EmailChild`                    |                                                                      |

### Columns

Import from `@samva/markup/email`.

| Prop         | Type                                                        | Notes                                                                                                                                                       |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `className?` | `string`                                                    | CSS classes applied to the primitive's content element.                                                                                                     |
| `align?`     | `"left" \| "center" \| "right"`                             |                                                                                                                                                             |
| `width?`     | `number \| string`                                          |                                                                                                                                                             |
| `style?`     | `EmailStyle`                                                |                                                                                                                                                             |
| `each?`      | `readonly Item[]`                                           | Repeat the cells for each item: `children` is then a function from an item (and its index in the row) to a `Column`. Without `per` all items share one row. |
| `per?`       | `number`                                                    | With `each`, the cells in a row; each chunk of items is its own `Columns` table.                                                                            |
| `children?`  | `EmailChild \| ((item: Item, index: number) => EmailChild)` | `Column` elements, or with `each` a function that returns one.                                                                                              |

### Column

Import from `@samva/markup/email`.

| Prop         | Type                            | Notes                                                   |
| ------------ | ------------------------------- | ------------------------------------------------------- |
| `className?` | `string`                        | CSS classes applied to the primitive's content element. |
| `align?`     | `"left" \| "center" \| "right"` |                                                         |
| `valign?`    | `"top" \| "middle" \| "bottom"` |                                                         |
| `width?`     | `number \| string`              |                                                         |
| `style?`     | `EmailStyle`                    |                                                         |
| `children?`  | `EmailChild`                    |                                                         |

### Button

Import from `@samva/markup/email`.

| Prop               | Type                            | Notes                                                                                                                                                                           |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `className?`       | `string`                        | CSS classes applied to the primitive's content element.                                                                                                                         |
| `href`             | `string`                        |                                                                                                                                                                                 |
| `width?`           | `number`                        | Pixel width of the box. Classic Outlook draws the VML shape at a fixed width, so without this it is estimated from the label and `paddingX`, and the anchor sizes to its label. |
| `height?`          | `number`                        | Pixel height; classic Outlook's VML fallback needs it.                                                                                                                          |
| `paddingX?`        | `number`                        | Horizontal padding on each side of the label when no `width` fixes the box.                                                                                                     |
| `backgroundColor?` | `string`                        |                                                                                                                                                                                 |
| `color?`           | `string`                        |                                                                                                                                                                                 |
| `borderRadius?`    | `number`                        |                                                                                                                                                                                 |
| `borderColor?`     | `string`                        |                                                                                                                                                                                 |
| `borderWidth?`     | `number`                        |                                                                                                                                                                                 |
| `fontSize?`        | `number`                        |                                                                                                                                                                                 |
| `fontFamily?`      | `string`                        |                                                                                                                                                                                 |
| `align?`           | `"left" \| "center" \| "right"` |                                                                                                                                                                                 |
| `style?`           | `EmailStyle`                    |                                                                                                                                                                                 |
| `children?`        | `EmailChild`                    | The label. A string label is required for the classic Outlook fallback.                                                                                                         |

### Spacer

Import from `@samva/markup/email`.

| Prop     | Type     | Notes |
| -------- | -------- | ----- |
| `height` | `number` |       |

### Divider

Import from `@samva/markup/email`.

| Prop         | Type         | Notes                                                   |
| ------------ | ------------ | ------------------------------------------------------- |
| `className?` | `string`     | CSS classes applied to the primitive's content element. |
| `color?`     | `string`     |                                                         |
| `thickness?` | `number`     |                                                         |
| `style?`     | `EmailStyle` |                                                         |

### Image

Import from `@samva/markup/email`.

| Prop         | Type                            | Notes                                                                |
| ------------ | ------------------------------- | -------------------------------------------------------------------- |
| `className?` | `string`                        | CSS classes applied to the primitive's content element.              |
| `src`        | `string`                        |                                                                      |
| `alt`        | `string`                        | Required. Use an empty string only for images that carry no meaning. |
| `width?`     | `number \| string`              |                                                                      |
| `height?`    | `number \| string`              |                                                                      |
| `align?`     | `"left" \| "center" \| "right"` |                                                                      |
| `style?`     | `EmailStyle`                    |                                                                      |

### Link

Import from `@samva/markup/email`.

| Prop         | Type         | Notes                                                   |
| ------------ | ------------ | ------------------------------------------------------- |
| `className?` | `string`     | CSS classes applied to the primitive's content element. |
| `href`       | `string`     |                                                         |
| `target?`    | `string`     |                                                         |
| `rel?`       | `string`     |                                                         |
| `style?`     | `EmailStyle` |                                                         |
| `children?`  | `EmailChild` |                                                         |

### BrandLogo

Import from `samva:brand`.

| Prop         | Type                            | Notes                                                   |
| ------------ | ------------------------------- | ------------------------------------------------------- |
| `width?`     | `number`                        | Rendered width in pixels; the height follows the image. |
| `alt?`       | `string`                        | Defaults to the brand footer's company name.            |
| `align?`     | `"left" \| "center" \| "right"` |                                                         |
| `className?` | `string`                        |                                                         |

### BrandFooter

Import from `samva:brand`.

| Prop                | Type     | Notes                         |
| ------------------- | -------- | ----------------------------- |
| `unsubscribeLabel?` | `string` | Text of the unsubscribe link. |
| `className?`        | `string` |                               |

## HTML elements

- `html`: flow content; attributes: `xmlns`, `xmlns:o`, `xmlns:v`, `xmlns:w`.
- `head`: flow content; attributes: global attributes only.
- `title`: text content; attributes: global attributes only.
- `style`: raw content; attributes: `type`.
- `meta`: void content; attributes: `name`, `content`, `charset`, `http-equiv`.
- `body`: flow content; attributes: `bgcolor`.
- `div`: flow content; attributes: `align`.
- `section`: flow content; attributes: `align`.
- `article`: flow content; attributes: `align`.
- `header`: flow content; attributes: `align`.
- `footer`: flow content; attributes: `align`.
- `main`: flow content; attributes: `align`.
- `center`: flow content; attributes: global attributes only.
- `p`: flow content; attributes: `align`.
- `blockquote`: flow content; attributes: `align`.
- `pre`: flow content; attributes: global attributes only.
- `h1`: flow content; attributes: `align`.
- `h2`: flow content; attributes: `align`.
- `h3`: flow content; attributes: `align`.
- `h4`: flow content; attributes: `align`.
- `h5`: flow content; attributes: `align`.
- `h6`: flow content; attributes: `align`.
- `span`: flow content; attributes: global attributes only.
- `strong`: flow content; attributes: global attributes only.
- `b`: flow content; attributes: global attributes only.
- `em`: flow content; attributes: global attributes only.
- `i`: flow content; attributes: global attributes only.
- `u`: flow content; attributes: global attributes only.
- `s`: flow content; attributes: global attributes only.
- `small`: flow content; attributes: global attributes only.
- `code`: flow content; attributes: global attributes only.
- `a`: flow content; attributes: `href`, `target`, `rel`, `name`.
- `img`: void content; attributes: `src`, `alt`, `width`, `height`, `border`, `align`.
- `table`: flow content; attributes: `width`, `height`, `border`, `cellpadding`, `cellspacing`, `align`, `bgcolor`.
- `caption`: flow content; attributes: `align`.
- `colgroup`: flow content; attributes: `span`, `width`.
- `col`: void content; attributes: `span`, `width`.
- `thead`: flow content; attributes: `align`, `valign`, `bgcolor`.
- `tbody`: flow content; attributes: `align`, `valign`, `bgcolor`.
- `tfoot`: flow content; attributes: `align`, `valign`, `bgcolor`.
- `tr`: flow content; attributes: `align`, `valign`, `bgcolor`, `height`.
- `td`: flow content; attributes: `align`, `valign`, `width`, `height`, `bgcolor`, `colspan`, `rowspan`.
- `th`: flow content; attributes: `align`, `valign`, `width`, `height`, `bgcolor`, `colspan`, `rowspan`.
- `ul`: flow content; attributes: global attributes only.
- `ol`: flow content; attributes: `start`, `type`.
- `li`: flow content; attributes: global attributes only.
- `br`: void content; attributes: global attributes only.
- `hr`: void content; attributes: `width`, `size`, `align`.

Global attributes: `id`, `title`, `lang`, `dir`, `role`.

## Diagnostics

| Code                         | Meaning                                                                                                                                                         | Fix                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `brand-import-conflict`      | The project imports two different brands.                                                                                                                       | Import one brand specifier everywhere.                                                             |
| `brand-unavailable`          | The build has no brand to resolve a brand import.                                                                                                               | Create or select the brand the import names.                                                       |
| `button-dynamic-label`       | A Button label is read at render time, so classic Outlook cannot size it.                                                                                       | Give the button a width: <Button width={200}>.                                                     |
| `button-outlook-fallback`    | Classic Outlook needs a height and a plain string label to draw the button.                                                                                     | Give <Button> a height and a string label.                                                         |
| `caniemail/unknown-coverage` | A feature has no client-support data.                                                                                                                           | Verify it in the target clients.                                                                   |
| `css-conditional-variable`   | A custom property is redefined inside a conditional at-rule.                                                                                                    | Keep the override on a class rule.                                                                 |
| `css-import-unresolved`      | A stylesheet @import cannot be resolved.                                                                                                                        | Import the stylesheet from the template module, or use the theme.css layers.                       |
| `css-parse-error`            | A stylesheet does not parse.                                                                                                                                    | Fix the CSS at the reported location.                                                              |
| `css-unsupported-at-rule`    | An at-rule is not applied to email output.                                                                                                                      | Remove it or move the declarations into a class rule.                                              |
| `dangerous-html`             | dangerouslySetInnerHTML; there is no raw-HTML escape hatch.                                                                                                     | Write the markup as JSX.                                                                           |
| `duplicate-attribute`        | An attribute is written twice.                                                                                                                                  | Keep one.                                                                                          |
| `dynamic-class`              | A class name is built at run time, and Tailwind cannot see it.                                                                                                  | Write classes literally, or choose between literal lists: input.vip ? "bg-amber-100" : "bg-white". |
| `dynamic-definition`         | A definition field is spread or computed instead of written out.                                                                                                | Write each field as name: value.                                                                   |
| `dynamic-expression`         | An expression outside the static profile: a call other than fmt.* and .map, a computed value, or a spread.                                                      | Compute the value where the message is sent and bind it from the payload.                          |
| `dynamic-numeric-prop`       | A prop that sizes layout at compile time is not a number literal.                                                                                               | Write the number literally, for example height={44}.                                               |
| `email-font-fallback`        | A font stack names a project font without a generic fallback.                                                                                                   | End the stack with sans-serif, serif or monospace.                                                 |
| `email-font-family`          | @font-face declares no font-family.                                                                                                                             | Add font-family.                                                                                   |
| `email-font-format`          | @font-face uses a format other than WOFF2.                                                                                                                      | Convert the file to .woff2.                                                                        |
| `email-font-missing`         | @font-face names a file the project does not hold.                                                                                                              | Add the file; paths resolve from the stylesheet's directory.                                       |
| `email-font-src`             | @font-face declares no usable url() src.                                                                                                                        | Add a url() pointing at a .woff2 file.                                                             |
| `event-handler`              | An event handler; email clients strip scripting.                                                                                                                | Remove the handler; use a link for interaction.                                                    |
| `fixture-invalid`            | A fixture does not match the schema.                                                                                                                            | Change the fixture, or the schema, so every fixture is a payload a send could carry.               |
| `fixtures-not-static`        | A fixture is computed instead of written as data.                                                                                                               | Write each fixture as a literal object; an imported asset is allowed.                              |
| `formatter-arguments`        | A formatter got the wrong number of arguments.                                                                                                                  | Match the formatter's signature in the contract.                                                   |
| `hook-call`                  | A hook was called; templates have no state, effects or context.                                                                                                 | Read the input through the function's parameter and send anything else in the payload.             |
| `invalid-asset-base`         | The asset base is not an https URL or a path.                                                                                                                   | Use an https URL, an absolute path, or a relative path.                                            |
| `invalid-attribute-value`    | An attribute value is not a string or number, or contains control characters.                                                                                   | Pass plain text.                                                                                   |
| `invalid-binding-type`       | A binding has the wrong type for where it is used.                                                                                                              | Bind a field of the type the position needs, or send it in that type.                              |
| `invalid-button-number`      | A Button size prop is not a finite number.                                                                                                                      | Pass a finite number.                                                                              |
| `invalid-channel`            | A channel field is not shaped as the channel requires.                                                                                                          | Write email: { subject, preheader?, body } with each a function of the input.                      |
| `invalid-columns-each`       | <Columns each> is not a list from the input.                                                                                                                    | Write each={input.items} with a callback returning <Column>.                                       |
| `invalid-columns-per`        | <Columns per> is not a positive integer literal.                                                                                                                | Write per={2}.                                                                                     |
| `invalid-content`            | An element holds content its content model does not allow.                                                                                                      | Move the child to a parent that accepts it.                                                        |
| `invalid-fixture-name`       | A fixture key is not a single path segment.                                                                                                                     | Use letters, digits, '.', '_' and '-', starting with a letter or digit.                            |
| `invalid-locale`             | The template's default locale is not a string literal.                                                                                                          | Write locale: "en-US".                                                                             |
| `invalid-preheader`          | The preheader is not a string.                                                                                                                                  | Return a string.                                                                                   |
| `invalid-schema`             | The schema uses JSON Schema keywords the compiler cannot validate against.                                                                                      | Use only the JSON Schema keywords the package README lists.                                        |
| `invalid-style`              | A style prop is not a static property object.                                                                                                                   | Write style={{ backgroundColor: "#fff" }} with literal values, or use classes.                     |
| `invalid-style-value`        | A style value is not a string or number.                                                                                                                        | Pass a string or number.                                                                           |
| `invalid-subject`            | The subject is not one line of text.                                                                                                                            | Return a single-line string.                                                                       |
| `invalid-template-id`        | The template id is not a lowercase kebab-case string literal.                                                                                                   | Write id: "order-shipped".                                                                         |
| `invalid-text`               | The plain-text body is not a string.                                                                                                                            | Return a string.                                                                                   |
| `legacy-definition`          | The entry default-exports something other than defineTemplate.                                                                                                  | Import { defineTemplate } from "@samva/markup" and default-export defineTemplate({ ... }).         |
| `missing-attribute`          | An element is missing a required attribute.                                                                                                                     | Add the attribute, for example alt on img.                                                         |
| `missing-body`               | The email channel has no body.                                                                                                                                  | Add body: (input) => (<Email>...</Email>).                                                         |
| `missing-fixtures`           | The template declares no fixtures.                                                                                                                              | Add fixtures: { default: { ... } } with at least one valid payload.                                |
| `missing-head`               | Styles that cannot be inlined need a <head> to live in.                                                                                                         | Wrap the message in <Email>, or write those declarations inline.                                   |
| `missing-schema`             | The template declares no input schema.                                                                                                                          | Add schema: jsonSchema<Input>({ ... }).                                                            |
| `missing-subject`            | The email channel has no subject.                                                                                                                               | Add subject: (input) => ....                                                                       |
| `moved-import`               | The file imports an @samva/markup entry that moved.                                                                                                             | Import email components from "@samva/markup/email".                                                |
| `multiple-roots`             | The body renders nothing or more than one root.                                                                                                                 | Wrap the body in a single element such as <Email>.                                                 |
| `nesting-limit`              | The template nests deeper than the compiler reads.                                                                                                              | Flatten the structure.                                                                             |
| `no-channel`                 | The template declares no channel body.                                                                                                                          | Add an email body.                                                                                 |
| `no-template`                | The entry does not default-export a template.                                                                                                                   | Default-export defineTemplate({ ... }) imported from @samva/markup.                                |
| `non-project-import`         | The file imports something other than @samva/markup or a project file.                                                                                          | Remove the import, or copy the code you need into a project file.                                  |
| `not-a-function`             | A channel field is not a function of the input.                                                                                                                 | Write (input) => ... in place or declare the function in the project.                              |
| `preheader-without-shell`    | A preheader is set but the body has no <Email> shell to hold it.                                                                                                | Wrap the body in <Email>.                                                                          |
| `recursive-partial`          | A partial renders itself; partials are inlined at compile time.                                                                                                 | Flatten the recursion, or repeat the structure with .map.                                          |
| `reserved-attribute`         | An attribute is written only by a brand component.                                                                                                              | Render BrandFooter from the brand import instead of marking an element as the footer.              |
| `reserved-character`         | Text contains a private-use character the compiler reserves.                                                                                                    | Remove the characters U+E000 to U+E003.                                                            |
| `reserved-url`               | A URL is the unsubscribe placeholder only BrandFooter can write.                                                                                                | Render <BrandFooter /> instead.                                                                    |
| `schema-not-static`          | The schema cannot be read without running code.                                                                                                                 | Write the schema as a literal jsonSchema<Input>({ type: 'object', ... }).                          |
| `statement-in-body`          | A body contains a statement (const, if, a loop); a body is one expression.                                                                                      | Use cond && <X />, cond ? <A /> : <B /> and .map, or send the computed value in the payload.       |
| `syntax-error`               | A project file does not parse as TSX.                                                                                                                           | Fix the syntax at the reported location.                                                           |
| `tailwind-dynamic-class`     | A class list is assembled at run time.                                                                                                                          | Write the classes literally.                                                                       |
| `too-many-class-variants`    | A class list chooses between more literal lists than the compiler resolves.                                                                                     | Split the choice into fewer conditions, or move part of it to a partial.                           |
| `unguarded-optional`         | An optional field is read outside a guard, so a send without it would render a blank.                                                                           | Guard it with {input.field && ...}, or make the field required.                                    |
| `unknown-component`          | A component the profile cannot read.                                                                                                                            | Import components from @samva/markup/email, the brand import, or the project.                      |
| `unknown-field`              | A binding names a field the schema does not declare.                                                                                                            | Add the field to the schema, or bind a field it declares (the message suggests the nearest).       |
| `unknown-formatter`          | fmt.<name> is not a formatter.                                                                                                                                  | Use fmt.money, number, date, time, plural or list.                                                 |
| `unmatched-class`            | A class produced no styles.                                                                                                                                     | Use a class the theme or Tailwind defines, or write the style inline.                              |
| `unresolved-import`          | An import names no file in the project.                                                                                                                         | Check the path and the file extension.                                                             |
| `unsafe-raw-text`            | Raw text content contains markup that could end its element.                                                                                                    | Remove the offending sequence.                                                                     |
| `unsafe-style-value`         | A style value contains CSS that could break out of its declaration.                                                                                             | Remove the offending characters.                                                                   |
| `unsafe-url`                 | A URL uses a scheme email cannot send safely.                                                                                                                   | Use an https URL, a mailto: or tel: link, or a bound URL.                                          |
| `unsupported-attribute`      | An attribute the element does not support.                                                                                                                      | Use a supported attribute, or data-* and aria-*.                                                   |
| `unsupported-element`        | An element outside the supported email vocabulary.                                                                                                              | Use an element from the contract's element table.                                                  |
| `unsupported-pattern`        | A parameter pattern or default value the profile cannot bind.                                                                                                   | Use plain names or destructuring without defaults; declare the field required or guard it.         |
| `unsupported-style-property` | A style property name is not a CSS property.                                                                                                                    | Write camelCase (backgroundColor) or a custom property (--brand).                                  |
| `void-element-children`      | A void element has children.                                                                                                                                    | Remove the children.                                                                               |
| `caniemail/<feature>`        | A CSS property, HTML element or attribute that a target email client ignores or partly supports (from the caniemail.com data), reported as caniemail/<feature>. | Use the alternative the message names, such as an email component instead of display: flex.        |

## Upgrades

### `legacy-definition`

Read the entry and its imports without executing them. For a default-exported defineEmail definition, import defineTemplate from "@samva/markup" and replace the definition call.

Preserve the entry path, template id, schema, named fixtures, content, design, bindings, conditions, project partials, assets, theme and brand imports. Replace render(input) returning { subject, preheader?, body } with email: { subject: (input) => ..., preheader: (input) => ..., body: (input) => ... }, retaining its parameter bindings and each returned expression; omit preheader when absent.

Inline module constants only when they are literal strings, numbers or booleans and their bindings are unambiguous; never substitute a fixture value for an input binding. Keep each channel function a single static-profile expression, and keep subject and preheader off <Email>.

Helper calls, `Math.*`, general arithmetic, render statements, spreads, computed properties and runtime clock or seed have no direct conversion. Rewrite with static-profile bindings, conditions, .map, .filter, project partials or `fmt.*` where equivalent; arithmetic is allowed only in formatter arguments and conditions. Otherwise compute the value in the sender, declare a payload field in the schema and every fixture, and explain the required sender change. Never guess time, randomness or computed data.

Explicit text has no email-channel field: plain text is derived from the body. If deriving it changes intended content, or another construct cannot be preserved, explain the tradeoff and ask rather than silently discard it. Do not drop fixtures, weaken validation or hide diagnostics.

Convert every affected entry in the project at its existing path, including emails/ entries. Compile each entry, render every declared fixture and inspect the affected output. Resolve errors before requesting one saved version for the whole project, approved by the user; do not publish.

### `moved-import`

Replace every import from "@samva/markup/email/components" with "@samva/markup/email" in every project file, templates and partials alike. The imported names are unchanged; change only the specifier.

Compile each entry and render every declared fixture to confirm the output is unchanged. Resolve errors before requesting one saved version for the whole project, approved by the user; do not publish.

## Quality bar

- Run the check until it reports no errors, then render every fixture.
- Cover every branch with a fixture: default, missing optional fields, many items.
- Look at the render at desktop and mobile widths before finishing.
- Compute anything the profile cannot express where the message is sent and add it to the schema.
