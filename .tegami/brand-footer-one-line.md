---
packages:
  npm:@samva/markup:
    type: minor
---

## The brand footer is one line

`BrandFooter` renders the company name, social links and the unsubscribe link on one line,
separated by `·`, with the postal address on the line below. It follows a `text-left` or
`text-right` `className` instead of always centering. Sends without an unsubscribe group drop only
the unsubscribe link and its separator, and still strip the row of footers compiled before this
release.
