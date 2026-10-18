---
packages:
  npm:@samva/markup:
    type: minor
  npm:@samva/editor:
    type: minor
---

## WhatsApp template FLOW buttons

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
