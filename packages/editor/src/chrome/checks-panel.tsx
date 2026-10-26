import { useEditorStore } from "../state/context";
import { AttentionSummary } from "./compatibility-report";
import { EmailDifferences } from "./email-differences-panel";

/**
 * Every check on the draft: what needs attention, with its repair, and the client compatibility
 * report. The work pane's Checks tab and the inspector's document scope show the same panel.
 */
export function ChecksPanel() {
  const checks = useEditorStore((state) => state.checks);
  const pageAvailable = useEditorStore((state) => state.pageAvailable);
  const editable = useEditorStore((state) => state.sourceEditable);
  return (
    <div data-slot="editor-checks-panel" className="space-y-5">
      {pageAvailable && <EmailDifferences />}
      <AttentionSummary checks={checks} editable={editable} />
    </div>
  );
}
