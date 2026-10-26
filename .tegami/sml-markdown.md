---
packages:
  group:authoring:
    type: minor
---

## Author newsletter issues in SML Markdown

Parse `issues/*.md` with typed YAML frontmatter and static SML component tags through
`@samva/markup/markdown`. Unknown components, raw HTML, expressions, and invalid metadata return
located diagnostics. Prose and component attributes retain exact editable source spans. Prose
edits preserve ordinary punctuation and protect only syntax-sensitive delimiters and whitespace.

Compile each issue into an email-only TSX layout containing one `<IssueContent />` from
`@samva/markup/email`, then render the shared document to email or web. Vite discovers issues
separately from template entries and includes them in project build, render, and export workflows.
Existing template email output and golden digests are unchanged.
