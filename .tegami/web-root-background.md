---
packages:
  npm:@samva/markup:
    type: minor
---

## Let a publication shell supply the web background

Pass `rootBackground: "transparent"` to `render(template, input, { target: "web", ... })` to omit the web root's default theme background. Existing web renders retain it by default. Authored background styles and email output are unchanged.
