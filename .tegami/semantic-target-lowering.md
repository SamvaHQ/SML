---
packages:
  group:authoring:
    type: minor
---

## Render email templates as web pages

**Breaking:** replace `render(template, input, { channel })` with
`render(template, input, { target })`. Use `target: "email"`, `"sms"`, or `"whatsapp"` for message
delivery, and `target: "web"` for the semantic HTML body and head hints of an email template.
Recompile stored templates to compiled document version `sml: 2` before rendering them with this
version. Compilation digests change with this document format.

Email and web share the template's components, bindings, conditions, loops, and source positions.
Email preserves the existing rendered HTML, subject, preheader, and text byte for byte, including
Outlook fallbacks. The web target emits semantic HTML with styles supplied separately to the page
shell. `templateEmailDegradations` locates component fidelity declarations in source, and
`checkCompatibility` reports content losses alongside client HTML findings.
