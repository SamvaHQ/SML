## @samva/editor@0.22.0

### Keep editor popups inside the shell portal

Menus, popovers, selects, tooltips, and dialogs render inside the editor shell's portal with Base UI 1.9, and explicit menu portal compositions inherit the shell container.

## @samva/editor@0.21.0

### `useEditorPortalContainer` returns the portal element

`useEditorPortalContainer()` returns the mounted portal element (`HTMLDivElement | null`) instead of a ref. `null` means the shell is up and the element is not yet; `undefined` still means there is no shell, and popups use `document.body`. Pass the element to a Base UI portal `container`. Reading `.current` on the return value no longer typechecks.

Base UI 1.9 reads a ref's `.current` from `useLayoutEffect` before React attaches a later sibling's ref, so a ref that is still empty sends every popup to `document.body` and does not try again. The shell still paints the portal root after the frame.

### Use saved versions without publishing

Hosts can omit `lifecycle.api.publish` from both the Promise and Effect APIs. The editor then shows Saved versions instead of Publish and keeps history, restore, and project-file editing available. Issue editors can schedule or send without a publish stub or a failing Publish button.

Use `EditorToolbarButton` with `variant="default"` for a primary host action such as Schedule; it shares the editor's primary button styling. The default remains `ghost`.

## @samva/editor@0.20.0

### Calmer checks, a clearer brand menu, and toolbar buttons hosts can match

The Checks panel no longer shows "Needs attention" above "No known risks found." When nothing is actionable it shows a settled "No issues found", and the note about email clients now counts "tips", the same word as the status bar.

The brand menu lists your brands by name with their swatches, under "Apply a brand" when the template has none. The organization default carries a muted "Default" tag, left off when the brand is already named Default.

The Publish sheet shows placeholder rows shaped like saved versions while they load, so the list does not jump when it arrives.

`@samva/editor/shell` exports `EditorToolbarButton`. Contribute it to `toolbar.actions` and it matches the top bar's buttons in size, radius and type, folds to its icon with a tooltip when the top bar folds its own labels, and works as a Base UI `render` target such as a popover trigger.

### Open Markdown issues in Source

Email documents accept a `markdown` origin with the complete issue source, including frontmatter,
and `layout: { file }` identifying the host-owned TSX layout. The Source tab edits the issue through
the existing revision-fenced writer. Prose edits from either preview update the same source and
participate in undo/redo without requiring a project lifecycle capability. Layout spans are
read-only, and TSX-only structural, expression, fixture-data and class-name edits are hidden.

The host contract version is now `2026-10-26.1`: hosts must handle the email origin union and
write `origin.file` for source saves. SMS and WhatsApp remain TSX-only. The TSX editing behavior
and compiled email output are unchanged.

## @samva/editor@0.19.0

### Author newsletter issues in SML Markdown

Parse `issues/*.md` with typed YAML frontmatter and static SML component tags through
`@samva/markup/markdown`. Unknown components, raw HTML, expressions, and invalid metadata return
located diagnostics. Prose and component attributes retain exact editable source spans. Prose
edits preserve ordinary punctuation and protect only syntax-sensitive delimiters and whitespace.

Compile each issue into an email-only TSX layout containing one `<IssueContent />` from
`@samva/markup/email`, then render the shared document to email or web. Vite discovers issues
separately from template entries and includes them in project build, render, and export workflows.
Existing template email output and golden digests are unchanged.

### Preview the web page beside the email, and edit Markdown text on the page

A host that offers `render(entry, fixture, target)` shows an Email | Web toggle in the preview bar. The web page is selected the same way as the email: a click resolves `data-samva-instance` to the authored element, and the selection stays on the same element when you switch between the two. A host that does not offer `render` is unchanged, and `EmailRender` gains an optional `kind` so a render can be told apart from a `PageRender`.

Double-click text that was written in Markdown to edit it in place on the web page. Enter saves the text into the Markdown file through the host's project `lifecycle`, and Escape puts the text back. Text that holds inline markup, and text written in TSX, is not edited in place.

The Checks tab opens with "Email differences", which lists the components that look simpler in email than on the web, how many places each appears, and a Show action that selects the first one in the email. On the web page, the preview bar counts them.

### Render email templates as web pages

**Breaking:** replace `render(template, input, { channel })` with
`render(template, input, { target })`. Use `target: "email"`, `"sms"`, or `"whatsapp"` for message
delivery, and `target: "web"` for the semantic HTML body and head hints of an email template.
Recompile stored templates to compiled document version `sml: 2` before rendering them with this
version. Compilation digests change with this document format.

Email and web share the template's components, bindings, conditions, loops, and source positions.
Email preserves the existing rendered HTML, subject, preheader, and text byte for byte, including
Outlook fallbacks. The web target emits semantic HTML with styles supplied separately to the page
shell. `templateEmailDegradations` locates component fidelity declarations in source, and
`checkCompatibility` reports content losses alongside client HTML findings.

## @samva/editor@0.18.1

### Preview and compatibility report close with an X

The Preview overlay and the Compatibility report dialog close from an icon-only X button instead of
a bordered "Close" label. Esc still dismisses both.

## @samva/editor@0.18.0

### The brand chip is one menu, and the top and status bars read cleanly

The brand chip opens a menu of the organization's brands. Choosing one rewrites the theme's brand
import, and every `samva:brand` component import in the project's scripts, and saves a version; a project with no brand offers "Use {default}", and "Manage brands"
links to the host's page. `EditorBrandSource.brandLink(slug)` is replaced by an optional
`manageLink()`, and `EditorBrand` takes an optional `color` for the chip's swatch. The status bar
splits checks by severity ("3 warnings · 22 tips", errors in the error tone) and reads "Draft ·
saved 2 min ago" from the draft's last save. The Assistant header, the work pane's tab row and the
preview bar share one height and divider. `@samva/editor/shell` exports `editorChipClass` and
`editorChipTriggerClass` so a host's control beside the document name, such as an email switcher,
matches the editor's chips.

## @samva/editor@0.17.3

### A host can open a narrow workspace on the preview

`EditorProvider` takes `initialPane`. Below 1280px a docked workspace shows one pane at a time and
starts on the chat; a host whose own app is the conversation, such as ChatGPT, passes
`initialPane="preview"` so the email is on screen first. The Chat | Preview switch works as before.

## @samva/editor@0.17.2

### The status bar says what is left to check

The status bar's checks summary reads "24 checks to review" when client verification remains and
"No issues found" when nothing does, instead of "No known risks · 24 need verification". In an email
workspace with a docked assistant, clicking it opens the Checks tab; other layouts keep the popover.

## @samva/editor@0.17.1

### The editor's chrome stays put while a document opens

The preview bar, the brand chip and the docked pane switch now draw from the first paint instead
of appearing when the document arrives, so the canvas and the top bar controls no longer move
when a slow host finishes opening the document. The brand chip shows a "Brand" placeholder while
the theme loads.

## @samva/editor@0.17.0

### A tabbed work pane beside the assistant

With a docked assistant, the editor shows the chat beside one work pane instead of a third
Design column. Preview is always open; Source, Design (layers beside the inspector), Review and
Checks open from the pane's "+" menu, close from a × that appears on hover or focus (always on
touch screens), and stay open the next time the editor loads. Collapse the chat to give the work
pane the full width, or drag the divider: the chat keeps between 280px and 640px and collapses
when dragged narrower than 140px, by mouse, touch or keyboard.

Below 1280px of editor width the two panes become a Chat | Preview switch, with a dot on Preview
when the email changed while you were in the chat. Every view stays reachable down to a phone,
where the editor's own controls take 44px touch targets.

### A preview bar and real zoom

Above the email, the preview bar holds the version picker (search the saved versions; restoring an
older one asks first), the desktop and phone widths, the fixture picker (moved from the toolbar for
email; SMS and WhatsApp keep it there), the size of the email, open in a new tab, and refresh, with
a thin progress line while a new preview is on its way. The canvas zooms from 50% to 200% or fits
its pane, from the floating control, a trackpad pinch, or ⌘/Ctrl with +, − and 0, without zooming
the page.

Hosts can report the size of the email as sent on `EmailRender.sentBytes`; the size readout and
the Gmail clipping check use it, and otherwise say they measure the preview. `EditorShell` takes
`previewBusy` to show the progress line while the host works, and `onOpenPreview` to offer open
in a new tab.

### Chrome built from shadcn parts

The editor's controls are shadcn's Base UI components (`base-nova` classes) styled with Tailwind on
shadcn's token names, so a shadcn host draws the editor in its own theme. `EditorShell` is now a
thin assembly of exported parts — `EditorRoot`, `EditorTopBar`, `EditorWorkspace`,
`EditorStatusBar`, `EditorAssistantDock`, `EditorDivider`, `EditorPaneSwitch`, `EditorWorkPane`,
`EditorCanvas`, `EditorPreviewBar`, `EditorVersionPicker`, `EditorFixtureSelect` and
`EditorZoomControl` — that a host can rearrange. Each part carries a `data-slot`, exposes its state
as data attributes, merges `className` (a string or a function of its state) with tailwind-merge,
and takes Base UI's `render` prop. The README lists every slot and state attribute.

Below 1280px the Chat | Preview switch sits in the top bar; on a phone the top bar stays one row,
the work pane's tab row steps aside while Preview is its only tab, and the editor's own controls
get an invisible 44px hit area instead of growing. The status bar lines up with the panes.

The `--editor-raised-*`, `--editor-chip-*` and `--editor-pressed-*` variables are gone; restyle the
chrome through Tailwind on shadcn's tokens or the parts' `className`. Popups animate with
`tw-animate-css` where the host loads it.

### One compiler for every host, one render, one error model

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

### Design mode and pins

The preview bar has a **Design** switch. In Design, a click on the email selects it with a
toolbar that steps out to its container, moves, duplicates or deletes it, and beside a docked
assistant the element's properties sit next to the email. Edits from the toolbar, the properties
and the fixture data are staged instead of saved one field at a time: the preview shows them, a
dock counts them, and undo, redo, reset (after a confirm) and a locked before-and-after compare
work over them. **Apply** saves them as one version named "Design: N edits". Leaving Design waits
for the edits to be applied or reset, and Design waits while an assistant turn is running.

The Design tab speaks the author's language. Layers name the blocks and elements the template
wrote (`Section`, `Button`, `Heading`, `Text`, `Image`) and leave out the compiler's tables and
cells; a loop's copies are one layer. The inspector names the element and the blocks around it,
with no internal paths, and edits it with plain controls: text with data bindings shown as chips,
image description and size, component settings, theme colors as named swatches, type size and
weight, alignment, and spacing. Each change is staged like any Design edit. The raw props and
classes are under **Advanced**, and the whole template is in Source.

Beside a docked assistant, the **Pin** switch drops numbered pins on parts of the email. A tray
lists them with a note each, removes one at a time, and clears all after a confirm.

For hosts:

- `EditorProvider` takes `onPinsChange`, called with every `EditorPin` in tray order whenever the
  pins change. The `rail.assistant` contribution reads `workspace.pins` and gets `removePin` and
  `clearPins`, so a chat can attach pins to its next message and clear them once sent.
- `workspace.design` reports `{ on, pending, applying, waiting }`. Hold the chat while `waiting`
  is true.
- `versions.save(revision, options)` receives `options.message`, the name the editor asks for.
  The parameter is optional, so an existing host keeps working and names versions itself.

### A warning for hotlinked images

`email-external-asset` warns when an email's image points at an absolute URL outside the project's
asset base. A hotlinked image can disappear, be blocked, track recipients or slow the message; the
fix is to add the image to the project and import it. It is a warning, so every template that
compiled before still compiles, and compiled output is unchanged: the email parity digests do not
move.

## @samva/editor@0.15.1

### Fit zoom holds steady when the email nearly fills the canvas

The canvas reserves its scrollbar gutter, so Fit zoom no longer flips between two sizes when the
zoomed email is close to the canvas height.

## @samva/editor@0.15.0

### WhatsApp template FLOW buttons

`<WhatsApp.FlowButton flow="order-survey">Take survey</WhatsApp.FlowButton>` adds a Meta FLOW
button to a WhatsApp template. `flow` is the Samva flow handle (lowercase kebab-case, the file
`flows/<handle>.json` in the template project); Samva maps it to Meta's flow id per business
account when it registers the template. `action` is `navigate` by default or `data_exchange`, and
`screen` names the screen a `navigate` flow opens on (omitted, the flow's first entry screen);
`screen` is refused with `data_exchange`. `flow`, `action` and `screen` are string literals, and a
template holds at most one flow button.

The IR button is `{ type: "flow", text, flow, action, screen? }`, and the rendered WhatsApp
channel and the editor preview carry it. The editor shows a flow button as a locked row; it is
authored in source.

## @samva/editor@0.13.0

### Meta's WhatsApp template name comes from the template's handle

`<WhatsApp>` no longer takes `name`. Samva registers each WhatsApp template with Meta under its
handle, so an authored name could only disagree with it. A template that still sets `name` fails
with `whatsapp-template-name`, which carries an upgrade recipe: remove the attribute.

`WhatsAppProps`, `IrWhatsApp`, `RenderedIrWhatsApp`, `WhatsAppChannelForm` and the editor host's
`WhatsAppRender` drop `name`. A `WhatsAppEdit` attribute edit names only `language` or `category`,
with a string value. The WhatsApp workspace no longer shows a Template name field.

## @samva/editor@0.12.0

### Hosts can prepare preview documents before parsing

`EditorProvider` accepts `preparePreviewDocument`, and `@samva/editor/shell` exports
`PreparedPreviewDocument`. Canvas and Preview write the prepared HTML, then mount host resources
before measurement and paint. Resources are cleaned up for their exact document on replacement,
unmount, and StrictMode replay. Replacing the preparation callback replaces the preview frames.

## @samva/editor@0.11.3

### Hosts can follow element selection gestures

`EditorProvider` accepts `onSelectElement`, which reports the selected instance path, render
revision and fixture only when the user selects an element. Automatic selection rebinding after a
document change does not call it. `UserSelection` is exported from `@samva/editor/shell`.

### Hosts can import a neutral editor theme

`@samva/editor/base.css` supplies light and dark design tokens for hosts without their own
theme. Import it after Tailwind and before `@samva/editor/styles.css`.

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
