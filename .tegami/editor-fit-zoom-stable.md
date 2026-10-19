---
packages:
  npm:@samva/editor:
    type: patch
---

## Fit zoom holds steady when the email nearly fills the canvas

The canvas reserves its scrollbar gutter, so Fit zoom no longer flips between two sizes when the
zoomed email is close to the canvas height.
