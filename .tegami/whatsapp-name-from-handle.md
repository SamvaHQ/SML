---
packages:
  npm:@samva/markup:
    type: minor
  npm:@samva/editor:
    type: minor
---

## Meta's WhatsApp template name comes from the template's handle

`<WhatsApp>` no longer takes `name`. Samva registers each WhatsApp template with Meta under its
handle, so an authored name could only disagree with it. A template that still sets `name` fails
with `whatsapp-template-name`, which carries an upgrade recipe: remove the attribute.

`WhatsAppProps`, `IrWhatsApp`, `RenderedIrWhatsApp`, `WhatsAppChannelForm` and the editor host's
`WhatsAppRender` drop `name`. A `WhatsAppEdit` attribute edit names only `language` or `category`,
with a string value. The WhatsApp workspace no longer shows a Template name field.
