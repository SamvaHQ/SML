---
packages:
  npm:@samva/editor:
    type: minor
---

## Calmer checks, a clearer brand menu, and toolbar buttons hosts can match

The Checks panel no longer shows "Needs attention" above "No known risks found." When nothing is actionable it shows a settled "No problems found", and the note about email clients now counts "tips", the same word as the status bar.

The brand menu lists your brands by name with their swatches, under "Apply a brand" when the template has none. The organization default carries a muted "Default" tag, left off when the brand is already named Default.

The Publish sheet shows placeholder rows shaped like saved versions while they load, so the list does not jump when it arrives.

`@samva/editor/shell` exports `EditorToolbarButton`. Contribute it to `toolbar.actions` and it matches the top bar's buttons in size, radius and type, folds to its icon with a tooltip when the top bar folds its own labels, and works as a Base UI `render` target such as a popover trigger.
