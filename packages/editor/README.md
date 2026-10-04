# @samva/editor

An embeddable template editor for Git-backed email template projects. The canonical value is
the TSX entry, editable when the host grants source access. The host compiles that entry to IR
and hands the editor one rendered fixture per channel, so the workspace shows the message a
recipient receives.

## Entry points

| Subpath                     | What it is                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `@samva/editor/host`        | The host an embedder implements (`AsyncEditorHost`), with the contract's types and errors |
| `@samva/editor/host/effect` | The host for an Effect codebase (`EditorHost`), and `toAsyncHost`, which adapts it        |
| `@samva/editor/shell`       | `EditorProvider`, `EditorShell`, contributions, icons (`EditorGlyph`), and `LockedAction` |
| `@samva/editor/channels`    | SMS/WhatsApp form reads and exact source edits over the authored TSX                      |
| `@samva/editor/mock`        | An in-memory host + sample document for the harness and tests                             |
| `@samva/editor/styles.css`  | The chrome's editor-specific tokens + component CSS (see below)                           |

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
import "@samva/editor/styles.css";
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

Persisted publish/version/restore behavior is an optional `lifecycle`
capability. It is deliberately separate from the editor's local undo/redo
history, which represents unsaved interaction history rather than stored
template versions.

## Styling & tokens

The shell is authored in Tailwind v4 against a set of base design token names
(`--color-background`, `--color-muted`, `--color-border`, `--color-primary`,
`--color-surface-*`, `--color-placeholder`, `--color-status-*`, `--shadow-*`). The
host owns `@import "tailwindcss"` and defines those base tokens, so the package
deliberately does **not** ship them — importing the package must never fight the
host theme. `@samva/vite`'s embedded editor (`packages/vite/editor/src/styles.css`)
is a complete example of a host theme.

`@samva/editor/styles.css` ships only the editor's own additions:

- the **editor-specific tokens** — `--accent-email` and the selection tints
  (`--sel-soft`, `--sel-mid`) — registered in `@theme` and defined for light +
  `.dark`; variable chips use the host's semantic `accent-teal` and `foreground`
  palette instead of maintaining a parallel color pair;
- the **control materials** — `--editor-raised-*` (the primary action), `--editor-chip-*`
  (a switcher's selected option), `--editor-pressed-*` (a toggle that is on) and
  `--editor-well-*` (the source panel), defined on `.samva-editor-shell` with light and `.dark`
  values. A host restyles a material by setting its variables on `.samva-editor-shell`;
- the **chrome component CSS** — the workspace grid backdrop, scoped scrollbars, and
  the agent-pulse animation, all under a `samva-editor-*` prefix.

The host imports it once, after its own Tailwind import. The standalone dev harness
stands in a neutral base theme itself (`dev/styles.css`) so `bun run dev` renders
fully; production hosts never load that file.

## Host integration

The stylesheet is not a plain CSS file — its `@theme` block only compiles when
Tailwind processes it as part of the host's own Tailwind graph. So a host MUST wire
it into its Tailwind **root** CSS, not import it from a component:

```css
@import "tailwindcss";
/* …the host's own base tokens… */
@import "@samva/editor/styles.css";
```

One import covers both concerns. The `@import` (resolved through the package exports, after
`@import "tailwindcss"`) registers the `@theme` block **and** the package-owned `@source`
glob so chrome utilities (`bg-accent-email`, `sel-*`, `chip-*`, `samva-editor-*`) generate —
hosts do not hand-write content paths into `node_modules`.

Failure mode: importing `@samva/editor/styles.css` from a React component makes Vite
process it standalone, so its `@theme` never compiles into the host's Tailwind and
every editor-token utility silently renders as a no-op (transparent). `dev/styles.css`
is the reference implementation of the correct wiring.
