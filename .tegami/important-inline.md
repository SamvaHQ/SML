---
packages:
  npm:@samva/markup:
    type: patch
---

## An important declaration keeps `!important` when it is inlined

A stylesheet `!important` that wins the cascade is written onto the element's `style` with `!important`. The flag used to decide the winner and then disappear, so a later important rule could override the inlined value. An author's own important inline style is kept the same way.

A logical padding shorthand keeps that flag on every physical side. `padding-inline: 3px 4px !important` becomes `padding-left: 3px !important` and `padding-right: 4px !important`.

A property the generated dark-mode class restates is inlined without `!important`, including a declaration that only overlaps the color that changed. That class also uses `!important`, and an important inline style would keep the light color. A weaker rule kept in the head, such as a hover, is copied onto a more specific selector so it does not take that color; the copy inside the dark-mode query keeps the theme switch. A stronger rule is copied again after that guard. A shorthand in that copy also restates any locked longhand that still outranks it, so the shorthand does not reset a stronger inline color, and the dark-mode copy of that longhand keeps its dark value. A pseudo-element keeps the color it sets for itself.
