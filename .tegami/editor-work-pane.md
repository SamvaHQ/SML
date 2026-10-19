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

Above the email, the preview bar holds the version picker (search the saved versions; restoring
an older one asks first), the desktop and phone widths, the fixture picker (moved from the
toolbar), the size of the email, open in a new tab, and refresh, with a thin progress line while
a new preview is on its way. The canvas zooms from 50% to 200% or fits its pane, from the
floating control, a trackpad pinch, or ⌘/Ctrl with +, − and 0, without zooming the page.

Hosts can report the size of the email as sent on `EmailRender.sentBytes`; the size readout and
the Gmail clipping check use it, and otherwise say they measure the preview. `EditorShell` takes
`previewBusy` to show the progress line while the host works, and `onOpenPreview` to offer open
in a new tab.

The editor's tabs, switches, buttons, menus, popovers and tooltips now use the dashboard design
system's recipes and tokens.
