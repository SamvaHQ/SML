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
