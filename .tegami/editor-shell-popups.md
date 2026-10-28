---
packages:
  npm:@samva/editor:
    type: patch
---

## Keep editor popups inside the shell portal

Menus, popovers, selects, tooltips, and dialogs render inside the editor shell's portal with Base UI 1.9, and explicit menu portal compositions inherit the shell container.
