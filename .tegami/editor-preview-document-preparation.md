---
packages:
  npm:@samva/editor:
    type: minor
---

## Hosts can prepare preview documents before parsing

`EditorProvider` accepts `preparePreviewDocument`, and `@samva/editor/shell` exports
`PreparedPreviewDocument`. Canvas and Preview write the prepared HTML, then mount host resources
before measurement and paint. Resources are cleaned up for their exact document on replacement,
unmount, and StrictMode replay. Replacing the preparation callback replaces the preview frames.
