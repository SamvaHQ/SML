---
packages:
  npm:@samva/markup:
    type: minor
---

Add static IssueTitle and IssueDate directives for issue layouts in email and web output. IssueDate reads an optional validated YYYY-MM-DD frontmatter date and formats it at compile time using fmt.date conventions (medium, en-US, UTC), with literal style and locale overrides. Missing dates render nothing. Issue directives are refused outside issue layouts and inside loops or conditions. Published email output for existing templates is unchanged.
