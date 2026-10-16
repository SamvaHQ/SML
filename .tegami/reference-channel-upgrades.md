---
packages:
  npm:@samva/markup:
    type: patch
---

#### The authoring reference omits channel-only upgrade recipes

`generated/reference.md` lists upgrade recipes only for diagnostics that apply to every template,
matching its diagnostics table and `contract.json`. The `whatsapp-template-name` recipe stays in the
diagnostic codes, where an agent migrating a WhatsApp template reads it.
