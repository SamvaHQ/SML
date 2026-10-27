---
packages:
  npm:@samva/editor:
    type: minor
---

## Use saved versions without publishing

Hosts can omit `lifecycle.api.publish` from both the Promise and Effect APIs. The editor then shows Saved versions instead of Publish and keeps history, restore, and project-file editing available. Issue editors can schedule or send without a publish stub or a failing Publish button.

Use `EditorToolbarButton` with `variant="default"` for a primary host action such as Schedule; it shares the editor's primary button styling. The default remains `ghost`.
