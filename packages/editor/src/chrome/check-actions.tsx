import { hasUpgradeRecipe } from "@samva/markup/diagnostics";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { newWindowTargetFix } from "../state/diagnostic-fixes";
import type { CheckItem } from "../state/types";
import { useContribution } from "./contributions";

/** Offered only for literal local anchors; persistence and undo remain store-owned. */
export function CheckActions({ check }: { readonly check: CheckItem }) {
  const assistantDocked = useContribution("rail.assistant") !== undefined;
  const { doc, sourceEditable, pending, conflict, lifecycleBusy } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      sourceEditable: state.sourceEditable,
      pending: state.pendingAuthoredSource !== null,
      conflict: state.conflict,
      lifecycleBusy: state.lifecycleBusy,
    })),
  );
  const applySourceEdit = useEditorStore((state) => state.actions.applySourceEdit);
  const requestDiagnosticAssistance = useEditorStore(
    (state) => state.actions.requestDiagnosticAssistance,
  );
  if (doc === null || !sourceEditable) return null;
  const edits = newWindowTargetFix(check, doc.origin.authoredSource, doc.origin.file);
  if (edits.length === 0 && !assistantDocked) return null;
  const upgradable = check.diagnostics?.some((diagnostic) => hasUpgradeRecipe(diagnostic.code));
  const blocked = pending || conflict || lifecycleBusy;
  return (
    <div className="mt-2 space-y-1">
      {edits.length > 0 && (
        <>
          <p className="text-muted-foreground text-[11.5px]">
            Set {edits.length} local link target{edits.length === 1 ? "" : "s"} to _blank to match
            these clients.
          </p>
          <button
            type="button"
            data-testid="check.fix-target"
            disabled={blocked}
            className="border-border hover:bg-muted rounded border px-2 py-1 text-[11.5px] disabled:opacity-50"
            onClick={() =>
              applySourceEdit({ revision: doc.rev, source: doc.origin.authoredSource, edits })
            }
          >
            Use new-window links
          </button>
        </>
      )}
      {assistantDocked && (
        <button
          type="button"
          data-testid={upgradable ? "check.upgrade-with-assistant" : "check.fix-with-assistant"}
          disabled={blocked}
          className="border-border hover:bg-muted rounded border px-2 py-1 text-[11.5px] disabled:opacity-50"
          onClick={() => requestDiagnosticAssistance(check)}
        >
          {upgradable ? "Upgrade with Assistant" : "Fix with Assistant"}
        </button>
      )}
    </div>
  );
}
