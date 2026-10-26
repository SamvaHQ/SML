# @samva/editor

An embeddable template editor for Git-backed email template projects. The canonical value is
the TSX entry, editable when the host grants source access. The host compiles that entry to a compiled template
and hands the editor one rendered fixture per channel, so the workspace shows the message a
recipient receives.

## Entry points

| Subpath                     | What it is                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@samva/editor/host`        | The host an embedder implements (`AsyncEditorHost`), with the contract's types and errors                        |
| `@samva/editor/host/effect` | The host for an Effect codebase (`EditorHost`), and `toAsyncHost`, which adapts it                               |
| `@samva/editor/shell`       | `EditorProvider`, `EditorShell`, contributions, icons (`EditorGlyph`), `LockedAction`, and `EditorToolbarButton` |
| `@samva/editor/channels`    | SMS/WhatsApp form reads and exact source edits over the authored TSX                                             |
| `@samva/editor/mock`        | An in-memory host + sample document for the harness and tests                                                    |
| `@samva/editor/styles.css`  | The chrome's editor-specific tokens + component CSS (see below)                                                  |
| `@samva/editor/base.css`    | Optional neutral light/dark base tokens for hosts without their own theme                                        |

## Writing a host

A host is plain promises and callbacks. `document.open` subscribes to changes before it returns
the snapshot, `writer.save` resolves the new revision or rejects with `DocumentConflict`, and
every other capability (`fixtures`, `assets`, `lifecycle`) is optional. `dev/promise-host.ts`
is a complete one in under a hundred lines. A host already built on Effect implements
`EditorHost` from `@samva/editor/host/effect` and passes `toAsyncHost(host)`.

`effect` is a peer dependency, so the editor and the host share one copy. `@samva/editor/host` is
the stable contract: plain promises that do not change with Effect. `@samva/editor/host/effect`
speaks Effect's own types, so it follows Effect's major versions.

## Using the shell

```tsx
import { EditorProvider, EditorShell, LockedAction } from "@samva/editor/shell";

<EditorProvider host={host} checks={checks} icons={{ eye: MyEyeIcon }}>
  <EditorShell
    contributions={[
      { slot: "frame.start", id: "nav", render: () => <AppNav /> },
      {
        slot: "rail.assistant",
        id: "assistant",
        render: (controls) => <Assistant {...controls} />,
      },
      {
        slot: "toolbar.actions",
        id: "send",
        render: () => <LockedAction label="Send" title="Send" upsell={sendUpsell} />,
      },
    ]}
  />
</EditorProvider>;
```

A contribution names the region it lands in: `frame.start`, `toolbar.leading`,
`toolbar.actions`, `document.switcher`, `rail.assistant`, `rail.review`, `canvas.overlay` or
`statusbar.headline`. The editor owns each region's layout. A region that holds one thing
refuses a second contribution, and an id used twice fails, so a host bug is loud.

A `toolbar.actions` button should be an `EditorToolbarButton` so it matches the top bar's own
buttons: it takes an `icon`, a `label` and the usual button props (`onClick`, `disabled`,
`data-testid`), draws a ghost button at Preview's height, radius, type and icon size, and folds to
the icon with the label as its tooltip and accessible name exactly when the top bar folds its own
labels (every frame narrower than 1280px). It forwards its ref and props, so a Base UI `render`
target such as a popover trigger can use it:

```tsx
import { EditorToolbarButton } from "@samva/editor/shell";

<PopoverTrigger render={<EditorToolbarButton icon={<ClockIcon />} label="History" />} />;
```

### Layout

A `rail.assistant` contribution puts the host's chat beside one **work pane**. The work pane's
tab bar always has Preview; the author adds Source, Design (layers beside the inspector),
Review (the `rail.review` content, offered only when the host contributes one) and Checks from
its "+" menu and closes them again. The open tabs, the shown tab, the chat width and whether the
chat is collapsed persist per browser like the other layout preferences. From 1280px of editor
frame width the chat and the work pane sit side by side with a draggable divider (280–640px,
dragging below 140px collapses the chat); below it a Chat | Preview switch shows one at a time,
starting on the chat unless `EditorProvider`'s `initialPane` is `"preview"` (for a host whose own
app is the conversation), and Preview carries a dot when the host changed the email while the
chat was shown. The host's
assistant stays mounted across those changes. Without an assistant the shell keeps layers,
canvas and inspector around a Visual | Source switch.

Above the canvas, the preview bar holds the version picker (with the `lifecycle` capability; an
older version is restored only after the author confirms), the desktop/phone width, the fixture
picker, the size readout, open in a new tab and refresh. The canvas zooms from 50% to 200% or
fits its pane, by its floating control, a pinch, or ⌘/Ctrl with +, − and 0.

### Design mode and pins

The preview bar's **Design** switch makes a click on the email select it for editing: a toolbar
on the element steps out to its container, moves, duplicates or deletes it, and beside a docked
assistant the element's properties sit next to the email. Every edit from the toolbar, the
properties or the fixture data is **staged**: it is written to the draft the host renders, so the
preview shows it, but it is not a version. A dock under the email counts the staged edits and
offers undo, redo, reset (after a confirm, back to the draft before the first edit), a locked
compare with the preview from before the edits, and **Apply**, which saves them as one version
through the `versions` capability, named "Design: N edits" (without `versions` Apply keeps the
draft as it is). Leaving Design waits until the edits are applied or reset, and Design and Apply
wait while `previewBusy` reports an assistant turn, so the two never edit the email at once.
Source is read-only while edits are staged, so undo and reset walk one history in order. The top bar's Undo and Redo and the dock's act on the same history: the staged edits first, then the source history. An
element written in a partial is saved through `lifecycle` immediately, because other templates
share it.

The Design tab and the properties beside the email speak the author's language. Layers list
the blocks and elements the template wrote, by component name (`Section`, `Button`) or a plain
word (`Heading`, `Text`, `Image`), and leave out the tables and cells the compiler renders them
into; the compiler's authored marks decide which is which. The properties edit the selected
element's text (data bindings stay chips), image description and size, component settings,
colors from the theme's tokens (a custom hex sits behind a disclosure), type size from the
template's own scale and weight, alignment, and padding or spacing. Each change is a class or
prop edit, staged like the toolbar's. **Advanced** keeps the raw props and classes and the
block edits, and the Source tab keeps the whole template.

Beside a docked assistant the **Pin** switch makes a click drop a numbered pin on an element. A
tray under the email lists the pins with a note each, removes one (the rest renumber) and clears
all after a confirm.

`EditorShell` takes two preview signals from the host:

- `previewBusy` — the host is producing a change the author will see (an assistant turn at
  work). The preview bar runs a thin progress line while it is true, as it does for the editor's
  own waits.
- `onOpenPreview` — opens the current preview in a new browser tab; omit it where the host has
  no page for that.

A host that knows the size of the email as sent reports it on each render as
`EmailRender.sentBytes`. The size readout and the Gmail clipping check then measure the sent
email; without it they measure the preview and say so.

### Composing the chrome

`EditorShell` is a thin assembly of parts, and a host can assemble them itself. `EditorRoot`
takes every `EditorShellProps` prop, measures the frame, provides what the parts read, and
renders its children in order:

```tsx
import {
  EditorProvider,
  EditorRoot,
  EditorStatusBar,
  EditorTopBar,
  EditorWorkspace,
} from "@samva/editor/shell";

<EditorProvider host={host}>
  <EditorRoot contributions={contributions} className="rounded-xl border">
    <EditorTopBar className={(state) => (state.layout === "narrow" ? "px-2" : "px-4")} />
    <EditorWorkspace />
    <EditorStatusBar render={<footer className="bg-muted/40" />} />
  </EditorRoot>
</EditorProvider>;
```

Every part follows Base UI's and shadcn's conventions:

- it renders one element with a `data-slot`, and its sub-parts carry their own;
- `className` merges with the part's classes through tailwind-merge, so a host utility wins,
  and it may be a function of the part's state;
- the state is also on the element as data attributes (`data-layout="narrow"`, a bare
  `data-busy` while true), for Tailwind `data-[…]:` variants;
- `render` swaps the element for the host's while keeping the part's props and behaviour.

| Part (export)            | `data-slot`                 | State attributes                                                                               | Sub-part slots                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorRoot`             | `editor`                    | `data-layout`, `data-docked`, `data-busy`                                                      |                                                                                                                                                                                                                                                           |
| `EditorTopBar`           | `editor-top-bar`            | `data-layout`                                                                                  | `editor-top-bar-title`, `editor-top-bar-name`, `editor-top-bar-actions`                                                                                                                                                                                   |
| `EditorWorkspace`        | `editor-workspace`          | `data-layout`                                                                                  | `editor-workspace-view` (Visual \| Source, standalone)                                                                                                                                                                                                    |
| `EditorAssistantDock`    | `editor-assistant-dock`     | `data-focused`, `data-hidden`                                                                  | `editor-assistant-dock-header`, `editor-assistant-dock-body`                                                                                                                                                                                              |
| `EditorDivider`          | `editor-divider`            | `data-side`, `data-dragging`                                                                   |                                                                                                                                                                                                                                                           |
| `EditorPaneSwitch`       | `editor-pane-switch`        | `data-pane`, `data-unseen`                                                                     |                                                                                                                                                                                                                                                           |
| `EditorWorkPane`         | `editor-work-pane`          | `data-tab`, `data-split`                                                                       | `editor-work-pane-header`, `editor-work-pane-tabs`, `editor-work-pane-tab` (`data-active`), `editor-work-pane-tab-group`, `editor-work-pane-tab-close`, `editor-work-pane-add`, `editor-work-pane-panel`                                                  |
| `EditorCanvas`           | `editor-canvas`             | `data-zoom`, `data-device`, `data-target` (`email`, `web`)                                     | `editor-envelope`, `editor-preview-notice`                                                                                                                                                                                                                |
| `EditorPreviewBar`       | `editor-preview-bar`        | `data-busy`                                                                                    | `editor-version-picker`, `editor-fixture-select`, `editor-preview-bar-center`, `editor-preview-bar-size`, `editor-preview-bar-progress`, `editor-preview-bar-target` (Email \| Web, when the host renders the web page), `editor-preview-bar-differences` |
| `EditorZoomControl`      | `editor-zoom-control`       | `data-fit`, `data-percent`                                                                     |                                                                                                                                                                                                                                                           |
| `EditorCanvasModeSwitch` | `editor-canvas-mode-switch` | `data-mode` (`point`, `design`, `pin`), `data-pending`, `data-locked`                          |                                                                                                                                                                                                                                                           |
| `EditorDesignDock`       | `editor-design-dock`        | `data-pending`, `data-apply` (`idle`, `applying`, `failed`), `data-compare`, `data-confirming` | `editor-design-dock-bar`, `editor-design-dock-status`, `editor-design-dock-confirm`, `editor-design-dock-error`                                                                                                                                           |
| `EditorPinTray`          | `editor-pin-tray`           | `data-count`, `data-open`, `data-confirming`, `data-pinning`                                   | `editor-pin-tray-list`, `editor-pin-tray-row`                                                                                                                                                                                                             |
| `EditorStatusBar`        | `editor-status-bar`         | `data-layout`, `data-save`                                                                     | `editor-status-bar-start`, `editor-status-bar-end`                                                                                                                                                                                                        |

In Design the canvas shows `editor-design-properties` beside the email. Inside the inspector,
`editor-element-inspector`, `editor-design-properties-controls`, `editor-design-group`,
`editor-design-field` and `editor-design-swatches` mark the controls, and each row of the layers
is an `editor-layer` with `data-selected`. The toolbar on the
selected element is drawn inside the email's frame, so it is styled by the frame's own sheet
(`--editor-canvas-toolbar-bg` and `-fg`) rather than by Tailwind; it carries
`data-testid="design-toolbar"`. The Design and Checks tabs render `editor-design-panel` (with `editor-layers`) and
`editor-checks-panel`, which opens with `editor-email-differences` (`data-count`, one
`editor-email-differences-row` per component) when the host renders the web page. Inside the parts, controls are the shadcn components, so they also carry
shadcn's own slots (`button`, `tabs-trigger`, `toggle-group-item`, `dropdown-menu-content`,
`popover-content`, `tooltip-content`, `alert-dialog-content`, `native-select`, `badge`, `kbd`).
A host targets any of them with Tailwind's arbitrary variants, for example
`**:data-[slot=editor-work-pane-tab]:rounded-full`.

`icons` replaces any of the editor's icons by name (`EditorIconName`); the rest keep the
defaults, the Hugeicons free set (Stroke Rounded, MIT). `<EditorGlyph name="moon" />` draws one
of those glyphs in host chrome beside the editor, so a host's own navigation follows the same
set. Publish, persisted history, and restore appear when the host supplies the optional
`lifecycle` capability, and Save version when it supplies `versions`; a draft can be saved where
nothing is published. The editor reports what a person does (`preview`, `export`) through the
host's `telemetry`. None of these are shell callbacks.

The shell dispatches directly on the host document's `channel`. Email mounts the
host's rendered HTML in a same-origin iframe. SMS and WhatsApp read their forms from the
authored TSX (`@samva/markup/edit`) and preview the host's render; a form change is an
exact source replacement saved like any other edit. Expressions, conditionals and elements
inside a body are locked segments, so a form edit cannot rewrite them, and an edit that would
leave the static profile is refused with its reason.

## Preparing preview documents

`EditorProvider` accepts `preparePreviewDocument?: (html: string) => PreparedPreviewDocument`.
Both the editing canvas and Preview call it before writing to the attached iframe. Only the
returned `html` reaches that parser. Canvas passes the original host HTML; Preview applies its
forced light/dark scheme before calling preparation.

```tsx
import { EditorProvider, EditorShell, type PreparedPreviewDocument } from "@samva/editor/shell";

const preparePreviewDocument = (html: string): PreparedPreviewDocument => ({
  html,
  mount(document) {
    const style = document.createElement("style");
    style.textContent = "body { min-height: 200px; }";
    document.head.appendChild(style);
    return () => style.remove();
  },
});

<EditorProvider host={host} preparePreviewDocument={preparePreviewDocument}>
  <EditorShell />
</EditorProvider>;
```

Preparation must be pure and synchronous: React can repeat or discard it during render.
Install document resources in `mount`, which runs synchronously after `document.close()` and
before measurement, canvas overlays, or paint. Its returned cleanup belongs to that exact
document and runs on replacement, unmount, and StrictMode effect replay. Mount and cleanup must
support that replay. Asynchronous resource work remains the host's responsibility; the editor
does not wait for it before measuring or painting.

Keep the preparation callback stable while its policy stays the same. Changing its identity
replaces the frames and their resources without resetting the editor session. Without the prop,
the editor writes the host HTML as supplied (with Preview's existing scheme simulation).
Preparation affects iframe previews only; exported HTML and the HTML view retain host output.

## Host contract

Every host provides a scoped `DocumentReader`. Editable hosts additionally
provide a `DocumentWriter`; read-only hosts have no writer at the type level.
The document is a union over two independent concerns:

- `channel`: `email`, `sms` or `whatsapp`;
- `access`: editable or read-only, including the reason shown by the chrome.

Every document carries `origin.authoredSource`, the canonical TSX entry, and that
is the only thing a save writes. Every document additionally carries what the
host's compile produced at that revision: the fixture names the template
declares, which one is being viewed, the channel's render (`EmailRender`,
`SmsRender` or `WhatsAppRender`), and the build's diagnostics. A `render` of
`null` means the entry did not build, which the editor shows rather than reports.
The editor reads SMS and WhatsApp forms from the authored TSX and never compiles.

Selection in the email lane is read-only and resolves against one render: the
rendered HTML stamps `data-samva-instance` on every element, and a selection is
pinned to the revision and fixture it was taken in. Switching fixtures is a
`fixtures` host capability — a re-render of the same revision, never a document
mutation.

`EditorProvider` accepts `onSelectElement`, called when the user selects an element through the
canvas or outline. Its `UserSelection` value, exported from `@samva/editor/shell`, contains
`instancePath`, `revision` and `fixture`, pinned to the render the user selected. Automatic
selection rebinding after a document change does not call it. Replacing the callback keeps the
same document session when `host` stays stable.

```tsx
import { EditorProvider, EditorShell, type UserSelection } from "@samva/editor/shell";

const selectElement = (selection: UserSelection) => {
  hostSelection(selection.instancePath, selection.revision, selection.fixture);
};

<EditorProvider host={host} onSelectElement={selectElement}>
  <EditorShell />
</EditorProvider>;
```

Pins reach the host two ways. `EditorProvider`'s `onPinsChange` is called with every pin, in
tray order, whenever one is dropped, noted, removed or cleared. The `rail.assistant` contribution
reads the same list as `workspace.pins` and gets `removePin` and `clearPins` in its controls, so a
chat can attach the pins to the next message and clear them once it is sent. An `EditorPin`
(exported from `@samva/editor/shell`) names one rendered instance the way a selection does:

| Field                                 | Meaning                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `id`                                  | Stable for the pin's lifetime                            |
| `number`                              | Its 1-based place in the tray, drawn on the email        |
| `instancePath`, `revision`, `fixture` | The rendered element and the render it was pinned in     |
| `tag`, `label`                        | The rendered tag and the label on its chip (`td 2 of 3`) |
| `origin`                              | Where the template wrote the element, or null            |
| `note`                                | The author's note, empty until written                   |

The assistant's `workspace.design` reads `{ on, pending, applying, waiting }`. A host's chat must
not send while `waiting` is true: edits are staged, Apply is saving them, or an undo or reset has
not reached the host yet. A turn would otherwise build on edits the author has not kept, and a
version it saved would carry them. `versions.save(revision, { message })` receives the name of the version the
editor asks for; a host without a use for it names the version itself.

Persisted publish/version/restore behavior is an optional `lifecycle`
capability. It is deliberately separate from the editor's local undo/redo
history, which represents unsaved interaction history rather than stored
template versions.

## Styling & tokens

The shell is authored in Tailwind v4 against a set of base design token names
(`--color-background`, `--color-muted`, `--color-border`, `--color-primary`,
`--color-surface-*`, `--color-placeholder`, `--color-status-*`, `--shadow-*`). The
host owns `@import "tailwindcss"` and either defines those base tokens or imports the optional
`@samva/editor/base.css` neutral light/dark theme. Hosts with their own tokens omit that
stylesheet. `@samva/vite`'s embedded editor (`packages/vite/editor/src/styles.css`) is a complete
example of a host theme.

`@samva/editor/styles.css` ships only the editor's own additions:

- the **editor-specific tokens** — `--accent-email` and the selection tints
  (`--sel-soft`, `--sel-mid`) — registered in `@theme` and defined for light +
  `.dark`; variable chips use the host's semantic `accent-teal` and `foreground`
  palette instead of maintaining a parallel color pair;
- `--editor-well-*`, the source panel's recessed field, defined on `.samva-editor-shell` with
  light and `.dark` values;
- the **chrome component CSS** — the workspace grid backdrop, scoped scrollbars, the preview
  progress line, and the invisible 44px hit area a phone-width editor gives its own controls
  (`[data-editor-control]`), all under a `samva-editor-*` prefix.

The chrome is styled with Tailwind utilities on shadcn's token names (`background`,
`foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`,
`border`, `input`, `ring` and `--radius`). Its buttons, tabs, toggle groups, selects, menus,
popovers, tooltips, dialogs, inputs, badges and kbd are shadcn's Base UI components with the
`base-nova` style's classes (`src/ui`), so a host on shadcn — Samva's dashboard is one — draws
the editor in its own theme when its Tailwind compiles the editor's classes. Popups animate with
shadcn's `tw-animate-css` utilities; a host that does not load `tw-animate-css` gets popups that
appear without the animation.

The host imports it once, after its own Tailwind import and base tokens. The standalone dev
harness (`dev/styles.css`) imports the packaged neutral base theme so `bun run dev` renders fully.

## Host integration

The stylesheets contain `@theme` blocks that compile as part of the host's Tailwind graph. Wire
them into the Tailwind **root** CSS, not a React component. A host using the neutral theme imports:

```css
@import "tailwindcss";
@import "@samva/editor/base.css";
@import "@samva/editor/styles.css";
```

A host with its own base tokens imports:

```css
@import "tailwindcss";
/* …the host's own base tokens… */
@import "@samva/editor/styles.css";
```

The editor stylesheet import covers both concerns (and a shadcn host that already has
`@import "tw-animate-css";` gets the popup animations). The `@import` (resolved through the package exports, after
`@import "tailwindcss"`) registers the `@theme` block **and** the package-owned `@source`
glob so chrome utilities (`bg-accent-email`, `sel-*`, `chip-*`, `samva-editor-*`) generate —
hosts do not hand-write content paths into `node_modules`.

Failure mode: importing `@samva/editor/styles.css` from a React component makes Vite
process it standalone, so its `@theme` never compiles into the host's Tailwind and
every editor-token utility silently renders as a no-op (transparent). `dev/styles.css`
is the reference implementation of the correct wiring.
