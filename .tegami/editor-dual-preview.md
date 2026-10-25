---
packages:
  npm:@samva/editor:
    type: minor
---

## Preview the web page beside the email, and edit Markdown text on the page

A host that offers `render(entry, fixture, target)` shows an Email | Web toggle in the preview bar. The web page is selected the same way as the email: a click resolves `data-samva-instance` to the authored element, and the selection stays on the same element when you switch between the two. A host that does not offer `render` is unchanged, and `EmailRender` gains an optional `kind` so a render can be told apart from a `PageRender`.

Double-click text that was written in Markdown to edit it in place on the web page. Enter saves the text into the Markdown file through the host's project `lifecycle`, and Escape puts the text back. Text that holds inline markup, and text written in TSX, is not edited in place.

The Checks tab opens with "Email differences", which lists the components that look simpler in email than on the web, how many places each appears, and a Show action that selects the first one in the email. On the web page, the preview bar counts them.
