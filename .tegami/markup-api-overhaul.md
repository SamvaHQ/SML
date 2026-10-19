---
packages:
  npm:@samva/markup:
    type: minor
  npm:@samva/vite:
    type: minor
  npm:@samva/editor:
    type: minor
---

## One compiler for every host, one render, one error model

Breaking. Update imports and calls as follows:

| Before                                                                         | After                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `renderIr(ir, input, options)`                                                 | `render(template, input, { channel: "email", ...options })`                                                             |
| `renderIrSms(ir, input)` (a string)                                            | `render(template, input, { channel: "sms" })` (`{ text, segments }`)                                                    |
| `renderIrWhatsApp(ir, input)`                                                  | `render(template, input, { channel: "whatsapp" })`                                                                      |
| `renderIrPreview` from `./render`                                              | `previewEmail` from `./edit`                                                                                            |
| `TemplateIr`, `SML_IR_VERSION`                                                 | `CompiledTemplate`, `COMPILED_TEMPLATE_VERSION`                                                                         |
| `IrRenderError`                                                                | `RenderError`, a tagged error                                                                                           |
| `compileTemplate(...).ir`                                                      | `compileTemplate(...).template`                                                                                         |
| `checkStaticProfile(files, entry, plugin)`                                     | `checkTemplate(files, { entry, brandPlugin })`                                                                          |
| `introducedProfileErrors`                                                      | `introducedErrors`                                                                                                      |
| `checkTemplateCompatibility`, `checkEmailCompatibility` from `./compiler`      | `checkCompatibility`, `checkHtmlCompatibility` from `./compatibility`                                                   |
| `renderBrandFooter(brand, { unsubscribe })`                                    | `compileFooter(brand)`, which returns `{ footer, diagnostics }`; strip the unsubscribe row with `withoutUnsubscribeRow` |
| `renderBrandSample` from `./brand-sample`                                      | `previewBrand(brand)` from `./compiler`                                                                                 |
| `parseBrandSpecifier(s, plugin)`, `projectBrandSpecifier(files, path, plugin)` | `parseBrandSpecifier(s, { brandPlugin })`, `projectBrandSpecifier(files, { themePath, brandPlugin })`                   |
| `@samva/vite` `TemplateBuild.ir`, `CompiledEntry.ir`                           | `.compiled`                                                                                                             |

- `./compiler` now loads in a browser. caniemail, whose glob dependency reads Node's `process`, is
  only in `./compatibility`.
- `./compiler` exports only `compileTemplate`, `checkTemplate`, `introducedErrors`,
  `compileFooter`, `previewBrand` and the brand specifiers. The cascade, CSS, Tailwind and
  serializer helpers are no longer public, and `./brand-sample` is removed.
- Compile and check functions return diagnostics and do not throw for bad input; `render` throws
  only `RenderError`, including for a compiled template version it does not know. Stored compiled
  templates keep their `sml` key and stay readable.
- `readSmsChannel` and `readWhatsAppChannel` return `undefined` instead of `null`.
