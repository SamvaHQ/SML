# Template editor

`@samva/editor` is an embeddable editor. Hosts provide an `AsyncEditorHost` and mount
`EditorProvider` plus `EditorShell`. Each provider owns one vanilla zustand store and its
non-rendering persistence spine. The package is built without React Compiler, so subscription
boundaries—not compiler transforms—provide render isolation.

## State invariants

- Never use a module-level store. A provider mount owns a document session. Replacing host identity
  swaps the complete bundle and intentionally discards document-local selection, history, and
  layout. Hosts must keep the host object stable while editing the same document.
- Compute projections of the document in the transition that changes it. Store the resulting
  outline, size, and checks together with the document they came from.
- The host owns render truth for every channel. The editor never compiles: it mounts the render
  the host produced from the template's IR. An SMS or WhatsApp form is read from the authored TSX,
  and a form change is an exact source replacement (`@samva/markup/edit`) applied through
  `applySourceEdit` with a `coalesceKey`, so typing does not wait on the previous save.
- An email selection is one rendered instance pinned to the revision and fixture it was taken in.
  Its origin is the span of the TSX the compiler recorded for the element, and a visual edit is a
  code transform of the static TSX at that span, saved through `DocumentWriter.save`. A selection
  the document has moved past is dropped or explicitly re-resolved, never applied to whatever now
  sits at that path.
- `EditorProvider`'s `onSelectElement` reports only the user's own selection (a canvas click or
  outline row), never the editor rebinding a selection to a newer render. A host that forwards a
  selection elsewhere treats it as a gesture and treats any other selection change as following
  the document.
- A visual edit never leaves the static profile. `applySourceReplacements` runs with a
  `ProfileGuard`, so `checkStaticProfile` compares the file before and after and refuses an edit
  that introduces an error the source did not already have; the reason reaches the author through
  `sourceEditError` or the review panel. Expression and structural changes show that refusal
  before Apply. Class names change only where they are literal (`classNameEdit`); a conditional
  `className` is refused, never overwritten.
- One authored element is one source span, however many times it renders, so an edit changes every
  rendered copy and the controls say how many. An element written in a partial (an origin outside
  the entry) is edited only when the host offers `lifecycle`: the controls read the project files
  through `inspect`, warn that every template using the partial changes, and save through
  `updateFile`. Without it they are read-only and point at Source. Local undo history covers the
  entry only.
- Subscribe to the narrowest state slices. Use `useShallow` for object or array selectors, and read
  handler-only state through `useEditorStoreApi().getState()` at event time. The `actions` object is
  stable and can be selected as one slice.
- Keep queue, revision, and generation state in the non-rendering spine. Components reach it only
  through actions such as save flushing, retry, and reload.
- Do not add zustand middleware. Persistence remains explicit and limited to the existing UI
  preferences.
- Effect Atom owns host application and server state; zustand owns editor-internal state. Do not
  cross that boundary.

## Chrome copy

Built-in chrome (canvas, rails, inspector, lifecycle) and host contributions are customer
surfaces. Label the thing, not the mechanism: say what the author has and can do next ("Unsaved
changes", "No preview yet", "Saved version"), never the machinery behind it (Git, commits,
revisions, renders, builds, internal paths, tool names). Expandable content signals itself with a
chevron, hover fill or tooltip, not a "Details" or "More" label. Numbers are measured and current,
never hard-coded. Host panels own their transport copy under the same rules.

## Verification

- Run tests with the package scripts: `bun run test` (Vitest, under this package's
  `vitest.config.ts`), not bare `bun test`, which starts Bun's own runner. The Chromium browser
  suite (`test:browser`) builds `@samva/markup` first.
- Extend `tests/context.test.tsx` for subscription/render-isolation behavior,
  `tests/facade.test.ts` for the host facade lifecycle, and `tests/contract.test.ts` for the shapes the
  host contract refuses.

Use the real `EditorProvider` with a controlled `AsyncEditorHost` in component tests; do not replace
the package boundary with a second mock state model.
