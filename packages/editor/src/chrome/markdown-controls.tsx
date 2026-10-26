import type { EmailElementSelection } from "@samva/markup/edit";
import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../state/context";
import { cn, focusRing } from "./ui-classes";

const inputClass = cn(
  "border-border bg-background text-foreground w-full rounded border px-2 py-1.5 text-xs",
  focusRing,
);

/**
 * The text of an element written in a Markdown issue. It is the keyboard path to the in-place
 * edit on the web preview: what is typed here saves to the issue as the author types, and what the
 * host cannot save, or text that mixes formatting with words, is said plainly instead.
 */
export function MarkdownControls({ selection }: { readonly selection: EmailElementSelection }) {
  const { inspectMarkdown, editMarkdownText } = useEditorStore((state) => state.actions);
  const error = useEditorStore((state) => state.sourceEditError);
  // The text is read when the project is free and the render it belongs to is current; a save's
  // own re-render lands while the project is still busy, so the read is retried once it clears.
  const busy = useEditorStore((state) => state.lifecycleBusy);
  const revision = useEditorStore((state) => state.render?.revision);
  const [text, setText] = useState<string | null | "loading">("loading");
  // What the author has typed that the host has not yet shown back. While it is pending the
  // field keeps it; once the host's text matches, or when nothing was typed, the field follows
  // the host, so a change made elsewhere is never saved over.
  const typed = useRef<string | null>(null);
  useEffect(() => {
    if (busy) return;
    let cancelled = false;
    void inspectMarkdown(selection.instancePath).then((element) => {
      if (cancelled) return;
      const prose = element?.properties.find((field) => field.name === "children");
      const fresh = prose === undefined ? null : prose.value;
      if (typed.current !== null && fresh !== typed.current) return;
      typed.current = null;
      setText(fresh);
    });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The read is retried when the render it belongs to changes, though the read itself takes no render.
  }, [inspectMarkdown, selection.instancePath, busy, revision]);
  return (
    <div data-slot="editor-element-controls" className="pb-3">
      {text === "loading" ? (
        <p className="text-muted-foreground mt-3 text-xs">Reading the text.</p>
      ) : text === null ? (
        <p data-testid="markdown.unavailable" className="text-muted-foreground mt-3 text-xs">
          This part has no text to edit here.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          <label className="block text-xs">
            Text
            <textarea
              data-testid="markdown.text"
              className={cn(inputClass, "mt-1 min-h-20")}
              value={text}
              onChange={(event) => {
                typed.current = event.target.value;
                setText(event.target.value);
                editMarkdownText(selection.instancePath, event.target.value);
              }}
            />
          </label>
          <p className="text-muted-foreground text-xs">
            Changes save as you type, and also update the web page and the email.
          </p>
          {error !== null && (
            <p data-testid="markdown.error" role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
