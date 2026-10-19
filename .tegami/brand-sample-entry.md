---
packages:
  npm:@samva/markup:
    type: minor
---

## Render a brand sample in the browser

`@samva/markup/brand-sample` exports `renderBrandSample` without caniemail, whose glob dependency
reads Node's `process` when it loads. Import it to preview a brand in a browser; `./compiler`
still exports `renderBrandSample` for Node, Bun and Workers.
