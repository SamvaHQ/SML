import type { EmailElementSelection } from "@samva/markup/edit";
import { useEffect, useState } from "react";

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
  useEffect(() => {
    if (busy) return;
    let cancelled = false;
    void inspectMarkdown(selection.instancePath).then((element) => {
      if (cancelled) return;
      const prose = element?.properties.find((field) => field.name === "children");
      // What is being typed is never replaced by a re-read.
      setText((current) =>
        current === "loading" || current === null
          ? prose === undefined
            ? null
            : prose.value
          : current,
      );
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
