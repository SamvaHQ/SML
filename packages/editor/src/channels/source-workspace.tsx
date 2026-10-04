import { cn } from "../chrome/ui-classes";
import { useEditorStore } from "../state/context";

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

/** The canonical TSX entry, for every channel. */
export function SourceWorkspace() {
  const doc = useEditorStore((state) => state.doc);
  const sourceEditable = useEditorStore((state) => state.sourceEditable);
  const { replaceAuthoredSource } = useEditorStore((state) => state.actions);
  if (doc === null) {
    return (
      <div className="text-muted-foreground grid flex-1 place-items-center text-sm">Loading…</div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <SourcePanel
        label={`Authored TSX · ${doc.origin.file}`}
        source={doc.origin.authoredSource}
        editable={sourceEditable}
        testId="source-workspace.authored-tsx"
        onChange={sourceEditable ? replaceAuthoredSource : undefined}
      />
    </div>
  );
}
