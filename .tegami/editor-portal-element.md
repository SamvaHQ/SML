---
packages:
  npm:@samva/editor:
    type: minor
---

## `useEditorPortalContainer` returns the portal element

`useEditorPortalContainer()` returns the mounted portal element (`HTMLDivElement | null`) instead of a ref. `null` means the shell is up and the element is not yet; `undefined` still means there is no shell, and popups use `document.body`. Pass the element to a Base UI portal `container`. Reading `.current` on the return value no longer typechecks.

Base UI 1.9 reads a ref's `.current` from `useLayoutEffect` before React attaches a later sibling's ref, so a ref that is still empty sends every popup to `document.body` and does not try again. The shell still paints the portal root after the frame.
