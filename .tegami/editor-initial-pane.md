---
packages:
  npm:@samva/editor:
    type: patch
---

## A host can open a narrow workspace on the preview

`EditorProvider` takes `initialPane`. Below 1280px a docked workspace shows one pane at a time and
starts on the chat; a host whose own app is the conversation, such as ChatGPT, passes
`initialPane="preview"` so the email is on screen first. The Chat | Preview switch works as before.
