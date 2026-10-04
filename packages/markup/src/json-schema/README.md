# JSON Schema 2020-12

The eight files under `2020-12/` are the JSON Schema 2020-12 dialect, published by json-schema.org
and vendored here byte-for-byte:

| File                          | `$id`                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `schema.json`                 | `https://json-schema.org/draft/2020-12/schema`        |
| `meta/core.json`              | `https://json-schema.org/draft/2020-12/meta/core`     |
| `meta/applicator.json`        | `.../meta/applicator`                                 |
| `meta/unevaluated.json`       | `.../meta/unevaluated`                                |
| `meta/validation.json`        | `.../meta/validation`                                 |
| `meta/meta-data.json`         | `.../meta/meta-data`                                  |
| `meta/format-annotation.json` | `.../meta/format-annotation`                          |
| `meta/content.json`           | `.../meta/content`                                    |

`../input-schema.ts` loads them into a `@cfworker/json-schema` validator to check that a template's
declared input schema is a valid 2020-12 schema before it compiles anything against it. The dialect
is frozen, so these files change only if json-schema.org republishes it.

They are excluded from `oxfmt` (see `oxfmt.config.ts`) so they stay diffable against upstream.
