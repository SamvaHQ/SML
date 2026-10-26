---
packages:
  npm:@samva/editor:
    type: minor
---

## Open Markdown issues in Source

Email documents accept a `markdown` origin with the complete issue source, including frontmatter,
and `layout: { file }` identifying the host-owned TSX layout. The Source tab edits the issue through
the existing revision-fenced writer. Prose edits from either preview update the same source and
participate in undo/redo without requiring a project lifecycle capability. Layout spans are
read-only, and TSX-only structural, expression, fixture-data and class-name edits are hidden.

The host contract version is now `2026-10-26.1`: hosts must handle the email origin union and
write `origin.file` for source saves. SMS and WhatsApp remain TSX-only. The TSX editing behavior
and compiled email output are unchanged.
