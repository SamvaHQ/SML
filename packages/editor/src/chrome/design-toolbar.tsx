import { inspectSourceElement, structuralReplacements } from "@samva/markup/edit";
import type { EmailElementSelection } from "@samva/markup/edit";
import { useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { Button } from "../ui/button";
import { ArrowUp, ChevronDown, ChevronUp, Duplicate, Trash } from "./editor-icons";
import { authoredAncestry, friendlyName, occurrenceNote } from "./friendly";

type BlockOperation =
  | { readonly kind: "delete" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "reorder"; readonly direction: "before" | "after" };

/**
 * The toolbar over the element selected in Design: its name, a step out to the element around
 * it, and the block edits that need no form (move earlier or later, duplicate, delete). Each is
 * staged like an edit from the properties. It is drawn inside the email's frame, so it is styled
 * by the frame's own chrome sheet rather than the editor's classes.
 */
export function DesignToolbar({
  selection,
}: {
  readonly selection: EmailElementSelection;
}): ReactNode {
  const { entry, source, revision, rev, ready } = useEditorStore(
    useShallow((state) => ({
      entry: state.doc?.origin.file ?? null,
      source: state.doc?.origin.authoredSource ?? null,
      revision: state.render?.revision ?? null,
      rev: state.doc?.rev ?? null,
      ready:
        state.sourceEditable &&
        !state.conflict &&
        !state.lifecycleBusy &&
        !state.hostBusy &&
        state.pendingAuthoredSource === null,
    })),
  );
  const { applySourceEdit, select } = useEditorStore((state) => state.actions);
  const name = useEditorStore((state) =>
    [friendlyName(selection, state.doc?.origin.authoredSource ?? ""), occurrenceNote(selection)]
      .filter((part) => part !== undefined)
      .join(" "),
  );
  const origin = selection.origins[0];
  const target = useMemo(
    () =>
      origin === undefined || entry === null || source === null || origin.fileName !== entry
        ? null
        : inspectSourceElement(source, entry, origin),
    [origin, entry, source],
  );
  const outline = useEditorStore((state) => state.outline);
  // Out to the block the author wrote around it, past the compiler's tables and cells.
  const parent =
    outline === null
      ? undefined
      : authoredAncestry(outline, selection.instancePath).at(-1)?.instancePath;
  const available = ready && target !== null && source !== null && revision === rev;
  const run = (operation: BlockOperation, label: string) => {
    if (!available || revision === null) return;
    const edits = structuralReplacements(source, target, operation);
    if (edits !== null) applySourceEdit({ revision, source, edits, design: { label } });
  };
  const why =
    target === null && origin !== undefined && origin.fileName !== entry
      ? `Written in ${origin.fileName}. Edit it from the properties.`
      : undefined;
  const button = (input: {
    readonly label: string;
    readonly testId: string;
    readonly enabled: boolean;
    readonly onClick: () => void;
    readonly children: ReactNode;
  }) => (
    // The shared Button, inside the email's frame: the editor's Tailwind does not reach there, so
    // the frame's chrome sheet styles it through `.samva-tb button`.
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={input.label}
      title={input.enabled ? input.label : (why ?? input.label)}
      data-testid={`design-toolbar.${input.testId}`}
      disabled={!input.enabled}
      onClick={input.onClick}
    >
      {input.children}
    </Button>
  );
  return (
    <div
      className="samva-tb"
      role="toolbar"
      aria-label="Selected element"
      data-testid="design-toolbar"
    >
      <span className="samva-tb-label">{name}</span>
      <span className="samva-tb-sep" aria-hidden />
      {button({
        label: "Select the element around it",
        testId: "parent",
        enabled: parent !== undefined,
        onClick: () => {
          if (parent !== undefined) select(parent);
        },
        children: <ArrowUp />,
      })}
      {button({
        label: "Move earlier",
        testId: "move-earlier",
        enabled: available && target.previous !== null,
        onClick: () => run({ kind: "reorder", direction: "before" }, "Move block earlier"),
        children: <ChevronUp />,
      })}
      {button({
        label: "Move later",
        testId: "move-later",
        enabled: available && target.next !== null,
        onClick: () => run({ kind: "reorder", direction: "after" }, "Move block later"),
        children: <ChevronDown />,
      })}
      {button({
        label: "Duplicate",
        testId: "duplicate",
        enabled: available && target.structural,
        onClick: () => run({ kind: "duplicate" }, "Duplicate block"),
        children: <Duplicate />,
      })}
      {button({
        label: "Delete",
        testId: "delete",
        enabled: available && target.structural,
        onClick: () => run({ kind: "delete" }, "Delete block"),
        children: <Trash />,
      })}
    </div>
  );
}
