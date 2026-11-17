---
packages:
  npm:@samva/editor:
    type: minor
  npm:@samva/vite:
    type: minor
---

## Design mode reads like the email it edits

- **Real colours.** The inspector resolves the theme through its imports (the starter stylesheet, the brand and the project's own `@theme`), so colours show their values instead of a hatched placeholder. Each colour property is one field with a swatch, a name taken from the token ("Card text") and the value, and its list groups the brand's colours, this email's overrides and the theme, then Inherited and a custom colour.
- **Data fields.** Bindings read as named fields ("Product short name") with the active fixture's sample underneath; the path is in the tooltip.
- **Type.** A Font control offers the theme's font roles by family name, and Size and Weight show what the element renders at. Size offers the full type scale.
- **Edits keep their controls.** The panel stays while an edit is written and rendered, with a spinner on the field that changed, and a just-edited element is no longer called read-only.
- **One save status.** Design edits are ordinary unsaved changes: the status bar says how many changes are not in a version yet and saves them with Save version, Discard changes moves into its menu, and the draft's autosave is a tooltip. Apply, Reset and the Design count badge are gone.
- **Nothing selected** opens on the email: the page background and fonts, the sample to preview with, and sample data and file details folded away.
- **The element toolbar** sits in the gutter beside the email when there is room, and otherwise above or below the element where it covers nothing. The breadcrumb names blocks by role.
- **The local editor** (`@samva/vite`) serves the project theme to the inspector.

### Breaking changes for hosts

- `contractVersion` is `2026-11-17.1`.
- `versions.save` and `versions.savedRevision` resolve a `SavedVersion` (`{ revision, number? }`) instead of a revision token; `number` lets the status bar say "Saved as version 13".
- A new optional `theme` capability (`tokens(): Promise<ThemeTokens>`) gives the editor the resolved theme, brand included. `themeTokensFromStylesheets` from `@samva/editor/host` builds `ThemeTokens` from project stylesheets and a brand's CSS, over the compiler's default theme; `brandSpecifier` names a brand import other than `samva:brand`. A token's `source` can be `{ kind: "default" }`, a colour or font the project leaves to the default theme.
- The assistant contract: `workspace.design` is `{ on }`, `workspace.saveVersionStatus` is replaced by `workspace.version` (`{ status, changes, number?, reason? }`), and `EditorAssistantControls.saveVersion()` saves the draft as a version before a turn. Without `versions` it writes every pending edit and rejects when the draft could not be written. Design edits no longer hold the chat.
- `workspace.pointedElement` follows a click only outside Design; in Design it is set by "Ask agent about this" and cleared on leaving Design.
