import { cn } from "../chrome/ui-classes";
import { useEditorStore } from "../state/context";
import { pendingDesignEdits } from "../state/store";

function SourcePanel({
  label,
  source,
  editable,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly source: string;
  readonly editable: boolean;
  readonly onChange?: ((source: string) => void) | undefined;
  readonly testId: string;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-border-subtle bg-surface-inset text-muted-foreground border-b px-4 py-2 font-mono text-[11px] font-medium">
        {label}
      </div>
      <textarea
        aria-label={label}
        data-testid={testId}
        readOnly={!editable}
        spellCheck={false}
        value={source}
        onChange={(event) => onChange?.(event.target.value)}
        className={cn(
          "border border-[color:var(--editor-well-border)] bg-[var(--editor-well-bg)] shadow-[var(--editor-well-shadow)]",
          "samva-editor-scroll text-foreground min-h-0 flex-1 resize-none border-t-0 p-4 font-mono text-[12.5px] leading-5 outline-none",
          // A read-only panel is inactive, not an editable receptacle, so it loses the
          // well's physicality: flatten the inset and take a muted fill.
          "read-only:bg-muted read-only:shadow-none dark:read-only:bg-muted/40",
        )}
      />
    </section>
  );
}

/** The canonical authored entry, for every channel: TSX, or the Markdown issue and its frontmatter. */
export function SourceWorkspace() {
  const doc = useEditorStore((state) => state.doc);
  // Staged Design edits are undone and reset in order, so the source waits for them to be applied
  // or reset rather than changing under them.
  const staged = useEditorStore((state) => pendingDesignEdits(state) > 0);
  const sourceEditable = useEditorStore((state) => state.sourceEditable) && !staged;
  const { replaceAuthoredSource } = useEditorStore((state) => state.actions);
  if (doc === null) {
    return (
      <div className="text-muted-foreground grid flex-1 place-items-center text-sm">Loading…</div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SourcePanel
        label={`${doc.origin.kind === "markdown" ? "Authored Markdown" : "Authored TSX"} · ${doc.origin.file}${staged ? " · apply or reset your Design edits to edit it" : ""}`}
        source={doc.origin.authoredSource}
        editable={sourceEditable}
        testId={
          doc.origin.kind === "markdown"
            ? "source-workspace.authored-markdown"
            : "source-workspace.authored-tsx"
        }
        onChange={sourceEditable ? replaceAuthoredSource : undefined}
      />
    </div>
  );
}
