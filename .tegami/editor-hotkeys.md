---
packages:
  npm:@samva/editor:
    type: minor
---

## Bind the editor's keyboard shortcuts through react-hotkeys-hook

Save version (⌘S / Ctrl+S), canvas zoom (⌘ / Ctrl with +, − or 0, on the main row or the keypad, including inside the email) and Escape to close an overlay panel are bound with `react-hotkeys-hook`, now a dependency of `@samva/editor`. Keys match the physical key, and the zoom and save chords use ⌘ on macOS and Ctrl elsewhere, so Ctrl no longer zooms or saves on macOS.
