---
packages:
  npm:@samva/markup:
    type: patch
---

## Report a client caniemail has no data for as unknown coverage

The email compatibility check no longer fails when a declaration names a feature the pinned caniemail data covers for some clients but not others, such as `word-wrap`, which has no Gmail iOS entry. That client gets a `caniemail/unknown-coverage` info finding located at the source, and every other finding for it is still reported. Compiled output is unchanged.
