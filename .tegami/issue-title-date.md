---
packages:
  npm:@samva/markup:
    type: minor
---

## Render an issue's title and date in its layout

Issue layouts can place the issue's title and date with the static `IssueTitle` and `IssueDate` directives from `@samva/markup/email`, in email and web output:

```tsx
<h1><IssueTitle /></h1>
<p><IssueDate /></p>
<IssueContent />
```

`IssueDate` reads an optional `date: YYYY-MM-DD` frontmatter field and formats it at compile time like `fmt.date` (medium, en-US, UTC); literal `style` and `locale` props override that. A missing date renders nothing. Both directives are refused outside issue layouts and inside loops or conditions. Output for existing templates is unchanged.
