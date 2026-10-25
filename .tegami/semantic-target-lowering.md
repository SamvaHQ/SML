---
packages:
  group:authoring:
    type: minor
---

## Preserve semantic components in compiled templates

**Breaking:** recompile stored templates to compiled document version `sml: 2` before rendering
them with this version. The compiled document retains components, block and inline content,
bindings, conditions, loops, and source positions. Compilation digests change with this document
format.

Email lowering preserves the existing rendered HTML, subject, preheader, and text byte for byte,
including Outlook fallbacks and preview source selections.
