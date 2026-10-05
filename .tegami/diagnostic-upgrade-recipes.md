---
packages:
  npm:@samva/markup:
    type: patch
---

## Diagnostics carry their upgrade recipe

A template diagnostic whose code marks an incompatible template format now includes `upgrade`, the
agent instructions for migrating the template, in structured results and after `Fix:` in formatted
output.
