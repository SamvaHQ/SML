---
packages:
  npm:@samva/editor:
    type: patch
---

## The status bar says what is left to check

The status bar's checks summary reads "24 checks to review" when client verification remains and
"No issues found" when nothing does, instead of "No known risks · 24 need verification". In an email
workspace with a docked assistant, clicking it opens the Checks tab; other layouts keep the popover.
