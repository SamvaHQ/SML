---
packages:
  npm:@samva/editor:
    type: minor
  npm:@samva/markup:
    type: minor
---

## Design mode and pins

The preview bar has a **Design** switch. In Design, a click on the email selects it with a
toolbar that steps out to its container, moves, duplicates or deletes it, and beside a docked
assistant the element's properties sit next to the email. Edits from the toolbar, the properties
and the fixture data are staged instead of saved one field at a time: the preview shows them, a
dock counts them, and undo, redo, reset (after a confirm) and a locked before-and-after compare
work over them. **Apply** saves them as one version named "Design: N edits". Leaving Design waits
for the edits to be applied or reset, and Design waits while an assistant turn is running.

The Design tab speaks the author's language. Layers name the blocks and elements the template
wrote (`Section`, `Button`, `Heading`, `Text`, `Image`) and leave out the compiler's tables and
cells; a loop's copies are one layer. The inspector names the element and the blocks around it,
with no internal paths, and edits it with plain controls: text with data bindings shown as chips,
image description and size, component settings, theme colors as named swatches, type size and
weight, alignment, and spacing. Each change is staged like any Design edit. The raw props and
classes are under **Advanced**, and the whole template is in Source.

Beside a docked assistant, the **Pin** switch drops numbered pins on parts of the email. A tray
lists them with a note each, removes one at a time, and clears all after a confirm.

For hosts:

- `EditorProvider` takes `onPinsChange`, called with every `EditorPin` in tray order whenever the
  pins change. The `rail.assistant` contribution reads `workspace.pins` and gets `removePin` and
  `clearPins`, so a chat can attach pins to its next message and clear them once sent.
- `workspace.design` reports `{ on, pending, applying, waiting }`. Hold the chat while `waiting`
  is true.
- `versions.save(revision, options)` receives `options.message`, the name the editor asks for.
  The parameter is optional, so an existing host keeps working and names versions itself.

## A warning for hotlinked images

`email-external-asset` warns when an email's image points at an absolute URL outside the project's
asset base. A hotlinked image can disappear, be blocked, track recipients or slow the message; the
fix is to add the image to the project and import it. It is a warning, so every template that
compiled before still compiles, and compiled output is unchanged: the email parity digests do not
move.
