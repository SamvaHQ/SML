---
packages:
  npm:@samva/editor:
    type: patch
---

## The editor's chrome stays put while a document opens

The preview bar, the brand chip and the docked pane switch now draw from the first paint instead
of appearing when the document arrives, so the canvas and the top bar controls no longer move
when a slow host finishes opening the document. The brand chip shows a "Brand" placeholder while
the theme loads.
