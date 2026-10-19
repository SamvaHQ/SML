---
packages:
  npm:@samva/editor:
    type: minor
---

## A tabbed work pane beside the assistant

With a docked assistant, the editor shows the chat beside one work pane instead of a third
Design column. Preview is always open; Source, Design (layers beside the inspector), Review and
Checks open from the pane's "+" menu, close from a × that appears on hover or focus (always on
touch screens), and stay open the next time the editor loads. Collapse the chat to give the work
pane the full width, or drag the divider: the chat keeps between 280px and 640px and collapses
when dragged narrower than 140px, by mouse, touch or keyboard.

Below 1280px of editor width the two panes become a Chat | Preview switch, with a dot on Preview
when the email changed while you were in the chat. Every view stays reachable down to a phone,
where the editor's own controls take 44px touch targets.

## A preview bar and real zoom

Above the email, the preview bar holds the version picker (search the saved versions; restoring an
older one asks first), the desktop and phone widths, the fixture picker (moved from the toolbar for
email; SMS and WhatsApp keep it there), the size of the email, open in a new tab, and refresh, with
a thin progress line while a new preview is on its way. The canvas zooms from 50% to 200% or fits
its pane, from the floating control, a trackpad pinch, or ⌘/Ctrl with +, − and 0, without zooming
the page.

Hosts can report the size of the email as sent on `EmailRender.sentBytes`; the size readout and
the Gmail clipping check use it, and otherwise say they measure the preview. `EditorShell` takes
`previewBusy` to show the progress line while the host works, and `onOpenPreview` to offer open
in a new tab.

## Chrome built from shadcn parts

The editor's controls are shadcn's Base UI components (`base-nova` classes) styled with Tailwind on
shadcn's token names, so a shadcn host draws the editor in its own theme. `EditorShell` is now a
thin assembly of exported parts — `EditorRoot`, `EditorTopBar`, `EditorWorkspace`,
`EditorStatusBar`, `EditorAssistantDock`, `EditorDivider`, `EditorPaneSwitch`, `EditorWorkPane`,
`EditorCanvas`, `EditorPreviewBar`, `EditorVersionPicker`, `EditorFixtureSelect` and
`EditorZoomControl` — that a host can rearrange. Each part carries a `data-slot`, exposes its state
as data attributes, merges `className` (a string or a function of its state) with tailwind-merge,
and takes Base UI's `render` prop. The README lists every slot and state attribute.

Below 1280px the Chat | Preview switch sits in the top bar; on a phone the top bar stays one row,
the work pane's tab row steps aside while Preview is its only tab, and the editor's own controls
get an invisible 44px hit area instead of growing. The status bar lines up with the panes.

The `--editor-raised-*`, `--editor-chip-*` and `--editor-pressed-*` variables are gone; restyle the
chrome through Tailwind on shadcn's tokens or the parts' `className`. Popups animate with
`tw-animate-css` where the host loads it.
