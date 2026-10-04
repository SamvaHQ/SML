---
packages:
  npm:@samva/editor:
    type: patch
---

## Hosts can follow element selection gestures

`EditorProvider` accepts `onSelectElement`, which reports the selected instance path, render
revision and fixture only when the user selects an element. Automatic selection rebinding after a
document change does not call it. `UserSelection` is exported from `@samva/editor/shell`.

## Hosts can import a neutral editor theme

`@samva/editor/base.css` supplies light and dark design tokens for hosts without their own
theme. Import it after Tailwind and before `@samva/editor/styles.css`.
