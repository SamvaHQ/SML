import type { ChannelEditResult } from "@samva/markup/edit";
import { useCallback } from "react";

import { useEditorStore, useEditorStoreApi } from "../state/context";

/**
 * Turn a channel form change into a saved source edit. The change is computed against the draft the
 * editor holds now, so typing does not wait on the previous save; an edit that cannot be expressed
 * as a replacement is reported like any other refused source edit. `key` merges consecutive edits
 * of one field into a single save and undo step.
 */
export function useChannelEdit<TEdit>(
  edit: (source: string, change: TEdit) => ChannelEditResult,
): (change: TEdit, key?: string) => void {
  const store = useEditorStoreApi();
  const { applySourceEdit } = useEditorStore((state) => state.actions);
  return useCallback(
    (change, key) => {
      const { doc } = store.getState();
      if (doc === null) return;
      const source = doc.origin.authoredSource;
      const result = edit(source, change);
      if (!result.ok) {
        store.setState({ sourceEditError: result.reason });
        return;
      }
      if (result.edits.length === 0) return;
      applySourceEdit({ revision: doc.rev, source, edits: result.edits, coalesceKey: key });
    },
    [applySourceEdit, edit, store],
  );
}
