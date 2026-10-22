---
packages:
  npm:@samva/editor:
    type: minor
---

## The brand chip is one menu, and the top and status bars read cleanly

The brand chip opens a menu of the organization's brands. Choosing one rewrites the theme's brand
import, and every `samva:brand` component import in the project's scripts, and saves a version; a project with no brand offers "Use {default}", and "Manage brands"
links to the host's page. `EditorBrandSource.brandLink(slug)` is replaced by an optional
`manageLink()`, and `EditorBrand` takes an optional `color` for the chip's swatch. The status bar
splits checks by severity ("3 warnings · 22 tips", errors in the error tone) and reads "Draft ·
saved 2 min ago" from the draft's last save. The Assistant header, the work pane's tab row and the
preview bar share one height and divider. `@samva/editor/shell` exports `editorChipClass` and
`editorChipTriggerClass` so a host's control beside the document name, such as an email switcher,
matches the editor's chips.
