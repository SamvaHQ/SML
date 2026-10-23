---
packages:
  npm:@samva/markup:
    type: patch
---

## An important declaration keeps `!important` when it is inlined

A stylesheet `!important` that wins the cascade is written onto the element's `style` with `!important`. The flag used to decide the winner and then disappear, so a later important rule could override the inlined value. An author's own important inline style is kept the same way.
